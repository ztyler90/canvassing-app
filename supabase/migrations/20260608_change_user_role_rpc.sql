-- Owner-only role flip — promote a rep to manager, or demote a
-- platform manager back to rep, without leaving the app.
-- ──────────────────────────────────────────────────────────────────
-- A single SECURITY DEFINER RPC handles both directions and bakes
-- in the safety rules so the UI can't get them wrong:
--
--   • Only the org owner may call it. Any other manager (or any rep)
--     gets EXCEPTION before any write happens.
--   • Target must be a member of the caller's org.
--   • Target may not be the org owner (no self-demotion of the
--     owner, no demotion of the owner by themselves, no demotion of
--     the owner by a super-admin into a broken state).
--   • Caller cannot demote themselves (defensive — owner is already
--     blocked above, but this also stops a future scenario where
--     somebody else with manager rights might run the RPC).
--   • new_role must be 'rep' or 'manager'. Anything else explodes.
--
-- When promoting rep → manager we seed manager_notify_phases =
-- ARRAY['booked'] (only if currently empty) so the freshly-promoted
-- manager starts receiving the lightest-touch Booked email — same
-- default the Add-manager flow gives platform invites.
--
-- When demoting manager → rep we clear manager_notify_phases so
-- they stop being CC'd on pipeline alerts.

create or replace function public.change_user_role(
  target_user_id uuid,
  new_role       text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id   uuid := auth.uid();
  caller_org  uuid;
  owner_id    uuid;
  target_org  uuid;
  is_super    boolean;
begin
  if new_role not in ('rep', 'manager') then
    raise exception 'change_user_role: new_role must be rep or manager (got %)', new_role
      using errcode = '22023';
  end if;

  if caller_id is null then
    raise exception 'change_user_role: not authenticated'
      using errcode = '28000';
  end if;

  -- Caller's org + manager check (super-admin allowed too — they can
  -- support a stuck owner from internal tooling).
  select u.organization_id
    into caller_org
    from public.users u
   where u.id = caller_id
     and (u.role = 'manager' or u.is_super_admin = true);

  if caller_org is null then
    raise exception 'change_user_role: caller is not a manager'
      using errcode = '42501';
  end if;

  -- Owner check — only the org owner (or a super-admin) may flip
  -- roles. A regular manager can't promote/demote teammates.
  select o.owner_user_id
    into owner_id
    from public.organizations o
   where o.id = caller_org;

  select coalesce(u.is_super_admin, false)
    into is_super
    from public.users u
   where u.id = caller_id;
  -- Caller must be either the org owner or a super-admin (the
  -- internal-support escape hatch).
  if (owner_id is distinct from caller_id) and is_super = false then
    raise exception 'change_user_role: only the org owner may change roles'
      using errcode = '42501';
  end if;

  -- Target must be in the same org as the caller.
  select u.organization_id
    into target_org
    from public.users u
   where u.id = target_user_id;

  if target_org is null then
    raise exception 'change_user_role: target user not found'
      using errcode = 'P0002';
  end if;

  if target_org is distinct from caller_org then
    raise exception 'change_user_role: target user is not in your organization'
      using errcode = '42501';
  end if;

  -- Never let anybody flip the org owner.
  if target_user_id = owner_id then
    raise exception 'change_user_role: cannot change the org owner''s role'
      using errcode = '42501';
  end if;

  -- Defensive: refuse self-demotion (the owner check above already
  -- blocks the realistic case, but this also covers a super-admin
  -- aiming the RPC at themselves and friends-of-bugs).
  if target_user_id = caller_id and new_role = 'rep' then
    raise exception 'change_user_role: cannot demote yourself'
      using errcode = '42501';
  end if;

  if new_role = 'manager' then
    update public.users
       set role = 'manager',
           -- Seed the lightest-touch default if not already set.
           manager_notify_phases = case
             when coalesce(array_length(manager_notify_phases, 1), 0) = 0
               then ARRAY['booked']::text[]
             else manager_notify_phases
           end
     where id = target_user_id;
  else
    update public.users
       set role = 'rep',
           manager_notify_phases = '{}'::text[]
     where id = target_user_id;
  end if;
end;
$$;

-- SECURITY DEFINER + explicit grants. Revoke from public, allow
-- authenticated. The function itself enforces owner-only, so
-- granting to authenticated is safe.
revoke all on function public.change_user_role(uuid, text) from public;
grant execute on function public.change_user_role(uuid, text) to authenticated;
