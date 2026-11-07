import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, refreshSession, tokenStore } from '@/api/client';
import type { Permission, SessionUser } from './types';

interface AuthState {
  user: SessionUser | null;
  ready: boolean;
  login: (email: string, password: string, portal: 'admin' | 'employee') => Promise<SessionUser>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
  can: (p: Permission) => boolean;
  isAdmin: boolean;
  isStaff: boolean;
  isEmployee: boolean;
}

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

  const login = useCallback(async (email: string, password: string, portal: 'admin' | 'employee') => {
    const { data } = await api.post<{ accessToken: string; user: SessionUser }>('/auth/login', { email, password, portal });
    tokenStore.set(data.accessToken);
    qc.clear();
    setUser(data.user);
    return data.user;
  }, [qc]);

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
      logout,
      reload,
      can: (p) => !!user?.permissions.includes(p),
      isAdmin: user?.role === 'admin',
      isStaff: user?.role === 'staff',
      isEmployee: user?.role === 'employee',
    }),
    [user, ready, login, logout, reload],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
