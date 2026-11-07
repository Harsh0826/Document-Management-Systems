import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import type { SessionUser } from '@/lib/types';

/**
 * Access tokens live only in memory (never localStorage) so XSS cannot exfiltrate a long-lived
 * credential. The refresh token is an httpOnly cookie the browser sends to /api/auth only.
 */
let accessToken: string | null = null;
let onSessionLost: (() => void) | null = null;

export const tokenStore = {
  set: (t: string | null) => {
    accessToken = t;
  },
  get: () => accessToken,
  onLost: (fn: () => void) => {
    onSessionLost = fn;
  },
};

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: { 'X-Requested-With': 'XMLHttpRequest' },
  timeout: 60_000,
});

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

// Single-flight refresh shared by every request that hits a 401 at the same time.
let refreshing: Promise<{ accessToken: string; user: SessionUser } | null> | null = null;

export function refreshSession() {
  refreshing ??= axios
    .post('/api/auth/refresh', null, { withCredentials: true, headers: { 'X-Requested-With': 'XMLHttpRequest' } })
    .then((r) => {
      accessToken = r.data.accessToken;
      return r.data as { accessToken: string; user: SessionUser };
    })
    .catch(() => null)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as (AxiosRequestConfig & { _retried?: boolean }) | undefined;
    const isAuthCall = original?.url?.startsWith('/auth/');
    if (error.response?.status === 401 && original && !original._retried && !isAuthCall) {
      original._retried = true;
      const session = await refreshSession();
      if (session) return api(original);
      accessToken = null;
      onSessionLost?.();
    }
    return Promise.reject(error);
  },
);

export interface ApiErrorShape {
  code: string;
  message: string;
  details?: { fields?: Record<string, string>; [k: string]: unknown };
}

export function apiError(err: unknown): ApiErrorShape {
  if (axios.isAxiosError(err)) {
    const e = (err.response?.data as { error?: ApiErrorShape } | undefined)?.error;
    if (e) return e;
    if (err.code === 'ECONNABORTED') return { code: 'timeout', message: 'The request timed out. Please try again.' };
    if (!err.response) return { code: 'network', message: 'Cannot reach the server. Check your connection.' };
  }
  return { code: 'unknown', message: 'Something went wrong. Please try again.' };
}

export const errorMessage = (err: unknown) => apiError(err).message;

/** Applies server-side field errors to a react-hook-form instance. */
export function applyFieldErrors(err: unknown, setError: (name: any, e: { message: string }) => void): boolean {
  const fields = apiError(err).details?.fields;
  if (!fields) return false;
  for (const [k, message] of Object.entries(fields)) setError(k, { message });
  return true;
}
