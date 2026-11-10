/**
 * Upload validation: extension whitelist, declared MIME, magic-byte sniffing and size.
 * The stored content type is derived from the verified extension, never from the client.
 */
import multer from 'multer';
import { basename } from 'node:path';
import { env } from '../config/env.js';
import { badRequest, tooLarge, unsupported } from '../lib/errors.js';
import { sha256 } from '../lib/crypto.js';

export const ALLOWED_TYPES = {
  pdf: { mime: 'application/pdf', accept: ['application/pdf'] },
  doc: { mime: 'application/msword', accept: ['application/msword'] },
  docx: {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    accept: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip'],
  },
  jpg: { mime: 'image/jpeg', accept: ['image/jpeg', 'image/pjpeg'] },
  jpeg: { mime: 'image/jpeg', accept: ['image/jpeg', 'image/pjpeg'] },
  png: { mime: 'image/png', accept: ['image/png'] },
  xls: { mime: 'application/vnd.ms-excel', accept: ['application/vnd.ms-excel'] },
  xlsx: {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    accept: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip'],
  },
} as const;

export type FileExt = keyof typeof ALLOWED_TYPES;
export const FILE_EXTS = Object.keys(ALLOWED_TYPES) as FileExt[];

/** Types the browser can render inline; everything else is always served as an attachment. */
export const PREVIEWABLE_EXTS: FileExt[] = ['pdf', 'jpg', 'jpeg', 'png'];

const startsWith = (buf: Buffer, bytes: number[]) => bytes.every((b, i) => buf[i] === b);
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const CFB = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // legacy Office (doc/xls)

function magicMatches(ext: FileExt, buf: Buffer): boolean {
  switch (ext) {
    case 'pdf':
      return buf.subarray(0, 1024).includes('%PDF-');
    case 'png':
      return startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'jpg':
    case 'jpeg':
      return startsWith(buf, [0xff, 0xd8, 0xff]);
    case 'doc':
    case 'xls':
      return startsWith(buf, CFB);
    case 'docx':
      return startsWith(buf, ZIP) && buf.includes('word/');
    case 'xlsx':
      return startsWith(buf, ZIP) && buf.includes('xl/');
  }
}

/** Strips directories and control characters from a client-supplied filename. */
export function sanitizeFilename(name: string): string {
  // Replace control characters (U+0000–U+001F, U+007F) and characters unsafe in file names.
  const clean = [...basename(name.replace(/\\/g, '/'))]
    .map((ch) => (ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f || '<>:"|?*'.includes(ch) ? '_' : ch))
    .join('')
    .trim();
  return (clean || 'file').slice(0, 200);
}

export interface ValidatedFile {
  buffer: Buffer;
  originalName: string;
  ext: FileExt;
  mime: string;
  size: number;
  checksum: string;
}

export function validateUpload(file: Express.Multer.File | undefined): ValidatedFile {
  if (!file) throw badRequest('A file is required');
  const originalName = sanitizeFilename(file.originalname);
  const ext = originalName.split('.').pop()?.toLowerCase() ?? '';
  if (!(ext in ALLOWED_TYPES)) {
    throw unsupported(`File type ".${ext}" is not allowed. Allowed: ${FILE_EXTS.join(', ').toUpperCase()}`);
  }
  const type = ALLOWED_TYPES[ext as FileExt];
  const declared = (file.mimetype || '').toLowerCase();
  const declaredOk = (type.accept as readonly string[]).includes(declared) || declared === 'application/octet-stream' || declared === '';
  if (!declaredOk) throw unsupported(`The file's type (${declared}) does not match its .${ext} extension`);
  if (file.size === 0) throw badRequest('The file is empty');
  if (file.size > env.MAX_UPLOAD_MB * 1024 * 1024) throw tooLarge(`File exceeds the ${env.MAX_UPLOAD_MB} MB limit`);
  if (!magicMatches(ext as FileExt, file.buffer)) {
    throw unsupported(`The file content is not a valid ${ext.toUpperCase()} file`);
  }
  return {
    buffer: file.buffer,
    originalName,
    ext: ext as FileExt,
    mime: type.mime,
    size: file.size,
    checksum: sha256(file.buffer),
  };
}

/** Multer configured for a single in-memory file with hard limits (validated again above). */
export const uploadSingle = multer({
  storage: multer.memoryStorage(),
  // Decode UTF-8 filenames correctly (supported by multer 2, missing from its type definitions).
  defParamCharset: 'utf8',
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 20, fieldSize: 64 * 1024 },
} as multer.Options).single('file');
