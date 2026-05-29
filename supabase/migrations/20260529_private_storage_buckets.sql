-- ============================================================
-- KnockIQ — Convert Storage buckets from PUBLIC to PRIVATE
-- ============================================================
-- Both the `avatars` and `interaction-photos` buckets were originally
-- created public so the app could render <img src={publicUrl}> directly.
-- That posture meant URL knowledge equaled read access — anyone who
-- intercepted or guessed a file path could read homeowner property
-- photos and rep profile pictures. Incompatible with any meaningful
-- safeguarding claim in the privacy policy.
--
-- After this migration:
--   * Both buckets are private (no anonymous access).
--   * Same-org SELECT RLS controls who can read each object.
--   * Client code mints short-lived signed URLs via lib/photos.js
--     (`usePhotoUrl` hook, `StoragePhoto` / `PhotoThumb` components).
--
-- Existing rows in users.avatar_url and interactions.photo_urls hold the
-- legacy full public URLs. The lib/photos.js extractStoragePath() helper
-- recognizes that format and pulls the path out, so old rows continue
-- to work without a data migration.
-- ============================================================

-- ── Flip the buckets to private ────────────────────────────────────────────
UPDATE storage.buckets
   SET public = false
 WHERE id IN ('avatars', 'interaction-photos');

-- ── Drop the legacy "publicly readable" policies ───────────────────────────
DROP POLICY IF EXISTS "Avatars are publicly readable"             ON storage.objects;
DROP POLICY IF EXISTS "Interaction photos are publicly readable"  ON storage.objects;
DROP POLICY IF EXISTS "Public read for interaction photos"        ON storage.objects;

-- ── New SELECT policies: same-org membership required ─────────────────────
-- AVATARS path format: <user_id>/<timestamp>.<ext>
-- A user can read another user's avatar iff they share an organization
-- (or they're reading their own).
DROP POLICY IF EXISTS "Avatars readable by same-org users" ON storage.objects;
CREATE POLICY "Avatars readable by same-org users"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND EXISTS (
      SELECT 1
        FROM public.users me
        JOIN public.users target
          ON target.id::text = (storage.foldername(name))[1]
       WHERE me.id = auth.uid()
         AND (
              me.id = target.id
           OR me.organization_id IS NOT DISTINCT FROM target.organization_id
         )
    )
  );

-- INTERACTION-PHOTOS path format: <interaction_id>/<timestamp>_<rand>.<ext>
-- A user can read an interaction's photo iff they're in the same org
-- as the interaction was logged in.
DROP POLICY IF EXISTS "Interaction photos readable by same-org users" ON storage.objects;
CREATE POLICY "Interaction photos readable by same-org users"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'interaction-photos'
    AND EXISTS (
      SELECT 1
        FROM public.interactions i
        JOIN public.users me ON me.id = auth.uid()
       WHERE i.id::text = (storage.foldername(name))[1]
         AND me.organization_id IS NOT DISTINCT FROM i.organization_id
    )
  );

-- ── INSERT / UPDATE / DELETE policies ─────────────────────────────────────
-- Avatars: existing per-user-folder policies from 20260418_avatars.sql
-- still apply (a user can write to avatars/<their-uid>/*). No change.
--
-- Interaction photos: tighten so only the rep who owns the interaction
-- can upload photos to it. Previous setup (if any) was permissive because
-- the bucket was public; we re-create it here explicitly.
DROP POLICY IF EXISTS "Reps can upload to their own interactions" ON storage.objects;
CREATE POLICY "Reps can upload to their own interactions"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'interaction-photos'
    AND EXISTS (
      SELECT 1 FROM public.interactions i
       WHERE i.id::text = (storage.foldername(name))[1]
         AND i.rep_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Reps can delete photos on their own interactions" ON storage.objects;
CREATE POLICY "Reps can delete photos on their own interactions"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'interaction-photos'
    AND EXISTS (
      SELECT 1 FROM public.interactions i
       WHERE i.id::text = (storage.foldername(name))[1]
         AND i.rep_id = auth.uid()
    )
  );

-- ── Sanity check ──────────────────────────────────────────────────────────
-- After running this migration, verify:
--   SELECT id, public FROM storage.buckets WHERE id IN ('avatars','interaction-photos');
-- Both rows should show public = false.
