import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppwriteException } from 'appwrite';

import { ApiError, messageOf } from './lib/api';
import { account, api, clearJwt } from './lib/appwrite';

export interface AdminUser {
  id: string;
  email: string;
  name: string;
}

type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut'; message?: string }
  | { status: 'admin'; user: AdminUser };

interface AuthContextValue {
  state: AuthState;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const NOT_ADMIN = 'This account is not an administrator, so it has been signed out.';

class NotAdmin extends Error {}

/**
 * Confirms the current session belongs to an admin.
 *
 * The label on the account is checked here only to fail fast. The authority is
 * the server: /admin/whoami runs behind the same gate as every other admin
 * route, so a doctored client cannot get past it.
 */
async function verifyAdmin(): Promise<AdminUser> {
  const user = await account.get();
  if (!user.labels.includes('admin')) throw new NotAdmin();

  try {
    await api.call('/admin/whoami');
  } catch (e) {
    if (e instanceof ApiError && e.code === 'forbidden') throw new NotAdmin();
    throw e;
  }
  return { id: user.$id, email: user.email, name: user.name };
}

async function dropSession(): Promise<void> {
  clearJwt();
  try {
    await account.deleteSession({ sessionId: 'current' });
  } catch {
    // Already gone, or offline. Nothing more to try.
  }
}

function loginMessage(e: unknown): string {
  if (e instanceof AppwriteException) {
    if (e.type === 'user_invalid_credentials') return 'Email or password is incorrect.';
    if (e.type === 'general_rate_limit_exceeded') {
      return 'Too many sign-in attempts. Wait a few minutes before trying again.';
    }
    if (e.message) return e.message;
  }
  return messageOf(e);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      let next: AuthState;
      try {
        next = { status: 'admin', user: await verifyAdmin() };
      } catch (e) {
        if (e instanceof NotAdmin) {
          await dropSession();
          next = { status: 'signedOut', message: NOT_ADMIN };
        } else if (e instanceof AppwriteException && e.code === 401) {
          // No session yet: the normal first visit.
          next = { status: 'signedOut' };
        } else {
          next = { status: 'signedOut', message: messageOf(e) };
        }
      }
      if (!cancelled) setState(next);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    // A leftover session makes Appwrite refuse a new one, which no password can
    // fix. Clear it first.
    await dropSession();

    try {
      await account.createEmailPasswordSession({ email: email.trim(), password });
    } catch (e) {
      throw new Error(loginMessage(e));
    }

    try {
      setState({ status: 'admin', user: await verifyAdmin() });
    } catch (e) {
      await dropSession();
      if (e instanceof NotAdmin) {
        setState({ status: 'signedOut', message: NOT_ADMIN });
        throw new Error(NOT_ADMIN);
      }
      setState({ status: 'signedOut' });
      throw new Error(messageOf(e));
    }
  }, []);

  const signOut = useCallback(async () => {
    await dropSession();
    setState({ status: 'signedOut' });
  }, []);

  const value = useMemo(() => ({ state, signIn, signOut }), [state, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
