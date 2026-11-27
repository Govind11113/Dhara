import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppwriteException } from 'appwrite';

import { roleFromLabels, whoamiPath, type Role } from './access';
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
  | { status: 'signedIn'; role: Role; user: AdminUser };

interface AuthContextValue {
  state: AuthState;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const NO_ACCESS = 'This account is not an administrator or NGO account, so it has been signed out.';

class NoAccess extends Error {}

/**
 * Confirms the current session belongs to an admin or an NGO account, and says
 * which.
 *
 * The label on the account is checked here only to fail fast. The authority is
 * the server: /admin/whoami and /ngo/whoami run behind the same gates as every
 * other route under their prefix, so a doctored client cannot get past them.
 */
async function verifyAccount(): Promise<{ role: Role; user: AdminUser }> {
  const user = await account.get();
  const role = roleFromLabels(user.labels);
  if (!role) throw new NoAccess();

  try {
    await api.call(whoamiPath(role));
  } catch (e) {
    if (e instanceof ApiError && e.code === 'forbidden') throw new NoAccess();
    throw e;
  }
  return { role, user: { id: user.$id, email: user.email, name: user.name } };
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
        next = { status: 'signedIn', ...(await verifyAccount()) };
      } catch (e) {
        if (e instanceof NoAccess) {
          await dropSession();
          next = { status: 'signedOut', message: NO_ACCESS };
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
      setState({ status: 'signedIn', ...(await verifyAccount()) });
    } catch (e) {
      await dropSession();
      if (e instanceof NoAccess) {
        setState({ status: 'signedOut', message: NO_ACCESS });
        throw new Error(NO_ACCESS);
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
