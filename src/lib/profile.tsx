import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { calcAge, type Age } from '@/lib/datetime';
import type { Profile } from '@/lib/types';

type ProfileCtx = {
  profile: Profile | null;
  loading: boolean;
  /** Age calculated from date_of_birth for *today*; null when DOB not set. */
  age: Age | null;
  refresh: () => Promise<void>;
};

const ProfileContext = createContext<ProfileCtx>({
  profile: null,
  loading: false,
  age: null,
  refresh: async () => {},
});

export const useProfile = () => useContext(ProfileContext);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id;
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  // Re-derive the age when the calendar day rolls over while the app stays open.
  const [dayKey, setDayKey] = useState(() => new Date().toDateString());

  const refresh = useCallback(async () => {
    if (!userId || !isSupabaseConfigured) {
      setProfile(null);
      return;
    }
    setLoading(true);
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
    setProfile((data as Profile | null) ?? null);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const t = window.setInterval(() => {
      const k = new Date().toDateString();
      setDayKey((prev) => (prev === k ? prev : k));
    }, 60_000);
    return () => window.clearInterval(t);
  }, []);

  const age = useMemo(
    () => calcAge(profile?.date_of_birth),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile?.date_of_birth, dayKey]
  );

  const value = useMemo(
    () => ({ profile, loading, age, refresh }),
    [profile, loading, age, refresh]
  );
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}
