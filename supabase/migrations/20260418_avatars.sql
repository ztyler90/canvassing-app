-- ============================================================
-- KnockIQ — Profile pictures
-- Adds avatar_url to users and provisions the "avatars" Storage bucket
-- so reps can upload a profile picture from the profile screen.
-- ============================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- ── Supabase Storage bucket ───────────────────────────────────────────────────
-- The uploadAvatar() helper writes to the "avatars" bucket and reads back
-- a public URL. Create the bucket ONE of these three ways:
--
-- Option A (easiest): Supabase Dashboard → Storage → New Bucket
--   Name:    avatars
--   Public:  YES (tick the "Public bucket" box so the URLs load in <img>)
--
-- Option B: Supabase CLI
--   supabase storage create avatars --public
--
-- Option C: SQL (works in the dashboard SQL editor — uses service role)
INSERT INTO storage.buckets (id, name, public)
  VALUES ('avatars', 'avatars', true)
  ON CONFLICT (id) DO NOTHING;

-- ── Storage RLS policies ──────────────────────────────────────────────────────
-- Anyone can READ avatars (the bucket is public).
-- Authenticated users can INSERT/UPDATE/DELETE objects under their own
-- user-id folder:   avatars/<auth.uid()>/<filename>
DROP POLICY IF EXISTS "Avatars are publicly readable" ON storage.objects;
CREATE POLICY "Avatars are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
CREATE POLICY "Users can upload their own avatar"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
CREATE POLICY "Users can update their own avatar"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users can delete their own avatar" ON storage.objects;
CREATE POLICY "Users can delete their own avatar"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
