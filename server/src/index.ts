/**
 * Telegram AI Assistant — Server Entry Point
 *
 * Boot order:
 *  1. Load and validate configuration
 *  2. Initialize database + run migrations
 *  3. Start Express API server (admin dashboard + health endpoints)
 *  4. Start Telegram bot (long-polling) with full handler stack
 *  5. Register graceful-shutdown handlers
 */

import { config } from './config.js';
import { createLogger, setLogLevel, shutdownLogger } from './logger.js';
import { initDatabase, closeDatabase } from './db/index.js';
import { runMigrations } from './db/migrations.js';
import { startBot, stopBot } from './bot/index.js';
import { createApp } from './api/index.js';
import http from 'http';

// Set log level from config before anything else logs
setLogLevel(config.logLevel as 'debug' | 'info' | 'warn' | 'error');

const logger = createLogger('Server');

// ---------------------------------------------------------------------------
// Global error safety net
// ---------------------------------------------------------------------------

process.on('uncaughtException', (err: Error) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  logger.error('Unhandled promise rejection', { reason: reason instanceof Error ? reason.message : String(reason) });
  process.exit(1);
});

// ---------------------------------------------------------------------------
// 1. Configuration (validated at import time)
// ---------------------------------------------------------------------------

logger.info(`Starting in ${config.nodeEnv} mode...`);

// ---------------------------------------------------------------------------
// 2. Database
// ---------------------------------------------------------------------------

initDatabase();
runMigrations();

// ---------------------------------------------------------------------------
// 3. Express API server (admin dashboard routes + health check)
// ---------------------------------------------------------------------------

const app = createApp();
const httpServer = http.createServer(app);

function startApiServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    httpServer.listen(config.port, () => {
      logger.info(`Express server listening on port ${config.port} (${config.nodeEnv})`);
      resolve();
    });
    httpServer.once('error', reject);
  });
}

// ---------------------------------------------------------------------------
// 4. Graceful shutdown
// ---------------------------------------------------------------------------

let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`Received ${signal} — shutting down gracefully...`);

  // Stop the Telegram bot (stops polling and cleans up)
  try {
    await stopBot();
  } catch (err) {
    logger.error('Error stopping bot', { error: err instanceof Error ? err.message : String(err) });
  }

  // Close the HTTP server
  await new Promise<void>((resolve) => {
    httpServer.close((err) => {
      if (err) {
        logger.error('Error closing HTTP server', { error: err instanceof Error ? err.message : String(err) });
      } else {
        logger.info('HTTP server closed.');
      }
      resolve();
    });
  });

  // Close the database
  closeDatabase();

  logger.info('Shutdown complete.');

  // Flush and close log file handles
  await shutdownLogger();

  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

// ---------------------------------------------------------------------------
// 5. Start everything
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  try {
    // Start the HTTP API server
    await startApiServer();

    // Start the Telegram bot with full handler stack
    // (middleware, command handlers, skill handlers, AI message handler)
    await startBot();

    logger.info('All systems operational.');
    logger.info(`Health check available at: http://localhost:${config.port}/health`);
  } catch (err) {
    logger.error('Fatal startup error', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }
}

void main();
