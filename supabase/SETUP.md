# MediVault Supabase Database Setup & Configuration Guide

This guide details the required database schema, row-level security (RLS), storage configuration, and authentication settings for MediVault.

---

## 1. Supabase Project Credentials

MediVault uses the following Supabase project:
- **Project URL**: `https://gfxetbwzwftasfrfsfvy.supabase.co`
- **Publishable Key**: `sb_publishable_RSAsGwR3Fhxu5yGe9DFgfg_e6BPYEPc`

Set these environment variables in your `.env` or Replit Secrets:
```env
NEXT_PUBLIC_SUPABASE_URL=https://gfxetbwzwftasfrfsfvy.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_RSAsGwR3Fhxu5yGe9DFgfg_e6BPYEPc
VITE_SUPABASE_URL=https://gfxetbwzwftasfrfsfvy.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_RSAsGwR3Fhxu5yGe9DFgfg_e6BPYEPc
```

*(Note: MediVault's Supabase client is configured to accept both `NEXT_PUBLIC_` and `VITE_` prefixes).*

---

## 2. Apply Database Migration

Open the **Supabase Dashboard** for project `gfxetbwzwftasfrfsfvy`:
1. Navigate to **SQL Editor** (`https://supabase.com/dashboard/project/gfxetbwzwftasfrfsfvy/sql`).
2. Click **New query**.
3. Copy the full contents of `supabase/migrations/20261007_medivault_schema.sql`.
4. Click **Run** (Ctrl + Enter).

### Verified Schema Tables:
1. `public.profiles`: Stores user profile (`full_name`, `email`), auto-populated upon sign-up via trigger on `auth.users`.
2. `public.medical_documents`: Stores metadata for patient records (`title`, `category`, `storage_path`, `mime_type`, `file_size`, `document_date`, `doctor_name`, `hospital_name`, `description`).
3. `public.appointments`: Tracks appointments (`doctor_name`, `hospital_name`, `appointment_date`, `appointment_time`, `reason`, `notes`, `status`).
4. `public.shares`: Manages secure sharing links (`recipient`, `permission` [`VIEW`, `VIEW_DOWNLOAD`], `token_hash`, `expires_at`, `max_views`, `view_count`, `revoked_at`).
5. `public.shared_documents`: Links multiple medical documents to a specific share.
6. `public.audit_logs`: Immutable audit trail for all security actions (`login`, `logout`, `document_uploaded`, `document_viewed`, `document_downloaded`, `share_created`, `share_revoked`, `appointment_created`).
7. `public.get_medical_share(p_token_hash)`: Security definer RPC function that validates token hash, verifies expiration and view limit, increments view count, and returns document metadata without exposing other user data.

---

## 3. Storage Bucket Configuration

The migration script creates and configures the private bucket:
- **Bucket ID**: `medical-records`
- **Public**: `false` (Private)
- **Max File Size**: 20 MB (20,971,520 bytes)
- **Allowed MIME types**: `application/pdf`, `image/jpeg`, `image/png`

### Storage RLS Policies:
- Only authenticated users can access their own folder: `(bucket_id = 'medical-records' AND auth.uid()::text = (storage.foldername(name))[1])`.
- Users cannot read or delete files uploaded by other users.

---

## 4. Authentication & "Email Rate Limit Exceeded" Fix

If you encounter:
```
{"code":429,"error_code":"over_email_send_rate_limit","msg":"email rate limit exceeded"}
```

### Root Cause:
Supabase's built-in email service is rate-limited to 3-4 emails per hour on the free tier. When `mailer_autoconfirm` is `false`, any sign-up or password reset attempts to send an email, immediately triggering the provider rate limit.

### Solution in Supabase Dashboard:
1. Go to **Authentication -> Providers -> Email** (`https://supabase.com/dashboard/project/gfxetbwzwftasfrfsfvy/auth/providers?provider=email`).
2. Toggle **Confirm email** to **OFF** (or enable Auto Confirm).
   - This allows new users to immediately log in after sign up without waiting for confirmation emails or hitting email rate limits.
3. For production email delivery, configure a custom SMTP provider (Resend, SendGrid, Amazon SES) under **Authentication -> SMTP Settings**.
