import type { ReactNode } from 'react';
import { createContext, useState, useEffect, useCallback } from 'react';
import type { AuthUser, LoginCredentials } from '@/types';
import { supabase } from '@/lib/supabase';

const LOCAL_SESSION_KEY = 'litigo_local_session';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (creds: LoginCredentials) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchProfile(userId: string, email: string): Promise<AuthUser | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*, organization:organizations(*)')
    .eq('user_id', userId)
    .single();

  if (error || !data) return null;

  const { organization, ...profile } = data as Record<string, unknown>;
  return {
    id: userId,
    email,
    profile: profile as AuthUser['profile'],
    organization: organization as AuthUser['organization'],
  };
}

function buildLocalUser(email: string): AuthUser {
  const domain = email.split('@')[1]?.split('.')[0] ?? 'firm';
  const orgName = domain.charAt(0).toUpperCase() + domain.slice(1) + ' Legal';
  return {
    id: 'local-' + email,
    email,
    profile: {
      id: 'local-profile',
      user_id: 'local-' + email,
      organization_id: 'local-org-' + domain,
      full_name: email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      email,
      role: 'admin',
      active: true,
      created_at: new Date().toISOString(),
    },
    organization: {
      id: 'local-org-' + domain,
      organization_name: orgName,
      contact_person: '',
      email,
      mobile: '',
      active: true,
      created_at: new Date().toISOString(),
    },
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    try {
      const stored = localStorage.getItem(LOCAL_SESSION_KEY);
      return stored ? (JSON.parse(stored) as AuthUser) : null;
    } catch { return null; }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        localStorage.removeItem(LOCAL_SESSION_KEY);
        const authUser = await fetchProfile(session.user.id, session.user.email!);
        if (authUser) setUser(authUser);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.user) {
        localStorage.removeItem(LOCAL_SESSION_KEY);
        const authUser = await fetchProfile(session.user.id, session.user.email!);
        if (authUser) setUser(authUser);
      } else if (event === 'SIGNED_OUT') {
        if (!localStorage.getItem(LOCAL_SESSION_KEY)) setUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const login = useCallback(async ({ email, password }: LoginCredentials) => {
    if (!email || !password) throw new Error('Email and password are required');

    // Try Supabase auth first
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (!error) return; // success — onAuthStateChange will set the user
    } catch {
      // network error — fall through to local auth
    }

    // Fall back to local session (no Supabase users set up yet)
    const localUser = buildLocalUser(email);
    localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(localUser));
    setUser(localUser);
  }, []);

  const logout = useCallback(async () => {
    localStorage.removeItem(LOCAL_SESSION_KEY);
    await supabase.auth.signOut();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
