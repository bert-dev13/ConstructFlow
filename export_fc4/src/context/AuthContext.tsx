'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
} from 'react';
import type { User } from '../types';
import { authLogin, authLogout } from '../lib/authApi';
import { subscribeAuth } from '../lib/firebase/auth';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    sessionStorage.removeItem('sitetrack_role');

    const unsub = subscribeAuth((profile) => {
      setUser(profile);
      if (profile) {
        sessionStorage.setItem('sitetrack_user', JSON.stringify(profile));
      } else {
        sessionStorage.removeItem('sitetrack_user');
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await authLogin(email, password);
    setUser(res.user);
    sessionStorage.setItem('sitetrack_user', JSON.stringify(res.user));
    sessionStorage.removeItem('sitetrack_role');
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authLogout();
    } catch {
      /* ignore */
    }
    setUser(null);
    sessionStorage.removeItem('sitetrack_user');
    sessionStorage.removeItem('sitetrack_role');
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, logout }),
    [user, loading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
