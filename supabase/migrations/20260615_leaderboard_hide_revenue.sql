-- Manager sub-option for the shared leaderboard: hide the Revenue ($) metric
-- from reps while still sharing activity standings (doors / conversations /
-- estimates / bookings). Off by default → revenue is shown when the leaderboard
-- is shared, matching the original behavior; managers who consider booked
-- dollars sensitive can flip this on.
--
-- Only meaningful when organizations.share_leaderboard = true.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS leaderboard_hide_revenue boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.leaderboard_hide_revenue IS
  'When true, the rep-facing team leaderboard omits the Revenue ($) metric (activity metrics still shown). Only applies when share_leaderboard = true. Default false.';
