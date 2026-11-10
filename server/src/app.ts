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
import { apiLimiter, requestId } from './middleware/security.js';
import { activeStorageOrigin } from './services/storage.js';
import { authRouter } from './routes/auth.routes.js';
import { libraryRouter } from './routes/library.routes.js';
import { auditRouter, filesRouter } from './routes/misc.routes.js';
import { peopleRouter } from './routes/people.routes.js';
import { storageRouter } from './routes/storage.routes.js';

/**
 * Origin the SPA may load signed file URLs from for in-app previews: only the active bucket's own
 * endpoint (never every bucket in the region). Evaluated per request so it follows a runtime switch.
 */
const fileOrigin = () => activeStorageOrigin() ?? "'self'";

/** Masks secrets that travel in URL paths (invitation/reset tokens, signed file tokens). */
export const redactUrl = (url: string) => url.replace(/(\/api\/auth\/invitations\/)[^/?]+/, '$1[redacted]').replace(/(\/api\/files\/)[^/?]+/, '$1[redacted]');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: ["'self'", 'data:', 'blob:', fileOrigin],
          frameSrc: ["'self'", fileOrigin],
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
  app.use(requestId);
  app.use(compression());
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as unknown as { id: string }).id,
      autoLogging: { ignore: (req) => req.url === '/api/health' },
      // Invite/reset tokens and signed file tokens live in URLs: never write them to logs.
      serializers: {
        req: (r: { id: string; method: string; url: string }) => ({ id: r.id, method: r.method, url: redactUrl(r.url) }),
      },
    }),
  );
  app.use((_req, res, next) => {
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    next();
  });
  app.use(express.json({ limit: '200kb' }));
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
  app.use('/api/library', libraryRouter);
  app.use('/api/people', peopleRouter);
  app.use('/api/audit-logs', auditRouter);
  app.use('/api/files', filesRouter);
  app.use('/api/admin/storage', storageRouter);

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
    res.status(500).json({ error: { code: 'internal', message: 'Something went wrong. Please try again.', requestId: (req as Request & { id?: string }).id } });
  });

  return app;
}
