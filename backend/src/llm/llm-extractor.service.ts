import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export interface ExtractParams {
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
}

/**
 * Grounded structured extractor with provider fallback.
 *
 * Priority order:
 *   1. Anthropic Claude (tool-use forced to a single tool whose input_schema
 *      matches the caller's schema — canonical way to get reliable JSON).
 *   2. OpenAI as a fallback if Anthropic throws (rate limit, outage, etc.).
 *
 * Models are only ever used to read provided text, never to recall facts
 * from training memory.
 */
@Injectable()
export class LlmExtractorService {
  private readonly logger = new Logger(LlmExtractorService.name);
  private readonly anthropic: Anthropic | null;
  private readonly openai: OpenAI | null;
  private readonly anthropicModel: string;
  private readonly openaiModel: string;

  constructor(config: ConfigService) {
    const anthropicKey = config.get<string>('ANTHROPIC_API_KEY');
    this.anthropic = anthropicKey ? new Anthropic({ apiKey: anthropicKey }) : null;
    this.anthropicModel =
      config.get<string>('ANTHROPIC_MODEL') ?? 'claude-haiku-4-5';

    const openaiKey = config.get<string>('OPENAI_API_KEY');
    this.openai = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;
    this.openaiModel = config.get<string>('OPENAI_MODEL') ?? 'gpt-4o-mini';

    if (!this.anthropic && !this.openai) {
      this.logger.warn(
        'Neither ANTHROPIC_API_KEY nor OPENAI_API_KEY is set: text-extraction sources will be skipped.',
      );
    } else if (!this.anthropic) {
      this.logger.warn(
        'ANTHROPIC_API_KEY not set: using OpenAI as primary provider.',
      );
    }
  }

  get enabled(): boolean {
    return this.anthropic !== null || this.openai !== null;
  }

  async extract<T>(params: ExtractParams): Promise<T | null> {
    if (this.anthropic) {
      try {
        return await this.extractWithAnthropic<T>(params);
      } catch (error) {
        this.logger.warn(
          `Anthropic extraction failed, attempting OpenAI fallback: ${error}`,
        );
      }
    }

    if (this.openai) {
      try {
        return await this.extractWithOpenAI<T>(params);
      } catch (error) {
        this.logger.warn(`OpenAI extraction failed: ${error}`);
      }
    }

    return null;
  }

  private async extractWithAnthropic<T>(
    params: ExtractParams,
  ): Promise<T | null> {
    if (!this.anthropic) return null;

    const response = await this.anthropic.messages.create({
      model: this.anthropicModel,
      max_tokens: 1024,
      temperature: 0,
      system: params.system,
      messages: [{ role: 'user', content: params.user }],
      tools: [
        {
          name: params.schemaName,
          description:
            'Return the structured extraction result matching the schema.',
          input_schema: params.schema as Anthropic.Tool['input_schema'],
        },
      ],
      tool_choice: { type: 'tool', name: params.schemaName },
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );
    if (!toolUse) return null;
    return toolUse.input as T;
  }

  private async extractWithOpenAI<T>(
    params: ExtractParams,
  ): Promise<T | null> {
    if (!this.openai) return null;

    const response = await this.openai.chat.completions.create({
      model: this.openaiModel,
      temperature: 0,
      messages: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.user },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: params.schemaName,
            description:
              'Return the structured extraction result matching the schema.',
            parameters: params.schema as Record<string, unknown>,
          },
        },
      ],
      tool_choice: {
        type: 'function',
        function: { name: params.schemaName },
      },
    });

    const toolCall = response.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.type !== 'function') return null;

    try {
      return JSON.parse(toolCall.function.arguments) as T;
    } catch (error) {
      this.logger.warn(`Failed to parse OpenAI tool arguments: ${error}`);
      return null;
    }
  }
}
