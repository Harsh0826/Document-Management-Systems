/**
 * Private file storage. Nothing here ever produces a permanent or public URL:
 *  - s3:    objects in a private bucket, SSE enabled, short-lived presigned GET URLs.
 *  - local: dev-only; files kept outside the web root, served via HMAC-signed expiring URLs.
 */
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
  /** Size and recorded SHA-256 (hex) of a stored object, or null when it does not exist. */
  head(key: string): Promise<{ size: number; sha256: string | null } | null>;
  /** Full object contents, or null when it does not exist. */
  read(key: string): Promise<Buffer | null>;
}

export interface S3Options {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  kmsKeyId?: string;
  /** Explicit keys; when omitted the AWS default credential chain (profile, env, task role) is used. */
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

const isNotFound = (err: unknown) => {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
};

/** RFC 6266 Content-Disposition with an ASCII fallback and UTF-8 filename*. */
export function contentDisposition(disposition: 'inline' | 'attachment', filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

// ---- S3 -------------------------------------------------------------------------------
export class S3Storage implements StorageDriver {
  readonly name = 's3' as const;
  private client: S3Client;
  readonly bucket: string;
  readonly region: string;
  private kmsKeyId?: string;
  private endpoint?: string;

  constructor(o: S3Options) {
    this.client = new S3Client({ region: o.region, endpoint: o.endpoint, forcePathStyle: o.forcePathStyle, credentials: o.credentials });
    this.bucket = o.bucket;
    this.region = o.region;
    this.kmsKeyId = o.kmsKeyId;
    this.endpoint = o.endpoint;
  }

  /** Origin that presigned URLs point at (allowed in the CSP for in-app previews). */
  get origin(): string {
    return this.endpoint ? new URL(this.endpoint).origin : `https://${this.bucket}.s3.${this.region}.amazonaws.com`;
  }

  async put(key: string, body: Buffer, contentType: string) {
    const digest = createHash('sha256').update(body).digest();
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        // S3 recomputes the SHA-256 and rejects the upload if the bytes were corrupted in transit.
        ChecksumAlgorithm: 'SHA256',
        ChecksumSHA256: digest.toString('base64'),
        Metadata: { sha256: digest.toString('hex') },
        ...(this.kmsKeyId ? { ServerSideEncryption: 'aws:kms', SSEKMSKeyId: this.kmsKeyId } : { ServerSideEncryption: 'AES256' }),
      }),
    );
  }

  async head(key: string) {
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: Number(r.ContentLength ?? 0), sha256: r.Metadata?.sha256 ?? null };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async read(key: string) {
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return Buffer.from(await r.Body!.transformToByteArray());
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
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

export class LocalStorage implements StorageDriver {
  readonly name = 'local' as const;
  readonly root: string;

  constructor(dir: string = env.LOCAL_STORAGE_DIR) {
    this.root = resolve(dir);
  }

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

  async head(key: string) {
    try {
      const st = await stat(this.pathFor(key));
      return { size: st.size, sha256: null };
    } catch {
      return null;
    }
  }

  async read(key: string) {
    try {
      return await readFile(this.pathFor(key));
    } catch {
      return null;
    }
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

/** S3 driver configured from S3_* / AWS_* environment variables (credentials come from the AWS default chain). */
export function createS3StorageFromEnv(): S3Storage {
  if (!env.S3_BUCKET) throw new Error('S3_BUCKET is not set');
  return new S3Storage({
    bucket: env.S3_BUCKET,
    region: env.AWS_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    kmsKeyId: env.S3_KMS_KEY_ID,
  });
}

let driver: StorageDriver | null = null;
export function storage(): StorageDriver {
  driver ??= env.STORAGE_DRIVER === 's3' ? createS3StorageFromEnv() : new LocalStorage();
  return driver;
}

/** Switches the active storage at runtime (after an admin moves files to S3 from the settings screen). */
export function setActiveStorage(next: StorageDriver) {
  driver = next;
}

/** Extra origin the browser may load previews from, when files are served from S3. */
export function activeStorageOrigin(): string | null {
  const d = storage();
  return d instanceof S3Storage ? d.origin : null;
}

export function localStorageDriver(): LocalStorage | null {
  const s = storage();
  return s instanceof LocalStorage ? s : null;
}
