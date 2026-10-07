import { useCallback, useEffect, useState, createContext, useContext, type ReactNode } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { Session, User } from '@supabase/supabase-js';

export type AuthCtx = {
  session: Session | null;
  user: User | null;
  ready: boolean;
  refresh: () => Promise<void>;
};

export const AuthContext = createContext<AuthCtx>({
  session: null,
  user: null,
  ready: false,
  refresh: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  // Stable reference so effects depending on `refresh` don't re-run on every render
  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setReady(true);
      return;
    }
    const { data } = await supabase.auth.getSession();
    setSession(data.session);
    setReady(true);
  }, []);

  useEffect(() => {
    let alive = true;
    if (!isSupabaseConfigured) {
      setReady(true);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      if (alive) {
        setSession(data.session);
        setReady(true);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      if (alive) {
        setSession(next);
        setReady(true);
      }
    });

    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider
      value={{ session, user: session?.user ?? null, ready, refresh }}
    >
      {children}
    </AuthContext.Provider>
  );
}
