import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { AppError } from '../errors.js';

const logger = createLogger('API');

import conversationsRouter from './routes/conversations.js';
import usersRouter from './routes/users.js';
import memoriesRouter from './routes/memories.js';
import personalityRouter from './routes/personality.js';
import skillsRouter from './routes/skills.js';
import statsRouter from './routes/stats.js';
import todosRouter from './routes/todos.js';
import remindersRouter from './routes/reminders.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Admin authentication middleware
// ---------------------------------------------------------------------------
function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];

  if (!config.adminSecret) {
    // No secret configured – deny all access
    res.status(503).json({ error: 'Admin access is not configured' });
    return;
  }

  if (!authHeader) {
    res.status(401).json({ error: 'Authorization header is required' });
    return;
  }

  // Accept "Bearer <token>" or a bare token
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader;

  if (token !== config.adminSecret) {
    res.status(403).json({ error: 'Invalid admin secret' });
    return;
  }

  next();
}

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------
function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const requestId = (req as Request & { requestId?: string }).requestId ?? 'unknown';

  if (err instanceof AppError) {
    logger.error(`${err.name}: ${err.message}`, { requestId, statusCode: err.statusCode, stack: err.stack });
  } else if (err instanceof Error) {
    logger.error(`Unhandled error: ${err.message}`, { requestId, stack: err.stack });
  } else {
    logger.error('Unknown error', { requestId, error: String(err) });
  }

  if (res.headersSent) return;

  const status =
    err instanceof AppError ? err.statusCode :
    err instanceof ApiError ? err.statusCode : 500;

  const isProduction = config.nodeEnv === 'production';
  const message =
    isProduction && status === 500
      ? 'Internal server error'
      : err instanceof Error ? err.message : 'Internal server error';

  res.status(status).json({ error: message, requestId });
}

// Simple typed error class so routes can throw with a specific HTTP status
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------
export function createApp(): Express {
  const app = express();

  // ---- CORS ----------------------------------------------------------------
  const isProduction = config.nodeEnv === 'production';

  if (isProduction) {
    app.use(
      cors({
        origin: false,
        credentials: true,
      }),
    );
  } else {
    // Development: allow all origins
    app.use(cors());
  }

  // ---- Request ID -----------------------------------------------------------
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { requestId: string }).requestId = uuidv4().slice(0, 8);
    next();
  });

  // ---- Body parsers --------------------------------------------------------
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // ---- Health check (unauthenticated) -------------------------------------
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // ---- Admin API routes (all protected) -----------------------------------
  app.use('/api', adminAuth);

  app.use('/api/conversations', conversationsRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/memories', memoriesRouter);
  app.use('/api/personality', personalityRouter);
  app.use('/api/skills', skillsRouter);
  app.use('/api/stats', statsRouter);
  app.use('/api/todos', todosRouter);
  app.use('/api/reminders', remindersRouter);

  // ---- Static file serving (production) -----------------------------------
  if (isProduction) {
    const clientDist = path.join(__dirname, '..', '..', '..', 'client', 'dist');

    app.use(express.static(clientDist));

    // SPA fallback: serve index.html for any non-API route
    app.get(/^(?!\/api\/).*$/, (_req: Request, res: Response) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  // ---- 404 for unknown /api routes ----------------------------------------
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'API route not found' });
  });

  // ---- Global error handler -----------------------------------------------
  app.use(errorHandler);

  return app;
}

// ---------------------------------------------------------------------------
// Server bootstrap
// ---------------------------------------------------------------------------
export async function startServer(port: number): Promise<void> {
  const app = createApp();

  await new Promise<void>((resolve, reject) => {
    const server = app.listen(port, () => {
      logger.info(`Server listening on port ${port}`);
      resolve();
    });

    server.on('error', (err) => {
      logger.error('Failed to start server', { error: err instanceof Error ? err.message : String(err) });
      reject(err);
    });
  });
}
