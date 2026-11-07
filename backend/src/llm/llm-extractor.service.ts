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
  private readonly useResponsesApi: boolean;

  constructor(config: ConfigService) {
    const openaiKey = config.get<string>('OPENAI_API_KEY');
    this.openai = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;
    this.openaiModel =
      config.get<string>('OPENAI_MODEL')?.trim() || 'gpt-5.6-luna';
    // gpt-6 models (e.g. gpt-6.1-sol) go through the Responses API with a
    // strict JSON schema, like the blog writer: that path accepts structured
    // output together with reasoning, which chat function tools do not.
    this.useResponsesApi = /^gpt-6/.test(this.openaiModel);
    // Newer reasoning models (gpt-5.x, e.g. gpt-5.6-luna) reject function
    // tools on /v1/chat/completions unless reasoning_effort is 'none', while
    // older ones (gpt-5-mini) reject 'none' and only accept minimal|low|
    // medium|high. So the default is derived from the model; an explicit
    // OPENAI_REASONING_EFFORT always wins (set it to empty to send nothing).
    this.reasoningEffort =
      config.get<string>('OPENAI_REASONING_EFFORT') ??
      LlmExtractorService.defaultReasoningEffort(this.openaiModel);

    if (!this.openai) {
      this.logger.warn(
        'OPENAI_API_KEY not set: text-extraction sources will be skipped.',
      );
    }
  }

  get enabled(): boolean {
    return this.openai !== null;
  }

  /**
   * Reasoning models named `gpt-5.<minor>` (e.g. gpt-5.6-luna) only allow
   * function tools when reasoning_effort is 'none'. Everything else keeps the
   * previous behaviour of sending no reasoning_effort at all.
   */
  private static defaultReasoningEffort(model: string): string | undefined {
    if (/^gpt-6/.test(model)) return 'low';
    return /^gpt-5\.\d/.test(model) ? 'none' : undefined;
  }

  async extract<T>(params: ExtractParams): Promise<T | null> {
    if (!this.openai) return null;

    try {
      return this.useResponsesApi
        ? await this.extractWithResponses<T>(params)
        : await this.extractWithOpenAI<T>(params);
    } catch (error) {
      this.logger.warn(`OpenAI extraction failed: ${error}`);
      return null;
    }
  }

  private async extractWithResponses<T>(
    params: ExtractParams,
  ): Promise<T | null> {
    if (!this.openai) return null;

    const response = await this.openai.responses.create({
      model: this.openaiModel,
      ...(this.reasoningEffort
        ? {
            reasoning: {
              effort: this.reasoningEffort as 'low' | 'medium' | 'high',
            },
          }
        : {}),
      input: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.user },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: params.schemaName,
          strict: true,
          schema: params.schema,
        },
      },
    });

    this.logger.log(
      `${params.schemaName} ${this.openaiModel}: ${response.usage?.input_tokens ?? '?'} in, ${response.usage?.output_tokens ?? '?'} out`,
    );
    const text = response.output_text;
    if (!text) return null;
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      this.logger.warn(`Failed to parse OpenAI JSON output: ${error}`);
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
