import { createHash } from 'node:crypto';
import type { StorageDriver } from '../src/services/storage.js';

/** In-memory stand-in for S3 that behaves like our S3 driver (records sha256 metadata on put). */
export class FakeS3 implements StorageDriver {
  readonly name = 's3' as const;
  readonly bucket = 'fake-bucket';
  objects = new Map<string, { body: Buffer; sha256: string | null; type: string }>();
  failKeys = new Set<string>();
  failAll: Error | null = null;

  async put(key: string, body: Buffer, contentType: string) {
    if (this.failAll) throw this.failAll;
    if (this.failKeys.has(key)) throw new Error('Simulated network error');
    this.objects.set(key, { body, sha256: createHash('sha256').update(body).digest('hex'), type: contentType });
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
  async head(key: string) {
    if (this.failAll) throw this.failAll;
    const o = this.objects.get(key);
    return o ? { size: o.body.length, sha256: o.sha256 } : null;
  }
  async read(key: string) {
    return this.objects.get(key)?.body ?? null;
  }
  async signedUrl(key: string) {
    return { url: `https://fake-bucket.example/${key}?signed=1`, expiresAt: new Date(Date.now() + 300_000) };
  }
}
