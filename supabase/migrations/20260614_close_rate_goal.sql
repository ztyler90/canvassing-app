-- Manager-set Close Rate goal for the Overview's Close Rate gauge.
--
-- The Close Rate card on the manager dashboard previously hard-coded its
-- target at 5%. This column lets a manager declare the team's own target.
-- NULL means "no override — fall back to the 5.0% default on the client".
--
-- Definition note: across the dashboard, "close rate" means
-- conversation -> booked job (bookings / conversations), NOT bookings / doors.
-- This goal is the percentage of conversations the team aims to turn into
-- booked jobs.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS close_rate_goal numeric NULL;

COMMENT ON COLUMN public.organizations.close_rate_goal IS
  'Optional manager-set Close Rate target (percent) used by the Close Rate gauge on the manager dashboard. Close rate = bookings / conversations (conversation -> booked job). NULL means use the 5.0% client default.';
