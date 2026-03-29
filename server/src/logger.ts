/**
 * Structured JSON logger with daily file rotation.
 *
 * - One JSON object per line (timestamp, level, module, message, pid, + meta)
 * - File logging to LOG_DIR (default: logs/) with daily rotation & retention
 * - In development mode, also prints coloured human-readable lines to console
 * - No external dependencies — Node built-ins only
 *
 * Usage:
 *   import { createLogger } from './logger.js';
 *   const logger = createLogger('Bot');
 *   logger.info('Message received', { userId: 123 });
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Log levels
// ---------------------------------------------------------------------------

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
} as const;

type LogLevel = keyof typeof LOG_LEVELS;

// ---------------------------------------------------------------------------
// Resolve active log level from environment
// ---------------------------------------------------------------------------

function resolveLogLevel(): LogLevel {
  const envLevel = (process.env.LOG_LEVEL ?? '').toLowerCase().trim();
  if (envLevel && envLevel in LOG_LEVELS) {
    return envLevel as LogLevel;
  }
  return process.env.NODE_ENV === 'development' ? 'debug' : 'info';
}

let activeLevel: LogLevel = resolveLogLevel();

/** Programmatically change the global log level at runtime. */
export function setLogLevel(level: LogLevel): void {
  activeLevel = level;
}

export function getLogLevel(): LogLevel {
  return activeLevel;
}

// ---------------------------------------------------------------------------
// Logger interface
// ---------------------------------------------------------------------------

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const IS_DEV = process.env.NODE_ENV === 'development';

// Log directory: configurable via LOG_DIR, default logs/ relative to project root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = process.env.LOG_DIR
  ? path.resolve(process.env.LOG_DIR)
  : path.resolve(__dirname, '..', '..', 'logs');

const LOG_RETENTION_DAYS = Math.max(
  1,
  parseInt(process.env.LOG_RETENTION_DAYS ?? '14', 10) || 14,
);

// ---------------------------------------------------------------------------
// File writer with daily rotation
// ---------------------------------------------------------------------------

function dateStamp(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

let currentDateStamp = '';
let fileStream: fs.WriteStream | null = null;
let fileReady = false;

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function logFilePath(stamp: string): string {
  return path.join(LOG_DIR, `app-${stamp}.log`);
}

function pruneOldLogs(): void {
  try {
    const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(LOG_DIR);
    for (const file of files) {
      if (!file.startsWith('app-') || !file.endsWith('.log')) continue;
      const filePath = path.join(LOG_DIR, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // Ignore individual file errors
      }
    }
  } catch {
    // Ignore pruning errors entirely — non-critical
  }
}

function openFileStream(): void {
  const stamp = dateStamp();
  if (fileStream && currentDateStamp === stamp) return;

  // Close previous stream if date rolled over
  if (fileStream) {
    fileStream.end();
    fileStream = null;
  }

  ensureLogDir();
  currentDateStamp = stamp;
  fileStream = fs.createWriteStream(logFilePath(stamp), { flags: 'a' });
  fileReady = true;

  fileStream.on('error', () => {
    fileReady = false;
  });

  // Prune old logs on rotation
  pruneOldLogs();
}

// Schedule midnight rotation
function scheduleMidnightRotation(): void {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 50); // 50ms past midnight
  const msUntilMidnight = tomorrow.getTime() - now.getTime();

  midnightTimer = setTimeout(() => {
    openFileStream();
    scheduleMidnightRotation();
  }, msUntilMidnight);

  // Don't keep process alive just for log rotation
  midnightTimer.unref();
}

let midnightTimer: ReturnType<typeof setTimeout> | null = null;

// Initialize file logging on module load
openFileStream();
scheduleMidnightRotation();

// ---------------------------------------------------------------------------
// Console colours (development DX)
// ---------------------------------------------------------------------------

const COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m', // cyan
  info: '\x1b[32m',  // green
  warn: '\x1b[33m',  // yellow
  error: '\x1b[31m', // red
};
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

// ---------------------------------------------------------------------------
// Core write function
// ---------------------------------------------------------------------------

function write(
  level: LogLevel,
  module: string,
  message: string,
  meta?: Record<string, unknown>,
): void {
  const now = new Date();
  const timestamp = now.toISOString();

  // -- Build JSON log entry (always, for file) ----------------------------
  const entry: Record<string, unknown> = {
    timestamp,
    level,
    module,
    message,
    pid: process.pid,
  };

  // Flatten meta into top-level JSON
  if (meta && Object.keys(meta).length > 0) {
    for (const [k, v] of Object.entries(meta)) {
      // Avoid overwriting core fields
      if (!(k in entry)) {
        entry[k] = v;
      } else {
        entry[`meta_${k}`] = v;
      }
    }
  }

  let jsonLine: string;
  try {
    jsonLine = JSON.stringify(entry);
  } catch {
    jsonLine = JSON.stringify({ timestamp, level, module, message, pid: process.pid, meta_error: 'unserializable' });
  }

  // -- File output (all levels, regardless of activeLevel) ----------------
  if (fileReady && fileStream) {
    // Check for date rollover
    if (dateStamp(now) !== currentDateStamp) {
      openFileStream();
    }
    fileStream.write(jsonLine + '\n');
  }

  // -- Console output (respects activeLevel) ------------------------------
  if (LOG_LEVELS[level] < LOG_LEVELS[activeLevel]) return;

  if (IS_DEV) {
    // Human-readable coloured line for development
    const tag = level.toUpperCase().padEnd(5);
    const metaStr = meta && Object.keys(meta).length > 0
      ? ' ' + JSON.stringify(meta)
      : '';
    const line = `${DIM}${timestamp}${RESET} ${COLORS[level]}${tag}${RESET} [${module}] ${message}${metaStr}`;
    if (level === 'error' || level === 'warn') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  } else {
    // Production: JSON to stdout/stderr
    if (level === 'error' || level === 'warn') {
      process.stderr.write(jsonLine + '\n');
    } else {
      process.stdout.write(jsonLine + '\n');
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a logger scoped to a module name.
 *
 * @param module  Short label that appears in every log line (e.g. "Bot", "DB").
 */
export function createLogger(module: string): Logger {
  return {
    debug: (message, meta?) => write('debug', module, message, meta),
    info: (message, meta?) => write('info', module, message, meta),
    warn: (message, meta?) => write('warn', module, message, meta),
    error: (message, meta?) => write('error', module, message, meta),
  };
}

// ---------------------------------------------------------------------------
// Cleanup — flush and close file handles
// ---------------------------------------------------------------------------

/** Flush and close the log file stream. Call during graceful shutdown. */
export function shutdownLogger(): Promise<void> {
  return new Promise((resolve) => {
    if (midnightTimer) {
      clearTimeout(midnightTimer);
      midnightTimer = null;
    }

    if (fileStream) {
      fileStream.end(() => {
        fileStream = null;
        fileReady = false;
        resolve();
      });
    } else {
      resolve();
    }
  });
}
