# Telegram AI Assistant

A personal AI assistant for Telegram powered by Anthropic's Claude. Features long-term memory, an extensible skill/plugin system, and an agentic tool-use loop that lets Claude autonomously invoke skills (web search, weather, todos, reminders) during conversation.

## Features

- **Conversational AI** — Natural conversation powered by Claude with configurable personality
- **Agentic Tool Use** — Claude autonomously decides when to call skills (search the web, check weather, etc.) and loops until it has a complete answer
- **Long-Term Memory** — Automatically extracts and recalls facts about the user across conversations
- **Short-Term Context** — Rolling 20-message window per user for coherent multi-turn dialogue
- **Skills / Plugins** — Modular skill system with enable/disable per skill:
  - **Web Search** — Real-time web search via Brave Search API
  - **Weather** — Current conditions via OpenWeatherMap
  - **Todos** — Personal task list with priorities
  - **Reminders** — One-off and recurring reminders with natural language time parsing
- **Admin Dashboard** — React web UI for managing users, memories, personality, skills, and conversations
- **Rate Limiting** — Per-user sliding window (30 msgs / 60s)
- **Docker Ready** — Multi-stage Dockerfile and docker-compose for one-command deployment

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Telegram User                        │
└────────────────────────┬────────────────────────────────┘
                         │  Messages
                         ▼
┌─────────────────────────────────────────────────────────┐
│                   Grammy Bot Layer                       │
│  ┌──────────┐  ┌────────────┐  ┌─────────────────────┐ │
│  │ Logging  │→ │ Rate Limit │→ │ Auth (auto-upsert)  │ │
│  └──────────┘  └────────────┘  └─────────────────────┘ │
│                         │                               │
│           ┌─────────────┼─────────────┐                 │
│           ▼             ▼             ▼                 │
│    /commands      /skill cmds    text messages          │
│   (start,help,   (todo,remind,   (AI flow)             │
│    remember...)   weather,search)                       │
└─────────────────────────┬───────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│              Message Handler (Agentic Loop)              │
│                                                         │
│  1. Load user profile + memory context                  │
│  2. Build system prompt (personality + memories)        │
│  3. Collect enabled skill tool definitions              │
│  4. Call Claude with tools ──┐                          │
│  5. Claude returns tool_use? │                          │
│     YES → execute skill ─────┤  (loop up to 15 rounds) │
│           send tool_result ──┘                          │
│     NO  → return final text                             │
│  6. Save interaction to memory                          │
│  7. Send reply to Telegram                              │
└────────┬──────────────┬─────────────────┬───────────────┘
         │              │                 │
         ▼              ▼                 ▼
┌──────────────┐ ┌─────────────┐ ┌────────────────┐
│  Claude API  │ │Memory System│ │  Skill Registry │
│  (Anthropic) │ │ Short+Long  │ │ todos,reminders │
│              │ │  term + DB  │ │ weather,search  │
└──────────────┘ └──────┬──────┘ └────────────────┘
                        │
                        ▼
                 ┌─────────────┐
                 │   SQLite DB  │
                 │  (WAL mode)  │
                 └─────────────┘

┌─────────────────────────────────────────────────────────┐
│              Admin Dashboard (React + Vite)              │
│  Routes: / /users /memories /personality /skills         │
│          /todos /reminders /conversations                │
│  Connects to Express API on :3000                       │
└─────────────────────────────────────────────────────────┘
```

## Prerequisites

- **Node.js** v20+
- **npm** v9+
- A **Telegram Bot Token** (from [@BotFather](https://t.me/BotFather))
- An **Anthropic API Key** (from [console.anthropic.com](https://console.anthropic.com/))

## Setup

### 1. Clone and install

```bash
git clone <repo-url> telegram-ai-assistant
cd telegram-ai-assistant
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in the required values:

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from @BotFather |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key |
| `CLAUDE_MODEL` | No | Model to use (default: `claude-opus-4-5`) |
| `PORT` | No | Server port (default: `3000`) |
| `NODE_ENV` | No | `development` / `production` / `test` |
| `ADMIN_SECRET` | No | Secret for admin API authentication |
| `BRAVE_SEARCH_API_KEY` | No | Enables the web search skill |
| `OPENWEATHER_API_KEY` | No | Enables the weather skill |
| `DATABASE_PATH` | No | SQLite database path (default: `./data/assistant.db`) |

### 3. Get a Telegram Bot Token

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts
3. Copy the token and set it as `TELEGRAM_BOT_TOKEN` in `.env`

### 4. Get an Anthropic API Key

1. Go to [console.anthropic.com](https://console.anthropic.com/)
2. Create an API key
3. Set it as `ANTHROPIC_API_KEY` in `.env`

## Development

```bash
# Run server and client concurrently with hot reload
npm run dev

# Or run them separately:
npm run dev:server   # Server with tsx watch
npm run dev:client   # Vite dev server
```

The server starts on port 3000 (configurable) and begins Telegram long-polling. The client dev server (Vite) runs on port 5173 by default.

### Build

```bash
npm run build   # Builds shared → server → client in order
npm start       # Run the production server
```

## Docker Deployment

```bash
# Build and run with docker-compose
docker compose up -d

# Or build manually
docker build -t telegram-ai-assistant .
docker run -d \
  --env-file .env \
  -p 3000:3000 \
  -v ./data:/app/data \
  --restart unless-stopped \
  telegram-ai-assistant
```

The SQLite database is persisted via the `./data` volume mount.

## Project Structure

```
telegram-ai-assistant/
├── server/src/
│   ├── index.ts              # Entry point, Express + bot startup
│   ├── config.ts             # Environment variable validation
│   ├── bot/
│   │   ├── index.ts          # Bot factory, middleware & handler registration
│   │   ├── handlers/
│   │   │   ├── commands.ts   # /start, /help, /remember, /forget, /clear, etc.
│   │   │   ├── skills.ts     # /todo, /remind, /weather, /search
│   │   │   └── message.ts    # Core AI handler with agentic tool-use loop
│   │   └── middleware/
│   │       ├── auth.ts       # Auto user upsert + admin guard
│   │       ├── logging.ts    # Request logging
│   │       └── rate-limit.ts # Per-user sliding window rate limiter
│   ├── llm/
│   │   ├── index.ts          # LLMManager singleton + factory
│   │   ├── claude.ts         # ClaudeProvider with tool-use loop
│   │   └── types.ts          # LLMProvider interface, message types
│   ├── memory/
│   │   ├── index.ts          # MemoryManager facade
│   │   ├── short-term.ts     # In-RAM rolling window (20 msgs/user)
│   │   ├── long-term.ts      # Fact extraction + keyword search
│   │   └── user-profile.ts   # User CRUD + preferences
│   ├── personality/
│   │   └── index.ts          # System prompt builder
│   ├── skills/
│   │   ├── base.ts           # BaseSkill abstract class + ToolDefinition
│   │   ├── index.ts          # SkillRegistry singleton
│   │   ├── todos.ts          # Todo list CRUD
│   │   ├── reminders.ts      # One-off + recurring reminders (node-cron)
│   │   ├── weather.ts        # OpenWeatherMap integration
│   │   └── web-search.ts     # Brave Search integration
│   └── db/
│       ├── index.ts          # SQLite connection (better-sqlite3)
│       └── migrations.ts     # Schema + seed data
├── client/src/               # React admin dashboard
│   ├── App.tsx               # Router + layout
│   ├── pages/                # Dashboard, Users, Memories, etc.
│   ├── components/           # Reusable UI components
│   └── api/                  # API client
├── shared/
│   └── types.ts              # Shared TypeScript types
├── Dockerfile                # Multi-stage build
├── docker-compose.yml        # One-command deployment
└── package.json              # Workspace root
```

## How the Agentic Tool-Use Loop Works

When a user sends a message, the handler:

1. Collects all enabled skills and their Anthropic tool definitions
2. Sends the conversation + tool definitions to Claude
3. If Claude responds with `tool_use` blocks, the handler:
   - Executes the corresponding skill's `execute()` method
   - Sends the result back to Claude as a `tool_result`
   - Repeats (up to 15 rounds) until Claude gives a final text response
4. The final text is sent to the user

This means Claude can autonomously chain multiple tool calls. For example, if a user asks "What's the weather like in London and remind me to pack an umbrella tomorrow at 8am", Claude will call the weather skill, then the reminder skill, and compose a single response with both results.

## Adding a New Skill

1. Create a new file in `server/src/skills/`:

```typescript
import { BaseSkill, type SkillResult } from './base.js';

export class MySkill extends BaseSkill {
  readonly name = 'my-skill';
  readonly description = 'Does something useful.';

  getToolDefinition() {
    return {
      name: 'my_skill',
      description: 'Description for Claude — when should it use this tool?',
      input_schema: {
        type: 'object' as const,
        properties: {
          param1: {
            type: 'string',
            description: 'What this parameter does.',
          },
        },
        required: ['param1'],
      },
    };
  }

  async execute(params: Record<string, unknown>): Promise<SkillResult> {
    const param1 = typeof params['param1'] === 'string' ? params['param1'] : '';
    // ... your logic ...
    return this.success('Result text shown to Claude and user');
  }
}
```

2. Register it in `server/src/skills/index.ts`:

```typescript
import { MySkill } from './my-skill.js';

// Inside initBuiltins():
this.register(new MySkill());
```

3. (Optional) Add a `/myskill` command handler in `server/src/bot/handlers/skills.ts` for direct invocation.

The skill will automatically be available to Claude in the agentic loop — no further wiring needed.

## Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message and profile creation |
| `/help` | Show all commands |
| `/clear` | Reset conversation context |
| `/profile` | View your profile and stats |
| `/remember <text>` | Save a fact to long-term memory |
| `/forget` | List and delete memories |
| `/todo add\|list\|done\|remove` | Manage your todo list |
| `/remind <time> <text>` | Set a reminder |
| `/weather <city>` | Current weather conditions |
| `/search <query>` | Web search |
| `/skills` | List available skills |

## Screenshots

<!-- TODO: Add screenshots -->
<!-- ![Dashboard](docs/screenshots/dashboard.png) -->
<!-- ![Conversation](docs/screenshots/conversation.png) -->
<!-- ![Skills](docs/screenshots/skills.png) -->

## License

MIT
