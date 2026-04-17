-- Photos and follow-up flags for interactions
-- Run this in the Supabase Dashboard > SQL Editor

-- Add follow_up, follow_up_notes, and photo_urls to interactions
ALTER TABLE public.interactions
  ADD COLUMN IF NOT EXISTS follow_up       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS follow_up_notes TEXT,
  ADD COLUMN IF NOT EXISTS photo_urls      JSONB   NOT NULL DEFAULT '[]'::jsonb;

-- ── Supabase Storage bucket ────────────────────────────────────────────────────
-- After running this SQL, you must also create the storage bucket.
-- Option A: Supabase Dashboard → Storage → New Bucket
--   Name: interaction-photos
--   Public bucket: YES (check the box)
--
-- Option B: Supabase CLI
--   supabase storage create interaction-photos --public
--
-- Option C: SQL (requires supabase_storage_admin or service role)
-- INSERT INTO storage.buckets (id, name, public)
--   VALUES ('interaction-photos', 'interaction-photos', true)
--   ON CONFLICT (id) DO NOTHING;
