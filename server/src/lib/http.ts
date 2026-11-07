import type { Request } from 'express';

export const clientIp = (req: Request) => req.ip ?? req.socket.remoteAddress ?? null;
export const userAgent = (req: Request) => (req.get('user-agent') ?? '').slice(0, 300) || null;

/** Shape of paged list responses. */
export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Tiny SQL builder for dynamic WHERE clauses — values are always bound as parameters.
 *   const w = new Where(); w.add('status = ?', 'approved'); w.sql → 'WHERE status = $1'
 */
export class Where {
  private parts: string[] = [];
  readonly params: unknown[] = [];

  /** Adds a condition; each `?` is replaced by the next positional parameter. */
  add(condition: string, ...values: unknown[]): this {
    let i = 0;
    const sql = condition.replace(/\?/g, () => {
      this.params.push(values[i++]);
      return `$${this.params.length}`;
    });
    this.parts.push(`(${sql})`);
    return this;
  }

  /** Binds a value without adding a condition and returns its placeholder. */
  bind(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  get sql(): string {
    return this.parts.length ? `WHERE ${this.parts.join(' AND ')}` : '';
  }
}
