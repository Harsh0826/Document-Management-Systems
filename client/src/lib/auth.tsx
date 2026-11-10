import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, refreshSession, tokenStore } from '@/api/client';
import type { SessionUser } from './types';

interface AuthState {
  user: SessionUser | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  verifyMfa: (mfaToken: string, code: string) => Promise<SessionUser>;
  setSession: (accessToken: string, user: SessionUser) => void;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
  isAdmin: boolean;
}

export type LoginResult = { mfaRequired: true; mfaToken: string } | { mfaRequired: false; user: SessionUser };

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const qc = useQueryClient();

  // Restore the session from the httpOnly refresh cookie on first load.
  useEffect(() => {
    refreshSession().then((s) => {
      setUser(s?.user ?? null);
      setReady(true);
    });
    tokenStore.onLost(() => {
      setUser(null);
      qc.clear();
    });
  }, [qc]);

  const setSession = useCallback(
    (accessToken: string, u: SessionUser) => {
      tokenStore.set(accessToken);
      qc.clear();
      setUser(u);
    },
    [qc],
  );

  /** Step 1: password. Returns either a signed-in user or an MFA challenge. */
  const login = useCallback(
    async (email: string, password: string): Promise<LoginResult> => {
      const { data } = await api.post<{ accessToken?: string; user?: SessionUser; mfaRequired?: boolean; mfaToken?: string }>('/auth/login', {
        email,
        password,
      });
      if (data.mfaRequired && data.mfaToken) return { mfaRequired: true, mfaToken: data.mfaToken };
      setSession(data.accessToken!, data.user!);
      return { mfaRequired: false, user: data.user! };
    },
    [setSession],
  );

  /** Step 2: authenticator or recovery code. */
  const verifyMfa = useCallback(
    async (mfaToken: string, code: string) => {
      const { data } = await api.post<{ accessToken: string; user: SessionUser }>('/auth/login/mfa', { mfaToken, code });
      setSession(data.accessToken, data.user);
      return data.user;
    },
    [setSession],
  );

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    tokenStore.set(null);
    qc.clear();
    setUser(null);
  }, [qc]);

  const reload = useCallback(async () => {
    const s = await refreshSession();
    setUser(s?.user ?? null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      ready,
      login,
      verifyMfa,
      setSession,
      logout,
      reload,
      isAdmin: user?.role === 'admin',
    }),
    [user, ready, login, verifyMfa, setSession, logout, reload],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
