/**
 * Anthropic Claude provider implementation.
 *
 * Wraps the official @anthropic-ai/sdk and adapts it to the internal
 * LLMProvider interface.  A single automatic retry is attempted on transient
 * network / rate-limit errors before propagating the failure to the caller.
 *
 * Supports an agentic tool-use loop: when tools are provided, Claude may
 * respond with tool_use content blocks.  The caller supplies tool executors
 * via `chatWithTools()`, and the provider loops until Claude produces a
 * final text response.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  ChatCompletionOptions,
  LLMMessage,
  LLMProvider,
  LLMResponse,
} from './types.js';
import { createLogger } from '../logger.js';
import { ExternalServiceError } from '../errors.js';

const logger = createLogger('Claude');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_TEMPERATURE = 0.7;
const RETRY_DELAY_MS = 1_500;
const MAX_TOOL_ROUNDS = 15;

/** HTTP status codes / error names that are safe to retry once. */
const TRANSIENT_ERROR_INDICATORS = new Set([
  'overloaded_error',
  'rate_limit_error',
  'api_error',
  'timeout_error',
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolExecutor {
  (toolName: string, toolInput: Record<string, unknown>): Promise<string>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isTransient(err: unknown): boolean {
  if (err instanceof Anthropic.APIError) {
    // 429, 529 – rate limit / overloaded
    if (err.status === 429 || err.status === 529) return true;
    // 5xx – server-side transient failures
    if (err.status >= 500) return true;
    if (TRANSIENT_ERROR_INDICATORS.has(err.error?.type ?? '')) return true;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// ClaudeProvider
// ---------------------------------------------------------------------------

export class ClaudeProvider implements LLMProvider {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(apiKey: string, model: string = DEFAULT_MODEL) {
    if (!apiKey) {
      throw new Error('ClaudeProvider: apiKey is required');
    }
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  // -------------------------------------------------------------------------
  // LLMProvider.chat  (no tools — simple text completion)
  // -------------------------------------------------------------------------

  async chat(
    messages: LLMMessage[],
    options: ChatCompletionOptions = {},
  ): Promise<LLMResponse> {
    return this._chatWithRetry(messages, options, /* attempt */ 0);
  }

  // -------------------------------------------------------------------------
  // Agentic tool-use loop
  // -------------------------------------------------------------------------

  /**
   * Send a chat request with tool definitions.  When Claude responds with
   * `tool_use` content blocks, invoke the executor for each tool call, feed
   * the results back as `tool_result` messages, and repeat — up to
   * MAX_TOOL_ROUNDS iterations — until Claude produces a final text answer.
   *
   * @param messages      Conversation history.
   * @param options       Generation parameters (tools should be included).
   * @param executeToolFn Callback that runs the named tool with given input
   *                      and returns the textual result.
   * @returns The final text response and aggregated token usage.
   */
  async chatWithTools(
    messages: LLMMessage[],
    options: ChatCompletionOptions,
    executeToolFn: ToolExecutor,
  ): Promise<LLMResponse> {
    const { anthropicMessages, systemPrompt } = this._prepareMessages(
      messages,
      options,
    );

    const tools = (options.tools ?? []) as Anthropic.Tool[];
    let currentMessages: Anthropic.MessageParam[] = [...anthropicMessages];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let finalModel = this.model;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await this._createWithRetry(
        {
          model: this.model,
          max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
          temperature: options.temperature ?? DEFAULT_TEMPERATURE,
          ...(systemPrompt ? { system: systemPrompt } : {}),
          messages: currentMessages,
          ...(tools.length > 0 ? { tools } : {}),
        },
        0,
      );

      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;
      finalModel = response.model;

      // Check if the response contains any tool_use blocks
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ContentBlock & { type: 'tool_use' } =>
          b.type === 'tool_use',
      );

      // If no tool calls or stop_reason is end_turn, extract text and return
      if (toolUseBlocks.length === 0 || response.stop_reason === 'end_turn') {
        const textBlock = response.content.find((b) => b.type === 'text');
        const content =
          textBlock && textBlock.type === 'text' ? textBlock.text : '';
        return {
          content,
          usage: {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
          },
          model: finalModel,
        };
      }

      // Claude wants to use tools — execute each one
      // First, add Claude's full response as an assistant message
      currentMessages.push({
        role: 'assistant',
        content: response.content as Anthropic.ContentBlockParam[],
      });

      // Execute all tool calls and collect results
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolBlock of toolUseBlocks) {
        let resultText: string;
        try {
          resultText = await executeToolFn(
            toolBlock.name,
            toolBlock.input as Record<string, unknown>,
          );
        } catch (err) {
          resultText = `Error executing tool "${toolBlock.name}": ${err instanceof Error ? err.message : String(err)}`;
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: resultText,
        });
      }

      // Add tool results as a user message
      currentMessages.push({
        role: 'user',
        content: toolResults,
      });
    }

    // Exhausted tool rounds — return whatever text we have
    return {
      content:
        'I apologize, but I seem to have gotten stuck in a loop using tools. Could you rephrase your request?',
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
      },
      model: finalModel,
    };
  }

  // -------------------------------------------------------------------------
  // LLMProvider.streamChat
  // -------------------------------------------------------------------------

  async *streamChat(
    messages: LLMMessage[],
    options: ChatCompletionOptions = {},
  ): AsyncIterable<string> {
    const { anthropicMessages, systemPrompt } = this._prepareMessages(
      messages,
      options,
    );

    const stream = await this.client.messages.stream({
      model: this.model,
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: options.temperature ?? DEFAULT_TEMPERATURE,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: anthropicMessages,
    });

    for await (const chunk of stream) {
      if (
        chunk.type === 'content_block_delta' &&
        chunk.delta.type === 'text_delta'
      ) {
        yield chunk.delta.text;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Separates the optional leading system message from the rest of the
   * conversation and converts everything to the Anthropic message shape.
   */
  private _prepareMessages(
    messages: LLMMessage[],
    options: ChatCompletionOptions,
  ): {
    anthropicMessages: Anthropic.MessageParam[];
    systemPrompt: string | undefined;
  } {
    // Prefer an explicit systemPrompt option; fall back to a leading system
    // message in the array; fall back to nothing.
    let systemPrompt: string | undefined = options.systemPrompt;
    const conversationMessages = [...messages];

    if (!systemPrompt && conversationMessages[0]?.role === 'system') {
      systemPrompt = conversationMessages.shift()!.content;
    }

    // Filter out any remaining system-role messages (Anthropic rejects them).
    const filteredMessages = conversationMessages.filter(
      (m) => m.role !== 'system',
    );

    if (filteredMessages.length === 0) {
      throw new Error(
        'ClaudeProvider.chat: at least one user or assistant message is required',
      );
    }

    // Anthropic requires messages to alternate user/assistant and start with
    // a user turn.  Insert a minimal user message when the first entry is an
    // assistant message (edge case from history reconstruction).
    const normalized: Anthropic.MessageParam[] = [];
    for (const msg of filteredMessages) {
      if (
        normalized.length === 0 &&
        msg.role === 'assistant'
      ) {
        normalized.push({ role: 'user', content: '...' });
      }
      normalized.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
    }

    return { anthropicMessages: normalized, systemPrompt };
  }

  /**
   * Low-level create call with a single retry on transient errors.
   */
  private async _createWithRetry(
    params: Anthropic.MessageCreateParamsNonStreaming,
    attempt: number,
  ): Promise<Anthropic.Message> {
    try {
      return await this.client.messages.create(params);
    } catch (err) {
      if (attempt === 0 && isTransient(err)) {
        logger.warn('Transient error, retrying...', { attempt, error: err instanceof Error ? err.message : String(err) });
        await sleep(RETRY_DELAY_MS);
        return this._createWithRetry(params, 1);
      }
      if (err instanceof Anthropic.APIError) {
        throw new ExternalServiceError(
          'Anthropic',
          `API error [${err.status}] ${err.message} (type: ${err.error?.type ?? 'unknown'})`,
          err,
        );
      }
      throw err;
    }
  }

  private async _chatWithRetry(
    messages: LLMMessage[],
    options: ChatCompletionOptions,
    attempt: number,
  ): Promise<LLMResponse> {
    try {
      const { anthropicMessages, systemPrompt } = this._prepareMessages(
        messages,
        options,
      );

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: options.temperature ?? DEFAULT_TEMPERATURE,
        ...(systemPrompt ? { system: systemPrompt } : {}),
        messages: anthropicMessages,
      });

      // Extract text from the first content block.
      const textBlock = response.content.find((b) => b.type === 'text');
      const content =
        textBlock && textBlock.type === 'text' ? textBlock.text : '';

      return {
        content,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
        model: response.model,
      };
    } catch (err) {
      if (attempt === 0 && isTransient(err)) {
        logger.warn('Transient error, retrying chat...', { attempt, error: err instanceof Error ? err.message : String(err) });
        await sleep(RETRY_DELAY_MS);
        return this._chatWithRetry(messages, options, 1);
      }

      if (err instanceof Anthropic.APIError) {
        throw new ExternalServiceError(
          'Anthropic',
          `API error [${err.status}] ${err.message} (type: ${err.error?.type ?? 'unknown'})`,
          err,
        );
      }

      throw err;
    }
  }
}
