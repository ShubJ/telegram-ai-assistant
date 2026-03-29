/**
 * Core LLM type definitions.
 *
 * All providers must implement the LLMProvider interface so the rest of the
 * application can stay provider-agnostic.
 */

// ---------------------------------------------------------------------------
// Primitive building blocks
// ---------------------------------------------------------------------------

export type MessageRole = 'user' | 'assistant' | 'system';

export interface LLMMessage {
  role: MessageRole;
  content: string;
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LLMResponse {
  /** The model's text reply. */
  content: string;
  /** Token counts reported by the provider. */
  usage: LLMUsage;
  /** The exact model identifier that produced this response. */
  model: string;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface LLMOptions {
  /** Maximum number of tokens the model may generate. */
  maxTokens?: number;
  /**
   * Sampling temperature – higher values produce more varied output.
   * Range is typically 0–1 (Anthropic) or 0–2 (OpenAI).
   */
  temperature?: number;
  /**
   * A system-level instruction injected before the conversation.
   * Providers that treat the system prompt separately (e.g. Anthropic) will
   * extract it from the messages array automatically.
   */
  systemPrompt?: string;
}

/**
 * Extended options that will carry tool/function-calling support in a future
 * iteration.  The base shape is stable today; the `tools` field is typed as
 * `unknown[]` to remain provider-agnostic until the tool protocol is finalised.
 */
export interface ChatCompletionOptions extends LLMOptions {
  /**
   * Tool definitions to pass to the model.
   * Each entry is intentionally left as `unknown` so that both the Anthropic
   * and OpenAI schemas can be accommodated without a union type explosion.
   */
  tools?: unknown[];
  /**
   * Explicit tool-choice strategy.
   * Mirrors the provider-level setting: `'auto'`, `'none'`, or a specific
   * tool name.
   */
  toolChoice?: 'auto' | 'none' | string;
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface LLMProvider {
  /**
   * Send a chat-completion request and return the full response once the
   * model finishes generating.
   *
   * @param messages  Ordered conversation history.
   * @param options   Generation parameters.
   */
  chat(messages: LLMMessage[], options?: ChatCompletionOptions): Promise<LLMResponse>;

  /**
   * Optional streaming variant.  Returns an async iterable that yields
   * partial content chunks as they arrive from the provider.  If a provider
   * does not support streaming it may leave this method unimplemented.
   *
   * @param messages  Ordered conversation history.
   * @param options   Generation parameters.
   */
  streamChat?(
    messages: LLMMessage[],
    options?: ChatCompletionOptions,
  ): AsyncIterable<string>;
}
