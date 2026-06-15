-- Auth hardening: remove anon EXECUTE from privileged SECURITY DEFINER RPCs that
-- were created AFTER 20260606_harden_revoke_public_execute and therefore still
-- carried default anon/PUBLIC grants (flagged by the Supabase security advisor,
-- lint 0028 anon_security_definer_function_executable). Each target is only ever
-- called by an authenticated user in the app; authenticated + service_role
-- grants are left intact so nothing breaks.
--
-- Deliberately NOT touched: the auth_* RLS helpers (auth_is_owner,
-- auth_is_super_admin, auth_organization_id, is_current_user_super_admin,
-- auth_is_manager) keep their anon EXECUTE — they are evaluated inside RLS
-- policies in anon context during signup/invite flows and were intentionally
-- granted to anon in 20260606_harden_revoke_public_execute.
--
-- Applied to prod 2026-06-14 via Supabase MCP; this file mirrors that change for
-- source-control parity.

-- Owner-only role management RPC (promote/demote manager). Server-enforced, but
-- anon has no business reaching it. (No PUBLIC grant was present; revoke anon only.)
revoke execute on function public.change_user_role(uuid, text) from anon;

-- Growth admin RPC — only ever called from the authenticated growth portal.
revoke execute on function public.growth_create_offer(text, text, integer) from public, anon;

-- Growth referral credit — called only AFTER sign-in in the signup flow.
revoke execute on function public.growth_apply_referral(text, text) from public, anon;

-- Strip the redundant PUBLIC grant from the manager RLS helper, keeping the
-- intentional anon grant it shares with the other auth_* helpers.
revoke execute on function public.auth_is_manager() from public;
