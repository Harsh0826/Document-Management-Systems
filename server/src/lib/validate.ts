import type { NextFunction, Request, Response } from 'express';
import { z, type ZodType } from 'zod';
import { badRequest } from './errors.js';

/** Parse a value with a zod schema, throwing a 400 with field errors on failure. */
export function parse<T extends ZodType>(schema: T, value: unknown): z.output<T> {
  const r = schema.safeParse(value);
  if (!r.success) {
    const fields: Record<string, string> = {};
    for (const issue of r.error.issues) {
      const key = issue.path.join('.') || '_';
      if (!fields[key]) fields[key] = issue.message;
    }
    throw badRequest('Validation failed', { fields });
  }
  return r.data;
}

/** Middleware variant: validates and replaces req.body. */
export const body =
  <T extends ZodType>(schema: T) =>
  (req: Request, _res: Response, next: NextFunction) => {
    req.body = parse(schema, req.body);
    next();
  };

// ---- Reusable field schemas -----------------------------------------------------------
export const uuid = z.string().uuid('Invalid id');
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid date');
/** Optional date coming from a form: '' or null → null. */
export const trimmed = (max: number) => z.string().trim().max(max);
export const nonEmpty = (max: number) => z.string().trim().min(1, 'Required').max(max);
export const email = z.string().trim().toLowerCase().email('Invalid email address').max(254);

export const password = z
  .string()
  .min(10, 'At least 10 characters')
  .max(72, 'At most 72 characters')
  .refine((s) => Buffer.byteLength(s, 'utf8') <= 72, 'Password is too long')
  .regex(/[a-z]/, 'Must contain a lowercase letter')
  .regex(/[A-Z]/, 'Must contain an uppercase letter')
  .regex(/[0-9]/, 'Must contain a number');

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** Escapes LIKE/ILIKE wildcards so user input is matched literally. */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
