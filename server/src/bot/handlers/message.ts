/**
 * Core message handler — the main AI conversation flow with agentic tool use.
 *
 * For every plain text message (not a command) this module:
 *  1. Gets or creates the user profile
 *  2. Builds conversation context from memory (short-term + long-term)
 *  3. Builds the system prompt from the PersonalityManager
 *  4. Collects enabled skill tool definitions
 *  5. Calls Claude with tools — runs the agentic tool-use loop (Claude may
 *     invoke skills, receive results, and iterate until it has a final answer)
 *  6. Saves the interaction to memory (short-term cache + long-term extraction)
 *  7. Replies with the AI response, splitting into multiple messages if needed
 *
 * Typing indicator is shown while waiting for the LLM.
 * All errors are caught and a user-friendly message is sent instead.
 */

import type { Context } from 'grammy';
import { v4 as uuidv4 } from 'uuid';
import { getLLMManager } from '../../llm/index.js';
import { getMemoryManager } from '../../memory/index.js';
import { getPersonalityManager } from '../../personality/index.js';
import { skillRegistry } from '../../skills/index.js';
import { createLogger } from '../../logger.js';
import { AppError, ExternalServiceError, RateLimitError } from '../../errors.js';
import type { LLMMessage } from '../../llm/types.js';

const logger = createLogger('MessageHandler');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_TELEGRAM_MESSAGE_LENGTH = 4096;

// How often to re-send the typing indicator (Telegram clears it after 5s)
const TYPING_REFRESH_MS = 4_000;

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function handleMessage(ctx: Context): Promise<void> {
  if (!ctx.from || !ctx.message?.text) return;

  const userText = ctx.message.text.trim();
  if (!userText) return;

  const requestId = uuidv4().slice(0, 8);

  // Start a typing indicator loop so the user sees activity during LLM calls
  const typingStop = startTypingIndicator(ctx);

  try {
    // ---- 1. Get or create user profile ------------------------------------
    const memoryManager = getMemoryManager();
    const userProfile = memoryManager.userProfile.getOrCreateUser(
      String(ctx.from.id),
      ctx.from.username,
      ctx.from.first_name,
    );

    // ---- 2. Build conversation context ------------------------------------
    const memoryContext = await memoryManager.getContext(userProfile.id, userText);

    // ---- 3. Build system prompt -------------------------------------------
    const personalityManager = getPersonalityManager();
    const systemPrompt = personalityManager.getSystemPrompt(
      memoryContext,
      userProfile.timezone ?? 'UTC',
    );

    // ---- 4. Assemble messages for LLM ------------------------------------
    const recentMessages = memoryManager.getMessages(userProfile.id);

    // Convert from internal Message type to LLMMessage
    const llmMessages: LLMMessage[] = recentMessages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    // Add the current user message
    llmMessages.push({ role: 'user', content: userText });

    // ---- 5. Collect enabled skill tool definitions -----------------------
    const enabledSkills = skillRegistry
      .listAll()
      .filter((s) => s.isEnabled());

    const toolDefinitions = enabledSkills.map((s) => s.getToolDefinition());

    // ---- 6. Call LLM with agentic tool-use loop -------------------------
    const llmManager = getLLMManager();

    // Build a tool executor that maps tool names → skill.execute()
    const executeToolFn = async (
      toolName: string,
      toolInput: Record<string, unknown>,
    ): Promise<string> => {
      // Map tool definition names back to skill names
      const skill = enabledSkills.find(
        (s) => s.getToolDefinition().name === toolName,
      );

      if (!skill) {
        return `Unknown tool: "${toolName}". Available tools: ${enabledSkills.map((s) => s.getToolDefinition().name).join(', ')}`;
      }

      logger.info(`Tool call: ${toolName}`, { requestId, input: JSON.stringify(toolInput).slice(0, 200) });

      // Inject userId and chatId for skills that need them
      const params: Record<string, unknown> = {
        ...toolInput,
        userId: userProfile.id,
        chatId: String(ctx.chat?.id ?? ctx.from!.id),
      };

      const result = await skill.execute(params);
      return result.text;
    };

    let assistantReply: string;

    if (toolDefinitions.length > 0) {
      // Use the agentic tool-use loop
      const response = await llmManager.chatWithTools(
        llmMessages,
        systemPrompt,
        { maxTokens: 4096, temperature: 0.7 },
        toolDefinitions,
        executeToolFn,
      );
      assistantReply = response.content.trim();
    } else {
      // No tools available — simple text completion
      const response = await llmManager.generateResponse(
        llmMessages,
        systemPrompt,
        { maxTokens: 2048, temperature: 0.7 },
      );
      assistantReply = response.content.trim();
    }

    // ---- 7. Save interaction to memory ------------------------------------
    await memoryManager.saveInteraction(userProfile.id, userText, assistantReply);

    // ---- 8. Send reply ----------------------------------------------------
    typingStop();
    await sendReply(ctx, assistantReply);

  } catch (err) {
    typingStop();
    logger.error('Error processing message', { requestId, error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });
    await sendErrorReply(ctx, err);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Send a reply, splitting into multiple messages if it exceeds Telegram's
 * 4096-character limit.  Tries Markdown first, falls back to plain text.
 */
async function sendReply(ctx: Context, text: string): Promise<void> {
  if (!text) {
    await ctx.reply("I seem to have lost my train of thought. Could you say that again?");
    return;
  }

  const chunks = splitMessage(text, MAX_TELEGRAM_MESSAGE_LENGTH);

  for (const chunk of chunks) {
    try {
      await ctx.reply(chunk, { parse_mode: 'Markdown' });
    } catch (markdownErr) {
      // Markdown parsing failed — retry as plain text
      logger.warn('Markdown parse failed, falling back to plain text');
      try {
        await ctx.reply(stripMarkdown(chunk));
      } catch (plainErr) {
        logger.error('Failed to send plain text reply', { error: plainErr instanceof Error ? plainErr.message : String(plainErr) });
      }
    }
  }
}

/**
 * Send a friendly error message to the user.
 */
async function sendErrorReply(ctx: Context, err: unknown): Promise<void> {
  let userMessage: string;

  if (err instanceof RateLimitError) {
    userMessage = "⏳ I'm a bit overwhelmed right now. Please wait a moment and try again.";
  } else if (err instanceof ExternalServiceError) {
    const msg = err.message;
    if (msg.includes('API key') || msg.includes('authentication')) {
      userMessage = "⚙️ I'm having trouble connecting to my AI brain. Please contact the administrator.";
    } else if (msg.includes('overloaded') || msg.includes('rate_limit')) {
      userMessage = "⏳ I'm a bit overwhelmed right now. Please wait a moment and try again.";
    } else {
      userMessage = "😕 Something went wrong while processing your message. Please try again in a moment.";
    }
  } else if (err instanceof AppError) {
    userMessage = `😕 ${err.message}`;
  } else {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('context_length') || message.includes('too many tokens')) {
      userMessage = "📏 Our conversation has grown quite long! Try using /clear to start fresh.";
    } else {
      userMessage =
        "😕 Something went wrong while processing your message. Please try again in a moment.\n\n" +
        "_If the problem persists, try /clear to reset the conversation._";
    }
  }

  try {
    await ctx.reply(userMessage, { parse_mode: 'Markdown' });
  } catch {
    await ctx.reply(userMessage.replace(/[_*[\]()~`>#+\-=|{}.!]/g, ''));
  }
}

/**
 * Shows a typing indicator while the LLM is processing.
 * Re-sends every TYPING_REFRESH_MS because Telegram automatically clears it.
 * Returns a cancel function.
 */
function startTypingIndicator(ctx: Context): () => void {
  let active = true;

  const send = (): void => {
    if (!active) return;
    ctx.replyWithChatAction('typing').catch(() => {
      // Ignore errors from the typing indicator — non-critical
    });
  };

  send(); // Send immediately

  const interval = setInterval(send, TYPING_REFRESH_MS);

  return (): void => {
    active = false;
    clearInterval(interval);
  };
}

/**
 * Split a message into chunks at natural line breaks, staying under maxLen.
 */
function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    // Look for a paragraph break first, then a line break
    let splitAt = remaining.lastIndexOf('\n\n', maxLen);
    if (splitAt <= 0) {
      splitAt = remaining.lastIndexOf('\n', maxLen);
    }
    if (splitAt <= 0) {
      // No newline — split at the last space
      splitAt = remaining.lastIndexOf(' ', maxLen);
    }
    if (splitAt <= 0) {
      // No space — hard split
      splitAt = maxLen;
    }

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

/** Strip common Markdown formatting for plain-text fallback. */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`{3}[\s\S]*?`{3}/g, (m) => m.replace(/`/g, ''))
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\\([_*[\]()~`>#+\-=|{}.!\\])/g, '$1');
}
