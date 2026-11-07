/**
 * Private file storage. Nothing here ever produces a permanent or public URL:
 *  - s3:    objects in a private bucket, SSE enabled, short-lived presigned GET URLs.
 *  - local: dev-only; files kept outside the web root, served via HMAC-signed expiring URLs.
 */
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { env } from '../config/env.js';
import { hmac, safeEqual } from '../lib/crypto.js';

export interface SignedUrlOptions {
  filename: string;
  contentType: string;
  disposition: 'inline' | 'attachment';
  ttlSeconds?: number;
}

export interface StorageDriver {
  readonly name: 'local' | 's3';
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  signedUrl(key: string, opts: SignedUrlOptions): Promise<{ url: string; expiresAt: Date }>;
}

/** RFC 6266 Content-Disposition with an ASCII fallback and UTF-8 filename*. */
export function contentDisposition(disposition: 'inline' | 'attachment', filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

// ---- S3 -------------------------------------------------------------------------------
class S3Storage implements StorageDriver {
  readonly name = 's3' as const;
  private client = new S3Client({
    region: env.AWS_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  });
  private bucket = env.S3_BUCKET!;

  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ...(env.S3_KMS_KEY_ID
          ? { ServerSideEncryption: 'aws:kms', SSEKMSKeyId: env.S3_KMS_KEY_ID }
          : { ServerSideEncryption: 'AES256' }),
      }),
    );
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async signedUrl(key: string, o: SignedUrlOptions) {
    const ttl = o.ttlSeconds ?? env.SIGNED_URL_TTL_SECONDS;
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentType: o.contentType,
        ResponseContentDisposition: contentDisposition(o.disposition, o.filename),
      }),
      { expiresIn: ttl },
    );
    return { url, expiresAt: new Date(Date.now() + ttl * 1000) };
  }
}

// ---- Local (development) --------------------------------------------------------------
export interface LocalFileClaims {
  k: string; // storage key
  e: number; // expiry (unix seconds)
  f: string; // filename
  t: string; // content type
  d: 'inline' | 'attachment';
}

class LocalStorage implements StorageDriver {
  readonly name = 'local' as const;
  readonly root = resolve(env.LOCAL_STORAGE_DIR);

  /** Resolves a key under the storage root, refusing anything that escapes it. */
  pathFor(key: string) {
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root + sep)) throw new Error('Invalid storage key');
    return p;
  }

  async put(key: string, body: Buffer) {
    const p = this.pathFor(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body, { flag: 'wx' });
  }

  async delete(key: string) {
    await rm(this.pathFor(key), { force: true });
  }

  async signedUrl(key: string, o: SignedUrlOptions) {
    const ttl = o.ttlSeconds ?? env.SIGNED_URL_TTL_SECONDS;
    const claims: LocalFileClaims = { k: key, e: Math.floor(Date.now() / 1000) + ttl, f: o.filename, t: o.contentType, d: o.disposition };
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const token = `${payload}.${hmac(env.FILE_URL_SECRET, payload)}`;
    return { url: `/api/files/${token}`, expiresAt: new Date(claims.e * 1000) };
  }

  /** Verifies a signed token; returns null when tampered or expired. */
  verify(token: string): LocalFileClaims | null {
    const [payload, sig] = token.split('.');
    if (!payload || !sig || !safeEqual(sig, hmac(env.FILE_URL_SECRET, payload))) return null;
    try {
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as LocalFileClaims;
      if (typeof claims.e !== 'number' || claims.e * 1000 < Date.now()) return null;
      return claims;
    } catch {
      return null;
    }
  }

  open(key: string) {
    const p = this.pathFor(key);
    return existsSync(p) ? createReadStream(p) : null;
  }
}

let driver: StorageDriver | null = null;
export function storage(): StorageDriver {
  driver ??= env.STORAGE_DRIVER === 's3' ? new S3Storage() : new LocalStorage();
  return driver;
}

export function localStorageDriver(): LocalStorage | null {
  const s = storage();
  return s instanceof LocalStorage ? s : null;
}
