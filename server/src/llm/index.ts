/**
 * LLM manager – owns the active provider instance and provides a
 * convenience facade used throughout the application.
 *
 * Usage:
 *   import { llmManager } from './llm/index.js';
 *   const reply = await llmManager.generateResponse(messages, systemPrompt);
 */

import { ClaudeProvider, type ToolExecutor } from './claude.js';
import { config } from '../config.js';
import type {
  ChatCompletionOptions,
  LLMMessage,
  LLMOptions,
  LLMProvider,
  LLMResponse,
} from './types.js';

// Re-export types so callers only need a single import path.
export type {
  ChatCompletionOptions,
  LLMMessage,
  LLMOptions,
  LLMProvider,
  LLMResponse,
  LLMUsage,
  MessageRole,
} from './types.js';

// ---------------------------------------------------------------------------
// Provider names
// ---------------------------------------------------------------------------

export type ProviderName = 'claude' /* | 'openai' */ ;

// ---------------------------------------------------------------------------
// LLMManager
// ---------------------------------------------------------------------------

export class LLMManager {
  private provider: LLMProvider;

  constructor(provider: LLMProvider) {
    this.provider = provider;
  }

  // -------------------------------------------------------------------------
  // Factory
  // -------------------------------------------------------------------------

  /**
   * Create an LLMManager pre-loaded with the named provider.
   *
   * @param name    Provider identifier (only 'claude' is supported today).
   * @param apiKey  API key for the chosen provider.
   * @param model   Optional model override.
   */
  static create(
    name: ProviderName,
    apiKey: string,
    model?: string,
  ): LLMManager {
    switch (name) {
      case 'claude':
        return new LLMManager(new ClaudeProvider(apiKey, model));
      default:
        throw new Error(`LLMManager: unknown provider "${name as string}"`);
    }
  }

  // -------------------------------------------------------------------------
  // Provider management
  // -------------------------------------------------------------------------

  /** Replace the active provider at runtime (e.g. for testing). */
  setProvider(provider: LLMProvider): void {
    this.provider = provider;
  }

  getProvider(): LLMProvider {
    return this.provider;
  }

  // -------------------------------------------------------------------------
  // Convenience methods
  // -------------------------------------------------------------------------

  /**
   * Generate a response for a conversation.
   *
   * @param messages     Full conversation history (user + assistant turns).
   * @param systemPrompt Optional system instruction that overrides any
   *                     leading system message in `messages`.
   * @param options      Additional generation parameters.
   */
  async generateResponse(
    messages: LLMMessage[],
    systemPrompt?: string,
    options: LLMOptions = {},
  ): Promise<LLMResponse> {
    return this.provider.chat(messages, {
      ...options,
      ...(systemPrompt ? { systemPrompt } : {}),
    });
  }

  /**
   * Lower-level pass-through to the underlying provider's `chat` method.
   * Prefer `generateResponse` for application code.
   */
  async chat(
    messages: LLMMessage[],
    options?: ChatCompletionOptions,
  ): Promise<LLMResponse> {
    return this.provider.chat(messages, options);
  }

  /**
   * Run an agentic tool-use loop.  Only works when the underlying provider
   * is a ClaudeProvider.  Passes tool definitions to Claude and loops
   * tool_use → tool_result until Claude returns a final text response.
   */
  async chatWithTools(
    messages: LLMMessage[],
    systemPrompt: string | undefined,
    options: LLMOptions,
    tools: unknown[],
    executeToolFn: ToolExecutor,
  ): Promise<LLMResponse> {
    if (!(this.provider instanceof ClaudeProvider)) {
      throw new Error('chatWithTools is only supported with ClaudeProvider');
    }

    return this.provider.chatWithTools(messages, {
      ...options,
      ...(systemPrompt ? { systemPrompt } : {}),
      tools,
    }, executeToolFn);
  }

  /**
   * Stream a response token-by-token (if the provider supports it).
   * Throws if the active provider does not implement `streamChat`.
   */
  async *streamChat(
    messages: LLMMessage[],
    options?: ChatCompletionOptions,
  ): AsyncIterable<string> {
    if (!this.provider.streamChat) {
      throw new Error(
        'LLMManager: the active provider does not support streaming',
      );
    }
    yield* this.provider.streamChat(messages, options);
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

/**
 * Application-wide LLM manager singleton.
 *
 * Initialised lazily on first access so that the API key can be read from
 * the environment after the process starts.
 */
let _instance: LLMManager | null = null;

export function getLLMManager(): LLMManager {
  if (_instance) return _instance;

  // Use the validated config singleton rather than reading env vars directly.
  const apiKey = config.anthropicApiKey;
  const model = config.claudeModel;
  const providerName: ProviderName =
    (process.env.LLM_PROVIDER as ProviderName | undefined) ?? 'claude';

  _instance = LLMManager.create(providerName, apiKey, model);
  return _instance;
}

/** Replace the singleton (primarily for unit tests). */
export function setLLMManager(manager: LLMManager): void {
  _instance = manager;
}

export const llmManager = new Proxy({} as LLMManager, {
  get(_target, prop: string | symbol) {
    return (getLLMManager() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
