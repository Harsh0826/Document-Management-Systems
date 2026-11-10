import { Router } from 'express';
import { z } from 'zod';
import { badRequest } from '../lib/errors.js';
import { parse, trimmed } from '../lib/validate.js';
import { authenticate, currentUser, requireRole } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { describeStorage, startMoveToS3, testS3Connection, updateS3Settings } from '../services/storage-settings.js';

/** Admin-only "Storage" settings: connect an S3 bucket and move files there without the command line. */
export const storageRouter = Router();
storageRouter.use(authenticate, requireRole('admin'));

storageRouter.get('/', async (_req, res) => {
  res.json(await describeStorage());
});

const s3Schema = z.object({
  bucket: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'Bucket names use 3–63 lowercase letters, numbers, dots or dashes'),
  region: z
    .string()
    .trim()
    .regex(/^[a-z]{2}(-[a-z]+)+-\d$/, 'Choose a region, e.g. us-east-1'),
  kmsKeyId: trimmed(2048).optional().nullable(),
  accessKeyId: z
    .string()
    .trim()
    .regex(/^[A-Z0-9]{16,128}$/, 'Access key IDs look like AKIA… (letters and numbers)')
    .optional()
    .or(z.literal('')),
  secretAccessKey: z.string().trim().max(256).optional().or(z.literal('')),
  clearKeys: z.boolean().optional(),
});

storageRouter.put('/s3', async (req, res) => {
  const user = currentUser(req);
  const b = parse(s3Schema, req.body);
  if (!!b.accessKeyId !== !!b.secretAccessKey) {
    throw badRequest('Validation failed', {
      fields: { [b.accessKeyId ? 'secretAccessKey' : 'accessKeyId']: 'Enter both the access key ID and the secret key' },
    });
  }
  try {
    await updateS3Settings({ ...b, accessKeyId: b.accessKeyId || null, secretAccessKey: b.secretAccessKey || null }, user.id);
  } catch (err) {
    throw badRequest(err instanceof Error ? err.message : 'Could not save settings');
  }
  await audit(req, {
    action: 'storage.settings_updated',
    entityType: 'settings',
    entityId: 'storage',
    metadata: { bucket: b.bucket, region: b.region, keysChanged: !!b.accessKeyId || !!b.clearKeys },
  });
  res.json(await describeStorage());
});

storageRouter.post('/test', async (req, res) => {
  const result = await testS3Connection();
  await audit(req, { action: 'storage.connection_tested', entityType: 'settings', entityId: 'storage', metadata: { ok: result.ok } });
  res.json(result);
});

storageRouter.post('/move', async (req, res) => {
  const user = currentUser(req);
  const test = await testS3Connection();
  if (!test.ok) throw badRequest(test.message);
  try {
    res.status(202).json(await startMoveToS3(user.id, req));
  } catch (err) {
    throw badRequest(err instanceof Error ? err.message : 'Could not start');
  }
});
