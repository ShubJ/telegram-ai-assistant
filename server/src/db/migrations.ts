import { v4 as uuidv4 } from "uuid";
import { getDb } from "./index.js";
import { createLogger } from "../logger.js";

const logger = createLogger("DB");

// ---------------------------------------------------------------------------
// Table definitions
// ---------------------------------------------------------------------------

const CREATE_USERS = `
  CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    telegram_id  TEXT NOT NULL UNIQUE,
    username     TEXT,
    first_name   TEXT,
    is_admin     INTEGER NOT NULL DEFAULT 0,
    timezone     TEXT    NOT NULL DEFAULT 'UTC',
    preferences  TEXT    NOT NULL DEFAULT '{}',
    created_at   TEXT    NOT NULL,
    updated_at   TEXT    NOT NULL
  )
`;

const CREATE_MESSAGES = `
  CREATE TABLE IF NOT EXISTS messages (
    id        TEXT PRIMARY KEY,
    user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role      TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
    content   TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    metadata  TEXT NOT NULL DEFAULT '{}'
  )
`;

const CREATE_MEMORIES = `
  CREATE TABLE IF NOT EXISTS memories (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type          TEXT NOT NULL,
    content       TEXT NOT NULL,
    importance    INTEGER NOT NULL DEFAULT 5,
    embedding     TEXT,
    created_at    TEXT NOT NULL,
    last_accessed TEXT NOT NULL,
    access_count  INTEGER NOT NULL DEFAULT 0
  )
`;

const CREATE_CONVERSATIONS = `
  CREATE TABLE IF NOT EXISTS conversations (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at      TEXT NOT NULL,
    last_message_at TEXT NOT NULL,
    message_count   INTEGER NOT NULL DEFAULT 0,
    summary         TEXT
  )
`;

const CREATE_REMINDERS = `
  CREATE TABLE IF NOT EXISTS reminders (
    id                TEXT PRIMARY KEY,
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    telegram_chat_id  TEXT NOT NULL,
    text              TEXT NOT NULL,
    fire_at           TEXT,
    cron_expression   TEXT,
    is_recurring      INTEGER NOT NULL DEFAULT 0,
    fired             INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL
  )
`;

const CREATE_TODOS = `
  CREATE TABLE IF NOT EXISTS todos (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text         TEXT NOT NULL,
    priority     TEXT NOT NULL DEFAULT 'medium',
    done         INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    completed_at TEXT
  )
`;

const CREATE_PERSONALITY_CONFIG = `
  CREATE TABLE IF NOT EXISTS personality_config (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    system_prompt  TEXT NOT NULL,
    traits         TEXT NOT NULL DEFAULT '[]',
    tone           TEXT NOT NULL,
    response_style TEXT NOT NULL,
    active         INTEGER NOT NULL DEFAULT 1,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  )
`;

const CREATE_SKILLS_CONFIG = `
  CREATE TABLE IF NOT EXISTS skills_config (
    name    TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 1,
    config  TEXT    NOT NULL DEFAULT '{}'
  )
`;

// ---------------------------------------------------------------------------
// Agent system tables
// ---------------------------------------------------------------------------

const CREATE_AGENT_PROJECTS = `
  CREATE TABLE IF NOT EXISTS agent_projects (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id),
    type            TEXT NOT NULL,
    description     TEXT NOT NULL,
    status          TEXT NOT NULL,
    workspace_path  TEXT,
    github_repo     TEXT,
    github_pr_url   TEXT,
    cost_estimate   REAL,
    actual_cost     REAL NOT NULL DEFAULT 0,
    chat_id         TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL,
    completed_at    TEXT,
    error           TEXT
  )
`;

const CREATE_AGENT_MESSAGES = `
  CREATE TABLE IF NOT EXISTS agent_messages (
    id                TEXT PRIMARY KEY,
    project_id        TEXT NOT NULL REFERENCES agent_projects(id),
    from_role         TEXT NOT NULL,
    from_instance     TEXT,
    to_role           TEXT NOT NULL,
    to_instance       TEXT,
    type              TEXT NOT NULL,
    phase             TEXT NOT NULL,
    content           TEXT NOT NULL,
    files_changed     TEXT,
    parent_message_id TEXT,
    created_at        TEXT NOT NULL
  )
`;

const CREATE_AGENT_FILES = `
  CREATE TABLE IF NOT EXISTS agent_files (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES agent_projects(id),
    file_path   TEXT NOT NULL,
    created_by  TEXT NOT NULL,
    modified_by TEXT,
    content     TEXT NOT NULL,
    version     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  )
`;

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

const INDEXES: string[] = [
  // messages
  "CREATE INDEX IF NOT EXISTS idx_messages_user_id   ON messages(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_messages_timestamp  ON messages(timestamp)",
  "CREATE INDEX IF NOT EXISTS idx_messages_role       ON messages(role)",

  // memories
  "CREATE INDEX IF NOT EXISTS idx_memories_user_id      ON memories(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_memories_type         ON memories(type)",
  "CREATE INDEX IF NOT EXISTS idx_memories_importance   ON memories(importance)",
  "CREATE INDEX IF NOT EXISTS idx_memories_last_accessed ON memories(last_accessed)",

  // conversations
  "CREATE INDEX IF NOT EXISTS idx_conversations_user_id         ON conversations(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at ON conversations(last_message_at)",

  // reminders
  "CREATE INDEX IF NOT EXISTS idx_reminders_user_id ON reminders(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_reminders_fired   ON reminders(fired)",

  // todos
  "CREATE INDEX IF NOT EXISTS idx_todos_user_id ON todos(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_todos_done    ON todos(done)",

  // agent_projects
  "CREATE INDEX IF NOT EXISTS idx_agent_projects_user_id ON agent_projects(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_agent_projects_status  ON agent_projects(status)",

  // agent_messages
  "CREATE INDEX IF NOT EXISTS idx_agent_messages_project_id ON agent_messages(project_id)",
  "CREATE INDEX IF NOT EXISTS idx_agent_messages_to_role    ON agent_messages(to_role)",
  "CREATE INDEX IF NOT EXISTS idx_agent_messages_created_at ON agent_messages(created_at)",

  // agent_files
  "CREATE INDEX IF NOT EXISTS idx_agent_files_project_id ON agent_files(project_id)",

  // users
  "CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id)",
  "CREATE INDEX IF NOT EXISTS idx_users_is_admin    ON users(is_admin)",
];

// ---------------------------------------------------------------------------
// Default data
// ---------------------------------------------------------------------------

const DEFAULT_PERSONALITY_SYSTEM_PROMPT = `You are Atlas, a highly capable and personable AI assistant. You are:

- **Helpful**: You proactively assist users in completing their tasks, answering questions thoroughly, and offering relevant follow-up information.
- **Friendly**: You maintain a warm, approachable tone while remaining professional. You address users by name when appropriate.
- **Honest**: You acknowledge when you don't know something rather than guessing. You express uncertainty clearly.
- **Concise**: You provide focused responses that directly address what the user needs, avoiding unnecessary verbosity.
- **Proactive**: You notice opportunities to be helpful beyond the immediate request — suggesting reminders, offering to save important information to memory, or flagging potential issues.

You have access to various tools: web search, weather lookups, reminders, to-do lists, and persistent memory. Use them wisely to deliver the best possible experience.

Always respond in the same language the user writes in. Format responses using Markdown when it improves readability, but keep plain text for simple conversational exchanges.`;

const DEFAULT_SKILLS: Array<{ name: string; enabled: number; config: string }> =
  [
    { name: "web_search", enabled: 1, config: JSON.stringify({ maxResults: 5 }) },
    {
      name: "weather",
      enabled: 1,
      config: JSON.stringify({ units: "metric" }),
    },
    {
      name: "reminders",
      enabled: 1,
      config: JSON.stringify({ maxPerUser: 20 }),
    },
    { name: "todos", enabled: 1, config: JSON.stringify({ maxPerUser: 100 }) },
    {
      name: "memory",
      enabled: 1,
      config: JSON.stringify({ maxMemoriesPerUser: 500, importanceThreshold: 3 }),
    },
    {
      name: "code_execution",
      enabled: 0,
      config: JSON.stringify({ timeout: 5000 }),
    },
    {
      name: "image_generation",
      enabled: 0,
      config: JSON.stringify({}),
    },
  ];

// ---------------------------------------------------------------------------
// Migration runner
// ---------------------------------------------------------------------------

export function runMigrations(): void {
  const db = getDb();

  logger.info("Running migrations...");

  // Wrap everything in a single transaction for atomicity
  const migrate = db.transaction(() => {
    // 1. Create tables
    db.exec(CREATE_USERS);
    db.exec(CREATE_MESSAGES);
    db.exec(CREATE_MEMORIES);
    db.exec(CREATE_CONVERSATIONS);
    db.exec(CREATE_REMINDERS);
    db.exec(CREATE_TODOS);
    db.exec(CREATE_PERSONALITY_CONFIG);
    db.exec(CREATE_SKILLS_CONFIG);

    // Agent system tables
    db.exec(CREATE_AGENT_PROJECTS);
    db.exec(CREATE_AGENT_MESSAGES);
    db.exec(CREATE_AGENT_FILES);

    // Migration: add source_repo_path column for workspace isolation
    try {
      db.exec('ALTER TABLE agent_projects ADD COLUMN source_repo_path TEXT');
    } catch {
      // Column already exists — ignore
    }

    // 2. Create indexes
    for (const indexSql of INDEXES) {
      db.exec(indexSql);
    }

    // 3. Seed default personality (only if table is empty)
    const personalityCount = (
      db.prepare("SELECT COUNT(*) AS count FROM personality_config").get() as {
        count: number;
      }
    ).count;

    if (personalityCount === 0) {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO personality_config
           (id, name, system_prompt, traits, tone, response_style, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
      ).run(
        uuidv4(),
        "Atlas",
        DEFAULT_PERSONALITY_SYSTEM_PROMPT,
        JSON.stringify([
          "helpful",
          "friendly",
          "honest",
          "concise",
          "proactive",
        ]),
        "warm and professional",
        "conversational with markdown formatting when appropriate",
        now,
        now
      );
      logger.info("Default personality 'Atlas' inserted.");
    }

    // 4. Seed default skills (INSERT OR IGNORE to be idempotent)
    const insertSkill = db.prepare(
      `INSERT OR IGNORE INTO skills_config (name, enabled, config) VALUES (?, ?, ?)`
    );
    for (const skill of DEFAULT_SKILLS) {
      insertSkill.run(skill.name, skill.enabled, skill.config);
    }
    logger.info("Default skills seeded.");
  });

  migrate();

  logger.info("Migrations completed successfully.");
}

// ---------------------------------------------------------------------------
// Schema inspection helpers (useful for debugging / admin API)
// ---------------------------------------------------------------------------

export interface TableInfo {
  name: string;
  rowCount: number;
}

export function getTableInfo(): TableInfo[] {
  const db = getDb();
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    )
    .all() as Array<{ name: string }>;

  return tables.map(({ name }) => {
    const result = db
      .prepare(`SELECT COUNT(*) AS count FROM "${name}"`)
      .get() as { count: number };
    return { name, rowCount: result.count };
  });
}
