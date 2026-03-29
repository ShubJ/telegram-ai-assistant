import { Router, type Request, type Response } from 'express';
import { getDb } from '../../db/index.js';
import { createLogger } from '../../logger.js';

const logger = createLogger('API:Skills');

const router = Router();

const SKILLS_KEY = 'skills_config';

// ---------------------------------------------------------------------------
// Default skill definitions
// These represent the available skills in the bot. Actual enablement/config
// is stored in the settings table under SKILLS_KEY as a JSON map.
// ---------------------------------------------------------------------------
const DEFAULT_SKILLS: Record<string, SkillDefinition> = {
  weather: {
    name: 'weather',
    displayName: 'Weather',
    description: 'Fetch current weather and forecasts',
    enabled: true,
    config: {},
  },
  reminders: {
    name: 'reminders',
    displayName: 'Reminders',
    description: 'Set and manage reminders',
    enabled: true,
    config: {},
  },
  todos: {
    name: 'todos',
    displayName: 'To-Do List',
    description: 'Manage tasks and to-do items',
    enabled: true,
    config: {},
  },
  web_search: {
    name: 'web_search',
    displayName: 'Web Search',
    description: 'Search the web for information',
    enabled: false,
    config: {},
  },
  image_generation: {
    name: 'image_generation',
    displayName: 'Image Generation',
    description: 'Generate images from text prompts',
    enabled: false,
    config: {},
  },
  code_execution: {
    name: 'code_execution',
    displayName: 'Code Execution',
    description: 'Execute code snippets in a sandbox',
    enabled: false,
    config: {},
  },
  news: {
    name: 'news',
    displayName: 'News',
    description: 'Fetch latest news headlines',
    enabled: true,
    config: {},
  },
  calculator: {
    name: 'calculator',
    displayName: 'Calculator',
    description: 'Perform mathematical calculations',
    enabled: true,
    config: {},
  },
};

interface SkillDefinition {
  name: string;
  displayName: string;
  description: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helper: load merged skill state from DB
// ---------------------------------------------------------------------------
function loadSkills(db: ReturnType<typeof getDb>): Record<string, SkillDefinition> {
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(SKILLS_KEY) as { value: string } | undefined;

  if (!row) {
    return structuredClone(DEFAULT_SKILLS);
  }

  try {
    const stored = JSON.parse(row.value) as Record<string, Partial<SkillDefinition>>;
    // Merge stored overrides onto defaults so new skills always appear
    const merged: Record<string, SkillDefinition> = structuredClone(DEFAULT_SKILLS);

    for (const [name, override] of Object.entries(stored)) {
      if (merged[name]) {
        merged[name] = { ...merged[name], ...override, name };
      } else {
        // Custom/unknown skill stored in DB — keep it
        merged[name] = {
          name,
          displayName: override.displayName ?? name,
          description: override.description ?? '',
          enabled: override.enabled ?? false,
          config: override.config ?? {},
        };
      }
    }

    return merged;
  } catch {
    return structuredClone(DEFAULT_SKILLS);
  }
}

// ---------------------------------------------------------------------------
// Helper: persist skills state
// ---------------------------------------------------------------------------
function saveSkills(
  db: ReturnType<typeof getDb>,
  skills: Record<string, SkillDefinition>,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `,
  ).run(SKILLS_KEY, JSON.stringify(skills), now);
}

// ---------------------------------------------------------------------------
// GET /api/skills
// List all skills with their enabled status and configuration
// ---------------------------------------------------------------------------
router.get('/', (_req: Request, res: Response): void => {
  try {
    const db = getDb();
    const skills = loadSkills(db);
    res.json({ data: Object.values(skills) });
  } catch (err) {
    logger.error('[skills] GET / error', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to fetch skills' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/skills/:name
// Update a skill: enable/disable and/or update config
// Body: { enabled?: boolean, config?: object, displayName?: string, description?: string }
// ---------------------------------------------------------------------------
router.put('/:name', (req: Request, res: Response): void => {
  try {
    const db = getDb();
    const { name } = req.params;

    if (!name || name.trim().length === 0) {
      res.status(400).json({ error: 'Skill name is required' });
      return;
    }

    const skills = loadSkills(db);

    // If the skill is not in our known list, return 404
    if (!skills[name]) {
      res.status(404).json({ error: `Skill '${name}' not found` });
      return;
    }

    const { enabled, config, displayName, description } = req.body as {
      enabled?: boolean;
      config?: Record<string, unknown>;
      displayName?: string;
      description?: string;
    };

    if (
      enabled === undefined &&
      config === undefined &&
      displayName === undefined &&
      description === undefined
    ) {
      res.status(400).json({ error: 'No valid fields to update' });
      return;
    }

    if (enabled !== undefined && typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean' });
      return;
    }

    if (
      config !== undefined &&
      (typeof config !== 'object' || config === null || Array.isArray(config))
    ) {
      res.status(400).json({ error: 'config must be an object' });
      return;
    }

    if (displayName !== undefined && (typeof displayName !== 'string' || !displayName.trim())) {
      res.status(400).json({ error: 'displayName must be a non-empty string' });
      return;
    }

    if (description !== undefined && typeof description !== 'string') {
      res.status(400).json({ error: 'description must be a string' });
      return;
    }

    // Apply updates
    const skill = skills[name]!;

    if (enabled !== undefined) skill.enabled = enabled;
    if (config !== undefined) skill.config = { ...skill.config, ...config };
    if (displayName !== undefined) skill.displayName = displayName.trim();
    if (description !== undefined) skill.description = description;

    saveSkills(db, skills);

    res.json(skill);
  } catch (err) {
    logger.error('[skills] PUT /:name error', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to update skill' });
  }
});

export default router;
