import { Router, type Request, type Response } from 'express';
import { getDb } from '../../db/index.js';
import { createLogger } from '../../logger.js';

const logger = createLogger('API:Personality');

const router = Router();

const PERSONALITY_KEY = 'personality_config';

// Default personality configuration
const DEFAULT_PERSONALITY = {
  name: 'Assistant',
  tone: 'friendly',
  verbosity: 'balanced',
  language: 'en',
  traits: ['helpful', 'concise', 'professional'],
  systemPromptExtra: '',
  emojiUsage: 'moderate',
  formality: 'casual',
};

// ---------------------------------------------------------------------------
// Helper: read personality from the key-value settings table
// ---------------------------------------------------------------------------
function getPersonality(db: ReturnType<typeof getDb>): Record<string, unknown> {
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(PERSONALITY_KEY) as { value: string } | undefined;

  if (!row) {
    return { ...DEFAULT_PERSONALITY };
  }

  try {
    return JSON.parse(row.value) as Record<string, unknown>;
  } catch {
    return { ...DEFAULT_PERSONALITY };
  }
}

// ---------------------------------------------------------------------------
// Helper: persist personality to the settings table (upsert)
// ---------------------------------------------------------------------------
function savePersonality(db: ReturnType<typeof getDb>, config: Record<string, unknown>): void {
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `,
  ).run(PERSONALITY_KEY, JSON.stringify(config), now);
}

// ---------------------------------------------------------------------------
// GET /api/personality
// Return the current personality configuration
// ---------------------------------------------------------------------------
router.get('/', (_req: Request, res: Response): void => {
  try {
    const db = getDb();
    const personality = getPersonality(db);
    res.json(personality);
  } catch (err) {
    logger.error('[personality] GET / error', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to fetch personality config' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/personality
// Merge-update the personality configuration
// Body: partial PersonalityConfig object
// ---------------------------------------------------------------------------
router.put('/', (req: Request, res: Response): void => {
  try {
    const db = getDb();

    const updates = req.body as Record<string, unknown>;

    if (typeof updates !== 'object' || updates === null || Array.isArray(updates)) {
      res.status(400).json({ error: 'Request body must be an object' });
      return;
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No fields provided for update' });
      return;
    }

    // Field-level validation for known keys
    if (updates.name !== undefined && (typeof updates.name !== 'string' || !updates.name.trim())) {
      res.status(400).json({ error: 'name must be a non-empty string' });
      return;
    }

    if (updates.tone !== undefined && typeof updates.tone !== 'string') {
      res.status(400).json({ error: 'tone must be a string' });
      return;
    }

    if (updates.verbosity !== undefined && typeof updates.verbosity !== 'string') {
      res.status(400).json({ error: 'verbosity must be a string' });
      return;
    }

    if (updates.language !== undefined && typeof updates.language !== 'string') {
      res.status(400).json({ error: 'language must be a string' });
      return;
    }

    if (updates.traits !== undefined && !Array.isArray(updates.traits)) {
      res.status(400).json({ error: 'traits must be an array' });
      return;
    }

    if (
      updates.systemPromptExtra !== undefined &&
      typeof updates.systemPromptExtra !== 'string'
    ) {
      res.status(400).json({ error: 'systemPromptExtra must be a string' });
      return;
    }

    if (updates.emojiUsage !== undefined && typeof updates.emojiUsage !== 'string') {
      res.status(400).json({ error: 'emojiUsage must be a string' });
      return;
    }

    if (updates.formality !== undefined && typeof updates.formality !== 'string') {
      res.status(400).json({ error: 'formality must be a string' });
      return;
    }

    const current = getPersonality(db);
    const merged = { ...current, ...updates };

    savePersonality(db, merged);

    res.json(merged);
  } catch (err) {
    logger.error('[personality] PUT / error', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to update personality config' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/personality/reset
// Reset personality to factory defaults
// ---------------------------------------------------------------------------
router.post('/reset', (_req: Request, res: Response): void => {
  try {
    const db = getDb();

    savePersonality(db, { ...DEFAULT_PERSONALITY });

    res.json({ ...DEFAULT_PERSONALITY, _reset: true });
  } catch (err) {
    logger.error('[personality] POST /reset error', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to reset personality config' });
  }
});

export default router;
