/**
 * lib/auth.ts — Auth context, provider, and hook merged into one file.
 * Import AuthProvider in App.tsx and useAuth anywhere inside the tree.
 */
import type { ReactNode } from 'react';
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { AuthUser, LoginCredentials } from '@/types';
import { supabase } from '@/lib/supabase';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (creds: LoginCredentials) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Fetches the profile for a given Supabase auth user.
 * Throws a descriptive error if the profile does not exist or is inactive.
 */
async function fetchProfile(userId: string, email: string): Promise<AuthUser> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*, organization:organizations(*)')
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    throw new Error('Your user is not configured. Please contact admin.');
  }

  const profile = data as Record<string, unknown>;
  if (profile['active'] === false) {
    throw new Error('Your account has been deactivated. Please contact admin.');
  }

  const { organization, ...rest } = profile;
  return {
    id: userId,
    email,
    profile: rest as unknown as AuthUser['profile'],
    organization: organization as AuthUser['organization'],
  };
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        try {
          const authUser = await fetchProfile(session.user.id, session.user.email!);
          setUser(authUser);
        } catch {
          // Profile invalid or inactive — sign out
          await supabase.auth.signOut();
          setUser(null);
        }
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'TOKEN_REFRESHED' && session?.user) {
        try {
          const authUser = await fetchProfile(session.user.id, session.user.email!);
          setUser(authUser);
        } catch {
          await supabase.auth.signOut();
          setUser(null);
        }
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const login = useCallback(async ({ email, password }: LoginCredentials) => {
    if (!email || !password) throw new Error('Email and password are required');

    const { error: authError, data } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) throw authError;

    // Validate profile — throws if not configured or inactive
    const authUser = await fetchProfile(data.user.id, data.user.email!);
    setUser(authUser);
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
