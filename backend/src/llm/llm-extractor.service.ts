import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

export interface ExtractParams {
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
}

/**
 * Thin wrapper around the Anthropic API for grounded, structured extraction.
 * Callers supply the instructions and a JSON schema; the model is only ever
 * used to read provided text, never to recall facts from training memory.
 *
 * Structured output is implemented via Anthropic tool-use: we define a single
 * tool whose input_schema matches the caller's schema, then force the model to
 * call it (`tool_choice: { type: "tool" }`). This is the canonical way to get
 * reliable JSON from Claude.
 */
@Injectable()
export class LlmExtractorService {
  private readonly logger = new Logger(LlmExtractorService.name);
  private readonly client: Anthropic | null;
  private readonly model: string;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('ANTHROPIC_API_KEY');
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
    this.model =
      config.get<string>('ANTHROPIC_MODEL') ?? 'claude-haiku-4-5';

    if (!this.client) {
      this.logger.warn(
        'ANTHROPIC_API_KEY not set: text-extraction sources will be skipped.',
      );
    }
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  async extract<T>(params: ExtractParams): Promise<T | null> {
    if (!this.client) return null;

    try {
      const response = await this.client.messages.create({
        model: this.model,
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
    } catch (error) {
      this.logger.warn(`LLM extraction failed: ${error}`);
      return null;
    }
  }
}
