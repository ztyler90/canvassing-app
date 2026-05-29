-- ============================================================
-- KnockIQ — Auto-close idle canvassing sessions
-- ============================================================
-- Without this, a session whose tab gets closed (or whose rep forgets
-- to tap "End Session") stays in status='active' forever, broadcasting
-- the rep's last-known GPS pin to the manager dashboard and (worse)
-- accruing whatever GPS state the SessionContext snapshot held. That's
-- a privacy + accuracy mess.
--
-- This migration adds a server-side sweep that closes any session whose
-- newest gps_point or interaction is older than IDLE_THRESHOLD (60 min)
-- and clears the corresponding rep_locations row. The client-side
-- inactivity timer in ActiveCanvassing.jsx normally handles this, but
-- the server-side job is a belt-and-suspenders for the "tab closed"
-- and "rep walked away from device" cases.
--
-- Schedule: every 10 minutes via pg_cron (or scheduled edge fn if
-- pg_cron isn't on your plan).
-- ============================================================

CREATE OR REPLACE FUNCTION public.auto_close_idle_sessions()
RETURNS TABLE (
  closed_session_id  uuid,
  rep_id             uuid,
  idle_minutes       integer,
  ran_at             timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_idle_threshold interval := interval '60 minutes';
  v_now            timestamptz := now();
  r                record;
BEGIN
  -- For each session still flagged active, compute the timestamp of
  -- the most recent gps_point or interaction. If both are missing or
  -- both are older than the threshold, mark the session abandoned.
  --
  -- We use the session's started_at as a fallback so a session that
  -- was created but never logged a point or interaction can still be
  -- swept after 60 min instead of living forever.
  FOR r IN
    WITH activity AS (
      SELECT
        s.id            AS session_id,
        s.rep_id        AS rep_id,
        GREATEST(
          s.started_at,
          COALESCE((SELECT MAX(recorded_at) FROM public.gps_points   WHERE session_id = s.id), s.started_at),
          COALESCE((SELECT MAX(created_at)  FROM public.interactions WHERE session_id = s.id), s.started_at)
        ) AS last_activity_at
      FROM public.canvassing_sessions s
      WHERE s.status = 'active'
    )
    SELECT *,
           EXTRACT(EPOCH FROM (v_now - last_activity_at))::int / 60 AS idle_min
      FROM activity
     WHERE v_now - last_activity_at > v_idle_threshold
  LOOP
    -- Mark the session abandoned with the timestamp of last activity
    -- as the ended_at, not now() — so the post-mortem "how long was
    -- this session?" still reads correctly.
    UPDATE public.canvassing_sessions
       SET status   = 'abandoned',
           ended_at = COALESCE(
             (SELECT MAX(recorded_at) FROM public.gps_points   WHERE session_id = r.session_id),
             (SELECT MAX(created_at)  FROM public.interactions WHERE session_id = r.session_id),
             started_at
           )
     WHERE id = r.session_id;

    -- Clear the live rep_locations pin so the manager dashboard stops
    -- showing the rep as on-route.
    BEGIN
      DELETE FROM public.rep_locations WHERE rep_id = r.rep_id;
    EXCEPTION WHEN undefined_table THEN
      NULL;
    END;

    closed_session_id := r.session_id;
    rep_id            := r.rep_id;
    idle_minutes      := r.idle_min;
    ran_at            := v_now;
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.auto_close_idle_sessions() IS
  'Belt-and-suspenders for the client-side 60-min inactivity timer in '
  'ActiveCanvassing.jsx. Runs every 10 min via pg_cron, closes any '
  'session with no gps_point or interaction in 60+ min, and clears '
  'the rep_locations pin so managers stop seeing stale "on route" data.';

-- ── Schedule via pg_cron ────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('knockiq_auto_close_idle_sessions')
      WHERE EXISTS (
        SELECT 1 FROM cron.job WHERE jobname = 'knockiq_auto_close_idle_sessions'
      );
    PERFORM cron.schedule(
      'knockiq_auto_close_idle_sessions',
      '*/10 * * * *',  -- every 10 minutes
      $cron$SELECT public.auto_close_idle_sessions();$cron$
    );
  END IF;
END $$;
