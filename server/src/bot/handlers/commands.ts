/**
 * Command handlers for the Telegram bot.
 *
 * Each exported function handles a single slash command.
 * All handlers receive a Grammy Context object.
 *
 * Commands:
 *  /start   — welcome message, create/get user profile
 *  /help    — list all commands with descriptions
 *  /remember <text> — save a memory manually
 *  /forget [id]     — delete a memory
 *  /clear           — clear conversation context
 *  /skills          — list available skills and status
 *  /profile         — show user profile info
 *  /project <desc>  — start a new agent-driven project
 *  /task <repo> <desc> — add feature/fix to existing repo
 *  /agents          — agent system status & management
 */

import type { Context } from 'grammy';
import { createLogger } from '../../logger.js';
import { getMemoryManager } from '../../memory/index.js';

const logger = createLogger('Commands');
import { getPersonalityManager } from '../../personality/index.js';
import { skillRegistry } from '../../skills/index.js';
import { upsertUser } from '../middleware/auth.js';
import type { Memory } from '../../memory/index.js';
import { getOrchestrator } from '../../agents/index.js';

// ---------------------------------------------------------------------------
// /start
// ---------------------------------------------------------------------------

export async function handleStart(ctx: Context): Promise<void> {
  if (!ctx.from) {
    await ctx.reply('Hello! I need to know who you are to get started.');
    return;
  }

  // Ensure user profile exists
  const user = upsertUser(ctx.from);
  const memoryManager = getMemoryManager();
  const personalityManager = getPersonalityManager();
  const personality = personalityManager.getPersonality();

  // Get or create user in the profile system
  memoryManager.userProfile.getOrCreateUser(
    String(ctx.from.id),
    ctx.from.username,
    ctx.from.first_name,
  );

  const name = user.first_name ?? user.username ?? 'there';
  const isNew = !memoryManager.userProfile.getUserByTelegramId(String(ctx.from.id))?.createdAt
    ? false
    : true;

  const greeting = isNew
    ? `👋 Welcome back, *${escapeMd(name)}*\\!`
    : `👋 Hello, *${escapeMd(name)}*\\! Nice to meet you\\!`;

  const message = [
    greeting,
    '',
    `I'm *${escapeMd(personality.name)}* — your personal AI assistant\\. I can help you with:`,
    '',
    '• 💬 Answering questions and having conversations',
    '• 🧠 Remembering things about you across sessions',
    '• ✅ Managing your to\\-do list',
    '• ⏰ Setting reminders',
    '• 🌤️ Checking the weather',
    '• 🔍 Searching the web',
    '',
    'Just send me a message to get started, or use /help to see all commands\\.',
  ].join('\n');

  await ctx.reply(message, { parse_mode: 'MarkdownV2' });
}

// ---------------------------------------------------------------------------
// /help
// ---------------------------------------------------------------------------

export async function handleHelp(ctx: Context): Promise<void> {
  const message = [
    '*Available Commands*',
    '',
    '🗣️ *Conversations*',
    '/start \\- Start or re\\-introduce yourself',
    '/help \\- Show this help message',
    '/clear \\- Clear conversation context \\(start fresh\\)',
    '/profile \\- View your profile information',
    '',
    '🧠 *Memory*',
    '/remember \\<text\\> \\- Save a fact to memory',
    '/forget \\[id\\] \\- Show or delete memories',
    '',
    '✅ *To\\-Do List*',
    '/todo add \\<text\\> \\- Add a new todo',
    '/todo list \\- Show pending todos',
    '/todo done \\<id\\> \\- Mark a todo as done',
    '/todo remove \\<id\\> \\- Delete a todo',
    '',
    '⏰ *Reminders*',
    '/remind \\<time\\> \\<text\\> \\- Set a reminder',
    '/remind list \\- Show active reminders',
    '/remind remove \\<id\\> \\- Cancel a reminder',
    '',
    '_Time examples: "in 10 minutes", "tomorrow at 9am", "every day at 8:00"_',
    '',
    '🌤️ *Other Skills*',
    '/weather \\<city\\> \\- Get current weather',
    '/search \\<query\\> \\- Search the web',
    '/skills \\- List all available skills',
    '',
    '💡 _Tip: You can also just chat with me naturally\\!_',
  ].join('\n');

  await ctx.reply(message, { parse_mode: 'MarkdownV2' });
}

// ---------------------------------------------------------------------------
// /remember
// ---------------------------------------------------------------------------

export async function handleRemember(ctx: Context): Promise<void> {
  if (!ctx.from) {
    await ctx.reply('Could not identify you. Please try again.');
    return;
  }

  const rawText = ctx.message?.text ?? '';
  // Strip the command prefix (/remember or /remember@botname)
  const text = rawText.replace(/^\/remember(?:@\S+)?\s*/i, '').trim();

  if (!text) {
    await ctx.reply(
      '📝 Please tell me what to remember\\!\n\nUsage: /remember \\<your text here\\>',
      { parse_mode: 'MarkdownV2' },
    );
    return;
  }

  try {
    const memoryManager = getMemoryManager();
    const userProfile = memoryManager.userProfile.getOrCreateUser(
      String(ctx.from.id),
      ctx.from.username,
      ctx.from.first_name,
    );

    const memory = memoryManager.addMemory(userProfile.id, 'note', text, 8);

    await ctx.reply(
      `✅ Got it\\! I'll remember:\n\n_"${escapeMd(memory.content)}"_\n\nID: \`${memory.id.slice(0, 8)}\``,
      { parse_mode: 'MarkdownV2' },
    );
  } catch (err) {
    logger.error('handleRemember failed', { error: err instanceof Error ? err.message : String(err) });
    await ctx.reply('❌ Sorry, I had trouble saving that memory. Please try again.');
  }
}

// ---------------------------------------------------------------------------
// /forget
// ---------------------------------------------------------------------------

export async function handleForget(ctx: Context): Promise<void> {
  if (!ctx.from) {
    await ctx.reply('Could not identify you. Please try again.');
    return;
  }

  const rawText = ctx.message?.text ?? '';
  const arg = rawText.replace(/^\/forget(?:@\S+)?\s*/i, '').trim();

  try {
    const memoryManager = getMemoryManager();
    const userProfile = memoryManager.userProfile.getOrCreateUser(
      String(ctx.from.id),
      ctx.from.username,
      ctx.from.first_name,
    );

    if (arg) {
      // Delete specific memory by id prefix
      const allMemories = memoryManager.getAllMemories(userProfile.id);
      const target = allMemories.find(
        (m) => m.id === arg || m.id.startsWith(arg),
      );

      if (!target) {
        await ctx.reply(
          `❌ No memory found with ID starting with \`${escapeMd(arg)}\`\\.\n\nUse /forget without arguments to see your memories\\.`,
          { parse_mode: 'MarkdownV2' },
        );
        return;
      }

      const deleted = memoryManager.removeMemory(target.id);
      if (deleted) {
        await ctx.reply(
          `🗑️ Forgotten: _"${escapeMd(target.content)}"_`,
          { parse_mode: 'MarkdownV2' },
        );
      } else {
        await ctx.reply('❌ Could not delete that memory. Please try again.');
      }
      return;
    }

    // No arg — show recent memories
    const memories = memoryManager.getAllMemories(userProfile.id).slice(0, 10);

    if (memories.length === 0) {
      await ctx.reply(
        "🧠 I don't have any stored memories for you yet\\.\n\nUse /remember \\<text\\> to save something\\!",
        { parse_mode: 'MarkdownV2' },
      );
      return;
    }

    const lines = [
      '*Your Memories* \\(most recent first\\):',
      '',
      ...memories.map((m: Memory) => {
        const shortId = m.id.slice(0, 8);
        const typeEmoji = memoryTypeEmoji(m.type);
        return `${typeEmoji} \`${shortId}\` _${escapeMd(truncate(m.content, 80))}_`;
      }),
      '',
      'To delete a memory: /forget \\<id\\>',
    ];

    await ctx.reply(lines.join('\n'), { parse_mode: 'MarkdownV2' });
  } catch (err) {
    logger.error('handleForget failed', { error: err instanceof Error ? err.message : String(err) });
    await ctx.reply('❌ Sorry, I had trouble accessing your memories. Please try again.');
  }
}

// ---------------------------------------------------------------------------
// /clear
// ---------------------------------------------------------------------------

export async function handleClear(ctx: Context): Promise<void> {
  if (!ctx.from) {
    await ctx.reply('Could not identify you. Please try again.');
    return;
  }

  try {
    const memoryManager = getMemoryManager();
    const userProfile = memoryManager.userProfile.getOrCreateUser(
      String(ctx.from.id),
      ctx.from.username,
      ctx.from.first_name,
    );

    memoryManager.clearContext(userProfile.id);

    await ctx.reply(
      '🧹 Conversation context cleared! I\'ve forgotten our recent chat, but your saved memories are still intact.\n\nSend me a message to start fresh.',
    );
  } catch (err) {
    logger.error('handleClear failed', { error: err instanceof Error ? err.message : String(err) });
    await ctx.reply('❌ Sorry, I had trouble clearing the context. Please try again.');
  }
}

// ---------------------------------------------------------------------------
// /skills
// ---------------------------------------------------------------------------

export async function handleSkills(ctx: Context): Promise<void> {
  const skills = skillRegistry.listAll();

  if (skills.length === 0) {
    await ctx.reply('No skills are currently registered.');
    return;
  }

  const lines = ['*Available Skills:*', ''];

  for (const skill of skills) {
    const enabled = skill.isEnabled();
    const status = enabled ? '✅' : '❌';
    lines.push(`${status} *${escapeMd(skill.name)}*`);
    lines.push(`   _${escapeMd(skill.description)}_`);
    lines.push('');
  }

  lines.push('_✅ enabled  ❌ disabled_');

  await ctx.reply(lines.join('\n'), { parse_mode: 'MarkdownV2' });
}

// ---------------------------------------------------------------------------
// /profile
// ---------------------------------------------------------------------------

export async function handleProfile(ctx: Context): Promise<void> {
  if (!ctx.from) {
    await ctx.reply('Could not identify you. Please try again.');
    return;
  }

  try {
    const memoryManager = getMemoryManager();
    const user = memoryManager.userProfile.getOrCreateUser(
      String(ctx.from.id),
      ctx.from.username,
      ctx.from.first_name,
    );

    const name = [user.firstName].filter(Boolean).join(' ') || 'Not set';
    const username = user.username ? `@${user.username}` : 'Not set';
    const timezone = user.timezone || 'UTC';
    const memCount = memoryManager.getAllMemories(user.id).length;
    const joinDate = new Date(user.createdAt).toLocaleDateString('en-GB', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const prefEntries = Object.entries(user.preferences ?? {})
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `  • ${escapeMd(k)}: ${escapeMd(String(v))}`);

    const lines = [
      '*Your Profile*',
      '',
      `👤 *Name:* ${escapeMd(name)}`,
      `📱 *Username:* ${escapeMd(username)}`,
      `🌍 *Timezone:* ${escapeMd(timezone)}`,
      `🧠 *Memories:* ${memCount} stored`,
      `📅 *Member since:* ${escapeMd(joinDate)}`,
    ];

    if (prefEntries.length > 0) {
      lines.push('');
      lines.push('*Preferences:*');
      lines.push(...prefEntries);
    }

    lines.push('');
    lines.push('_Your long\\-term memories are not shown here — use /forget to manage them\\._');

    await ctx.reply(lines.join('\n'), { parse_mode: 'MarkdownV2' });
  } catch (err) {
    logger.error('handleProfile failed', { error: err instanceof Error ? err.message : String(err) });
    await ctx.reply('❌ Sorry, I had trouble loading your profile. Please try again.');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Escape all MarkdownV2 special characters. */
export function escapeMd(text: string): string {
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

function truncate(text: string, maxLen: number): string {
  return text.length <= maxLen ? text : text.slice(0, maxLen - 1) + '…';
}

function memoryTypeEmoji(type: string): string {
  switch (type) {
    case 'fact': return '📌';
    case 'preference': return '💡';
    case 'note': return '📝';
    case 'context': return '🗂️';
    case 'skill': return '🛠️';
    default: return '🧠';
  }
}

// ---------------------------------------------------------------------------
// /project <description>
// ---------------------------------------------------------------------------

export async function handleProject(ctx: Context): Promise<void> {
  if (!ctx.from) {
    await ctx.reply('Could not identify you. Please try again.');
    return;
  }

  const rawText = ctx.message?.text ?? '';
  const description = rawText.replace(/^\/project(?:@\S+)?\s*/i, '').trim();

  if (!description) {
    await ctx.reply(
      '🏗️ Start a new project with the multi-agent system.\n\n' +
      'Usage: /project <description>\n\n' +
      'Example: /project Build a REST API for a todo app with authentication',
    );
    return;
  }

  try {
    const memoryManager = getMemoryManager();
    const userProfile = memoryManager.userProfile.getOrCreateUser(
      String(ctx.from.id), ctx.from.username, ctx.from.first_name,
    );
    const chatId = String(ctx.chat?.id ?? ctx.from.id);
    const orchestrator = getOrchestrator();
    const projectId = await orchestrator.startProject(userProfile.id, description, chatId);
    await ctx.reply(
      `🚀 Project started! ID: \`${projectId.slice(0, 8)}\`\n\n` +
      `I'll send progress updates as each agent completes its phase.\n` +
      `Use /agents status ${projectId.slice(0, 8)} to check progress.`,
      { parse_mode: 'Markdown' },
    );
  } catch (err) {
    logger.error('handleProject failed', { error: err instanceof Error ? err.message : String(err) });
    await ctx.reply('❌ Failed to start project. Please try again.');
  }
}

// ---------------------------------------------------------------------------
// /task <repo-path> <description>
// ---------------------------------------------------------------------------

export async function handleTask(ctx: Context): Promise<void> {
  if (!ctx.from) {
    await ctx.reply('Could not identify you. Please try again.');
    return;
  }

  const rawText = ctx.message?.text ?? '';
  const args = rawText.replace(/^\/task(?:@\S+)?\s*/i, '').trim();

  if (!args) {
    await ctx.reply(
      '🔧 Add a feature or fix to an existing project.\n\n' +
      'Usage: /task <repo-path> <description>\n\n' +
      'Example: /task ~/Projects/my-app Add dark mode support',
    );
    return;
  }

  // Split: first word is repo path, rest is description
  const spaceIdx = args.indexOf(' ');
  if (spaceIdx === -1) {
    await ctx.reply('Please provide both a repo path and a description.\n\nUsage: /task <repo-path> <description>');
    return;
  }

  const repoPath = args.slice(0, spaceIdx).trim();
  const description = args.slice(spaceIdx + 1).trim();

  try {
    const memoryManager = getMemoryManager();
    const userProfile = memoryManager.userProfile.getOrCreateUser(
      String(ctx.from.id), ctx.from.username, ctx.from.first_name,
    );
    const chatId = String(ctx.chat?.id ?? ctx.from.id);
    const orchestrator = getOrchestrator();
    const projectId = await orchestrator.startTask(userProfile.id, repoPath, description, chatId);
    await ctx.reply(
      `🚀 Task started! ID: \`${projectId.slice(0, 8)}\`\n\n` +
      `Working on: ${description}\nRepo: ${repoPath}`,
      { parse_mode: 'Markdown' },
    );
  } catch (err) {
    logger.error('handleTask failed', { error: err instanceof Error ? err.message : String(err) });
    await ctx.reply('❌ Failed to start task. Please try again.');
  }
}

// ---------------------------------------------------------------------------
// /agents [subcommand]
// ---------------------------------------------------------------------------

export async function handleAgents(ctx: Context): Promise<void> {
  if (!ctx.from) {
    await ctx.reply('Could not identify you. Please try again.');
    return;
  }

  const rawText = ctx.message?.text ?? '';
  const args = rawText.replace(/^\/agents(?:@\S+)?\s*/i, '').trim();
  const parts = args.split(/\s+/);
  const subcommand = parts[0]?.toLowerCase() ?? '';

  try {
    const memoryManager = getMemoryManager();
    const userProfile = memoryManager.userProfile.getOrCreateUser(
      String(ctx.from.id), ctx.from.username, ctx.from.first_name,
    );
    const orchestrator = getOrchestrator();

    switch (subcommand) {
      case 'status': {
        const projectId = parts[1] ?? '';
        if (!projectId) {
          await ctx.reply('Usage: /agents status <project-id>');
          return;
        }
        // Find by prefix
        const projects = orchestrator.listProjects(userProfile.id);
        const match = projects.find((p) => p.id.startsWith(projectId));
        if (!match) {
          await ctx.reply(`No project found with ID starting with \`${escapeMd(projectId)}\``, { parse_mode: 'MarkdownV2' });
          return;
        }
        const status = orchestrator.getStatus(match.id);
        if (!status) {
          await ctx.reply('Project not found.');
          return;
        }
        await ctx.reply(
          `📊 *Project Status*\n\n` +
          `ID: \`${status.projectId.slice(0, 8)}\`\n` +
          `Phase: *${status.phase}*\n` +
          `Progress: ${status.progress}\n` +
          `Started: ${new Date(status.startedAt).toLocaleString()}` +
          (status.error ? `\n❌ Error: ${status.error}` : ''),
          { parse_mode: 'Markdown' },
        );
        break;
      }

      case 'cancel': {
        const projectId = parts[1] ?? '';
        if (!projectId) {
          await ctx.reply('Usage: /agents cancel <project-id>');
          return;
        }
        const projects = orchestrator.listProjects(userProfile.id);
        const match = projects.find((p) => p.id.startsWith(projectId));
        if (!match) {
          await ctx.reply('Project not found.');
          return;
        }
        orchestrator.cancelProject(match.id);
        await ctx.reply(`🛑 Project \`${match.id.slice(0, 8)}\` cancelled.`, { parse_mode: 'Markdown' });
        break;
      }

      case 'resume': {
        const projectId = parts[1] ?? '';
        if (!projectId) {
          await ctx.reply('Usage: /agents resume <project-id>');
          return;
        }
        const projects = orchestrator.listProjects(userProfile.id);
        const match = projects.find((p) => p.id.startsWith(projectId));
        if (!match) {
          await ctx.reply('Project not found.');
          return;
        }
        try {
          const chatIdStr = String(ctx.chat?.id ?? ctx.from.id);
          await orchestrator.resumeProject(match.id, chatIdStr);
          await ctx.reply(
            `🔄 Resuming project \`${match.id.slice(0, 8)}\` from phase *${match.status}*.\n\nProgress updates will follow.`,
            { parse_mode: 'Markdown' },
          );
        } catch (err) {
          await ctx.reply(`❌ Cannot resume: ${err instanceof Error ? err.message : String(err)}`);
        }
        break;
      }

      case 'history':
      case 'list': {
        const projects = orchestrator.listProjects(userProfile.id);
        if (projects.length === 0) {
          await ctx.reply('No projects found. Use /project to start one!');
          return;
        }
        const lines = projects.slice(0, 10).map((p) => {
          const icon = p.status === 'COMPLETE' ? '✅' : p.status === 'FAILED' ? '❌' : '⏳';
          return `${icon} \`${p.id.slice(0, 8)}\` *${p.status}*\n   ${p.description.slice(0, 60)}`;
        });
        await ctx.reply(`*Recent Projects:*\n\n${lines.join('\n\n')}`, { parse_mode: 'Markdown' });
        break;
      }

      default: {
        await ctx.reply(
          '🤖 *Agent System Commands*\n\n' +
          '/project <description> — Start a new project\n' +
          '/task <repo> <description> — Feature/fix on existing repo\n' +
          '/agents status <id> — Check project status\n' +
          '/agents cancel <id> — Cancel a running project\n' +
          '/agents resume <id> — Resume a crashed/interrupted project\n' +
          '/agents history — View past projects',
          { parse_mode: 'Markdown' },
        );
      }
    }
  } catch (err) {
    logger.error('handleAgents failed', { error: err instanceof Error ? err.message : String(err) });
    await ctx.reply('❌ An error occurred. Please try again.');
  }
}
