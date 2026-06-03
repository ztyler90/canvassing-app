-- Manager-set monthly team goal for the Goal Tracker on Manager Dashboard.
--
-- Until now we derived the monthly goal as (daily_goal_value × periodDays),
-- which over-counts for solo orgs and teams that don't canvass every day.
-- This column lets a manager declare the team-wide monthly target directly.
-- Null means "no override — fall back to the auto-calc heuristic on the
-- client". The unit (dollars vs. estimates/appointments) follows
-- organizations.daily_goal_type, same as daily_goal_value.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS monthly_goal_value numeric NULL;

COMMENT ON COLUMN public.organizations.monthly_goal_value IS
  'Optional manager-set monthly team goal used by GoalTrackerCard on the manager dashboard. Unit follows daily_goal_type (dollars when revenue; estimates/appointments otherwise). NULL means auto-derive on the client.';
