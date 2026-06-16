-- Manager opt-in: share the team-wide rep leaderboard with individual reps.
--
-- When ON, each rep sees a bar-chart of team performance (toggleable across
-- doors / conversations / estimates / bookings / revenue) on their dashboard,
-- with their own bar highlighted so they know where they stand. Off by default
-- so a team's relative standings aren't exposed unless the manager chooses to.
--
-- The underlying leaderboard data is already readable by reps (same-org RLS on
-- canvassing_sessions); this flag only governs whether the rep-facing UI shows.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS share_leaderboard boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.share_leaderboard IS
  'Manager opt-in. When true, individual reps can see the team leaderboard bar-chart (doors/conversations/estimates/bookings/revenue) on their dashboard. Default false.';
