-- Postgres grants EXECUTE to PUBLIC on every new function, and anon inherits
-- through PUBLIC. An earlier migration revoked the explicit anon grant but NOT
-- the inherited PUBLIC access, so anon could still execute these functions.
-- Revoke PUBLIC from all SECURITY DEFINER functions so anon only retains access
-- where it has an EXPLICIT grant. Safe because Supabase grants
-- anon/authenticated/service_role explicitly by default — every role that needs
-- access keeps it; only the redundant PUBLIC path is removed.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    execute format('revoke execute on function %s from public', r.sig);
  end loop;
end $$;

-- Re-assert anon ONLY on the genuinely public-facing helpers (idempotent).
grant execute on function public.lookup_invite_code(text)        to anon;
grant execute on function public.auth_is_owner()                 to anon;
grant execute on function public.auth_is_super_admin()           to anon;
grant execute on function public.auth_organization_id()          to anon;
grant execute on function public.is_current_user_super_admin()   to anon;
