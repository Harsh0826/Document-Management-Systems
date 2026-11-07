import compression from 'compression';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import multer from 'multer';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pinoHttp } from 'pino-http';
import { env, isProd } from './config/env.js';
import { AppError } from './lib/errors.js';
import { logger } from './lib/logger.js';
import { apiLimiter } from './middleware/security.js';
import { authRouter } from './routes/auth.routes.js';
import { categoriesRouter, clientsRouter, employeesRouter } from './routes/clients.routes.js';
import { documentsRouter } from './routes/documents.routes.js';
import { foldersRouter } from './routes/folders.routes.js';
import { auditRouter, dashboardRouter, filesRouter, notificationsRouter } from './routes/misc.routes.js';
import { requestsRouter } from './routes/requests.routes.js';
import { usersRouter } from './routes/users.routes.js';

/** Origins the SPA may load signed file URLs from (S3 / MinIO) for in-app previews. */
function storageOrigins(): string[] {
  if (env.STORAGE_DRIVER !== 's3') return [];
  if (env.S3_ENDPOINT) return [new URL(env.S3_ENDPOINT).origin];
  return [`https://${env.S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com`, `https://s3.${env.AWS_REGION}.amazonaws.com`];
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  const fileOrigins = storageOrigins();
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: ["'self'", 'data:', 'blob:', ...fileOrigins],
          frameSrc: ["'self'", ...fileOrigins],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'self'"],
          upgradeInsecureRequests: isProd ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      strictTransportSecurity: isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
    }),
  );
  app.use(compression());
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));
  app.use(express.json({ limit: '200kb' }));
  app.use(express.urlencoded({ extended: false, limit: '200kb' }));
  app.use(cookieParser());

  // API responses are never cached by browsers or proxies.
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, storage: env.STORAGE_DRIVER });
  });

  app.use('/api', apiLimiter);
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/clients', clientsRouter);
  app.use('/api/employees', employeesRouter);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/documents', documentsRouter);
  app.use('/api/folders', foldersRouter);
  app.use('/api/requests', requestsRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/audit-logs', auditRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/files', filesRouter);

  app.use('/api', (_req, _res, next) => next(new AppError(404, 'Endpoint not found', 'not_found')));

  // Production: serve the built SPA from the same origin.
  const clientDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  if (isProd && existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(resolve(clientDist, 'index.html')));
  }

  // Central error handler — never leaks stack traces or SQL errors to clients.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      const message = err.code === 'LIMIT_FILE_SIZE' ? `File exceeds the ${env.MAX_UPLOAD_MB} MB limit` : `Upload error: ${err.message}`;
      res.status(status).json({ error: { code: err.code.toLowerCase(), message } });
      return;
    }
    if (err instanceof AppError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
      return;
    }
    if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'bad_json', message: 'Malformed JSON body' } });
      return;
    }
    // Unique-violation races that slipped past explicit checks.
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505') {
      res.status(409).json({ error: { code: 'conflict', message: 'A record with these details already exists' } });
      return;
    }
    req.log?.error({ err }, 'Unhandled error');
    res.status(500).json({ error: { code: 'internal', message: 'Something went wrong. Please try again.' } });
  });

  return app;
}
