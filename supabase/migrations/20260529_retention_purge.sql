-- ============================================================
-- KnockIQ — Automated data retention
-- ============================================================
-- Backstops the privacy policy's retention commitments. Until this
-- migration, every interaction / gps_point / photo / do_not_knock row
-- lived forever, which (a) made the policy's retention schedule a lie,
-- (b) violated MODPA's "strictly necessary" sensitive-data rule for
-- precise geolocation, and (c) created an ever-growing pool of
-- homeowner data to be subpoenaed or breached.
--
-- Retention periods (matching PRIVACY_POLICY.md §12):
--
--   interactions                — 24 months
--     photo_urls (storage objs) — purged with their parent row
--   interactions where
--     outcome = 'no_answer'     — 30 days   (data-minimized; see #18)
--   gps_points                  — 90 days
--   rep_locations               — purged when the parent session ends
--                                  (handled by clearRepLocation), but
--                                  this job also sweeps any orphans
--                                  older than 24 hours.
--   canvassing_sessions         — kept (business record); deleted only
--                                  if the rep account is deleted (FK).
--   do_not_knock                — KEPT INDEFINITELY (the whole point
--                                  is to remember the request).
--   audit_log / sub_processor_log if present — 12 months
--
-- Implementation: a single SECURITY DEFINER function plus a pg_cron
-- schedule that runs nightly at 03:15 UTC. If pg_cron is not available
-- in your Supabase plan, run the function manually or call it from a
-- scheduled Supabase Edge Function (see the comment at the bottom).
-- ============================================================

-- ── Configurable retention windows ─────────────────────────────────────
-- Adjust here if you want to change the policy. Anything you change in
-- the function MUST also be reflected in PRIVACY_POLICY.md §12, since
-- publishing a schedule the platform doesn't enforce is direct
-- regulatory and litigation exposure.
CREATE OR REPLACE FUNCTION public.purge_expired_data()
RETURNS TABLE (
  table_name      text,
  rows_deleted    bigint,
  ran_at          timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Retention windows. Edit here, then update PRIVACY_POLICY.md §12.
  v_interactions_retention      interval := interval '24 months';
  v_no_answer_retention         interval := interval '30 days';
  v_gps_retention               interval := interval '90 days';
  v_rep_locations_orphan_age    interval := interval '24 hours';

  v_deleted bigint;
  v_now     timestamptz := now();
  v_storage_paths text[];
BEGIN

  -- 1. Storage cleanup MUST happen before the row delete, because once
  --    the interactions row is gone we lose the photo_urls list and the
  --    storage objects orphan forever.
  --
  --    We collect every photo path on every interaction that's about to
  --    expire, then delete the storage.objects rows in a single pass.
  --    Falls back to a no-op if the storage schema isn't present
  --    (some self-hosted Supabase configs).
  BEGIN
    SELECT COALESCE(array_agg(p), ARRAY[]::text[])
      INTO v_storage_paths
      FROM (
        SELECT trim(BOTH '"' FROM (jsonb_array_elements(photo_urls))::text) AS p
          FROM public.interactions
         WHERE photo_urls IS NOT NULL
           AND photo_urls <> '[]'::jsonb
           AND (
             created_at < v_now - v_interactions_retention
             OR (outcome = 'no_answer' AND created_at < v_now - v_no_answer_retention)
           )
      ) sub;

    IF array_length(v_storage_paths, 1) > 0 THEN
      DELETE FROM storage.objects
       WHERE bucket_id = 'interaction-photos'
         AND name = ANY (v_storage_paths);
      GET DIAGNOSTICS v_deleted = ROW_COUNT;
      table_name   := 'storage.objects (interaction-photos)';
      rows_deleted := v_deleted;
      ran_at       := v_now;
      RETURN NEXT;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Don't let a storage hiccup stop the rest of the sweep.
    table_name   := 'storage.objects (interaction-photos)';
    rows_deleted := -1;  -- sentinel for "error; check logs"
    ran_at       := v_now;
    RETURN NEXT;
  END;

  -- 2. No-answer interactions on the short clock (30 days).
  --    Runs BEFORE the general 24-month sweep so the targeted purge
  --    catches rows that would otherwise still be in their grace period.
  DELETE FROM public.interactions
   WHERE outcome = 'no_answer'
     AND created_at < v_now - v_no_answer_retention;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  table_name   := 'interactions (no_answer)';
  rows_deleted := v_deleted;
  ran_at       := v_now;
  RETURN NEXT;

  -- 3. General interactions (24 months).
  DELETE FROM public.interactions
   WHERE created_at < v_now - v_interactions_retention;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  table_name   := 'interactions (general)';
  rows_deleted := v_deleted;
  ran_at       := v_now;
  RETURN NEXT;

  -- 4. GPS breadcrumbs (90 days).
  DELETE FROM public.gps_points
   WHERE recorded_at < v_now - v_gps_retention;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  table_name   := 'gps_points';
  rows_deleted := v_deleted;
  ran_at       := v_now;
  RETURN NEXT;

  -- 5. Orphan rep_locations (>24 h with no parent active session).
  --    Normally clearRepLocation() runs on session end; this catches
  --    anything that slipped through if the rep closed the tab.
  BEGIN
    DELETE FROM public.rep_locations rl
     WHERE rl.updated_at < v_now - v_rep_locations_orphan_age
        OR NOT EXISTS (
             SELECT 1 FROM public.canvassing_sessions s
              WHERE s.id = rl.session_id AND s.status = 'active'
           );
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    table_name   := 'rep_locations (orphans)';
    rows_deleted := v_deleted;
    ran_at       := v_now;
    RETURN NEXT;
  EXCEPTION WHEN undefined_table THEN
    -- rep_locations is added by a later migration in some setups; skip.
    NULL;
  END;

  -- 6. Audit log (12 months) — only if the table exists.
  BEGIN
    EXECUTE 'DELETE FROM public.audit_log WHERE created_at < $1'
       USING v_now - interval '12 months';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    table_name   := 'audit_log';
    rows_deleted := v_deleted;
    ran_at       := v_now;
    RETURN NEXT;
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.purge_expired_data() IS
  'Nightly retention sweep. Returns one row per table with the count of '
  'rows deleted. Driven by pg_cron (see schedule below) or, if pg_cron '
  'is unavailable on your plan, by a Supabase Edge Function invoked on '
  'a cron schedule.';

-- ── Schedule via pg_cron (if available) ────────────────────────────────
-- pg_cron is included on Supabase Pro and above. On Free, comment this
-- block out and use a scheduled Edge Function instead (template at end).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Idempotent: remove any prior schedule of the same name first.
    PERFORM cron.unschedule('knockiq_retention_purge')
      WHERE EXISTS (
        SELECT 1 FROM cron.job WHERE jobname = 'knockiq_retention_purge'
      );
    PERFORM cron.schedule(
      'knockiq_retention_purge',
      '15 3 * * *',  -- 03:15 UTC daily
      $cron$SELECT public.purge_expired_data();$cron$
    );
  END IF;
END $$;

-- ── Manual run (use after deploy to verify) ────────────────────────────
-- SELECT * FROM public.purge_expired_data();

-- ── Alternative: Supabase Edge Function for plans without pg_cron ──────
-- Create supabase/functions/purge-expired/index.ts with:
--
--   import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
--   Deno.serve(async () => {
--     const supabase = createClient(
--       Deno.env.get("SUPABASE_URL")!,
--       Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
--     );
--     const { data, error } = await supabase.rpc("purge_expired_data");
--     return new Response(JSON.stringify({ data, error }), {
--       headers: { "content-type": "application/json" },
--       status:  error ? 500 : 200,
--     });
--   });
--
-- Then schedule it from the Supabase dashboard → Edge Functions →
-- Cron, running nightly at 03:15 UTC.
