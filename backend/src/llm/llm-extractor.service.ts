import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

export interface ExtractParams {
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
}

/**
 * Grounded structured extractor backed by OpenAI function-calling.
 *
 * The model is forced to call a single tool whose `parameters` schema
 * matches the caller's, which is the canonical way to get reliable
 * JSON back. The model is only ever used to read provided text, never
 * to recall facts from training memory.
 */
@Injectable()
export class LlmExtractorService {
  private readonly logger = new Logger(LlmExtractorService.name);
  private readonly openai: OpenAI | null;
  private readonly openaiModel: string;
  private readonly reasoningEffort?: string;

  constructor(config: ConfigService) {
    const openaiKey = config.get<string>('OPENAI_API_KEY');
    this.openai = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;
    this.openaiModel = config.get<string>('OPENAI_MODEL') ?? 'gpt-5.6-luna';
    // Optional per-model tuning. Newer reasoning models (e.g. gpt-5.6-*)
    // reject function tools unless reasoning_effort is 'none', while older
    // ones (gpt-5-mini) reject 'none' — so it must stay caller-configurable
    // rather than inferred from the model name.
    this.reasoningEffort = config.get<string>('OPENAI_REASONING_EFFORT');

    if (!this.openai) {
      this.logger.warn(
        'OPENAI_API_KEY not set: text-extraction sources will be skipped.',
      );
    }
  }

  get enabled(): boolean {
    return this.openai !== null;
  }

  async extract<T>(params: ExtractParams): Promise<T | null> {
    if (!this.openai) return null;

    try {
      return await this.extractWithOpenAI<T>(params);
    } catch (error) {
      this.logger.warn(`OpenAI extraction failed: ${error}`);
      return null;
    }
  }

  private async extractWithOpenAI<T>(params: ExtractParams): Promise<T | null> {
    if (!this.openai) return null;

    // GPT-5 and o-series reasoning models only accept the default temperature (1).
    const supportsTemperature = !/^(gpt-5|o\d)/.test(this.openaiModel);

    const response = await this.openai.chat.completions.create({
      model: this.openaiModel,
      ...(supportsTemperature ? { temperature: 0 } : {}),
      ...(this.reasoningEffort
        ? {
            reasoning_effort: this
              .reasoningEffort as OpenAI.Chat.ChatCompletionCreateParams['reasoning_effort'],
          }
        : {}),
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
            parameters: params.schema,
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
