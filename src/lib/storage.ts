import { supabase } from '@/lib/supabase';
import { resolveMimeType } from '@/lib/helpers';

/** Private bucket created by the base migration. Never public. */
export const BUCKET = 'medical-records';
export const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB (matches the bucket limit)

export type StoredFile = {
  file_name: string;
  storage_path: string;
  mime_type: string;
  file_size: number;
};

/** Returns an error message, or null when the file is acceptable. */
export function validateFile(f: File): string | null {
  const okType = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'].includes(f.type);
  if (!okType && !/\.(pdf|png|jpg|jpeg)$/i.test(f.name)) {
    return 'Invalid file format. Please choose a PDF, JPEG, or PNG file.';
  }
  if (f.size > MAX_FILE_SIZE) {
    return 'File exceeds the 20 MB limit. Please select a smaller file.';
  }
  if (f.size === 0) return 'This file is empty. Please choose another file.';
  return null;
}

/**
 * Upload into the caller's own private folder:  <user_id>/<folder>/<uuid>.<ext>
 * Storage RLS only lets a user touch objects whose first path segment is their id.
 */
export async function uploadPrivateFile(
  userId: string,
  folder: 'prescriptions' | 'receipts',
  file: File
): Promise<{ data: StoredFile | null; error: string | null }> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
  const storage_path = `${userId}/${folder}/${crypto.randomUUID()}.${ext}`;
  const mime_type = resolveMimeType(file);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storage_path, file, { contentType: mime_type, upsert: false });
  if (error) return { data: null, error: error.message };
  return {
    data: { file_name: file.name, storage_path, mime_type, file_size: file.size },
    error: null,
  };
}

export async function removeStoredFiles(paths: (string | null | undefined)[]): Promise<string | null> {
  const list = paths.filter(Boolean) as string[];
  if (list.length === 0) return null;
  const { error } = await supabase.storage.from(BUCKET).remove(list);
  return error ? error.message : null;
}

/** Short-lived signed URL for a private object the caller (or an active share) may read. */
export async function signedUrl(
  path: string,
  seconds = 120
): Promise<{ url: string | null; error: string | null }> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, seconds);
  if (error) return { url: null, error: error.message };
  return { url: data?.signedUrl ?? null, error: null };
}

export function formatFileSize(bytes?: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
