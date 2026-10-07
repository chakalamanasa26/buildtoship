import { supabase, isSupabaseConfigured } from '@/lib/supabase';

export { localToday } from '@/lib/datetime';

/** Mime types accepted by the 'medical-records' storage bucket. */
export function resolveMimeType(file: File): string {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (file.type === 'image/jpg') return 'image/jpeg';
  return file.type || 'application/octet-stream';
}

export async function hashToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function recordAudit(
  userId: string | undefined,
  action: string,
  title: string,
  metadata?: Record<string, any>
) {
  if (!userId || !isSupabaseConfigured) return;
  try {
    await supabase.from('audit_logs').insert({
      user_id: userId,
      action,
      event_type: action,
      title,
      metadata: metadata || {},
    });
  } catch {
    // Audit log insertion fails silently if table is not yet migrated
  }
}
