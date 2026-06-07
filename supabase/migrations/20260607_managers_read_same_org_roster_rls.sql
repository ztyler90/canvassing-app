-- Non-owner managers could only read their OWN users row: managers_select_all
-- was gated on auth_is_owner(), so a role=manager who isn't the org owner had
-- no permissive SELECT covering teammates. This broke the Reps tab, rep
-- dropdowns, and any roster-dependent feature for "platform-seat" managers
-- (e.g. cory.robson@shackshine.com). It was also inconsistent: the "Managers
-- update reps in their org" UPDATE policy already lets same-org managers WRITE
-- rep rows — they just couldn't READ them.
--
-- The fix grants same-org managers SELECT. It must NOT use a self-subquery on
-- users inside a users SELECT policy — that re-enters RLS and causes
-- "infinite recursion detected in policy for relation users". Instead we use a
-- SECURITY DEFINER helper (auth_is_manager) that reads the role bypassing RLS,
-- mirroring the existing auth_organization_id() / auth_is_owner() pattern.
--
-- Reps are unaffected: the grant requires auth_is_manager() = true. The
-- restrictive tenant_isolation policy still scopes reads to the caller's org.

drop policy if exists "Managers read reps in their org" on public.users;

create or replace function public.auth_is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from users
    where id = auth.uid() and role = 'manager'
  );
$$;

create policy "Managers read reps in their org"
  on public.users for select
  using (
    (organization_id = auth_organization_id() and auth_is_manager())
    or auth_is_super_admin()
  );
