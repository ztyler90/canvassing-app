-- ============================================================
-- Chat RLS hardening
--
-- The original 20260603 chat policies used a self-referencing EXISTS
-- against chat_participants from the chat_participants SELECT policy,
-- which puts Postgres into a recursive evaluation. Symptom: the inbox
-- comes back empty (the user can't see their own participation rows,
-- so listMyConversations returns nothing), and getOrCreateDM silently
-- fails (the INSERT...SELECT can't see the new conversation row
-- because no participants exist yet to satisfy the SELECT policy).
--
-- Fix: replace the recursive subqueries with a SECURITY DEFINER helper
-- (chat_is_participant) that bypasses RLS to check membership. Also add
-- chat_get_or_create_dm as an atomic RPC so DM creation is a single
-- round-trip and doesn't depend on the client being able to read the
-- conversation row mid-creation.
-- ============================================================

-- ── Helper: bypass-RLS participant check ───────────────────────────────────
-- SECURITY DEFINER + stable so PostgREST can call it from policies without
-- triggering the recursion that motivated this migration.
create or replace function public.chat_is_participant(p_conv uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.chat_participants
    where conversation_id = p_conv
      and user_id = auth.uid()
  );
$$;

grant execute on function public.chat_is_participant(uuid) to authenticated;

-- ── Rewrite SELECT policies to use the helper ──────────────────────────────
drop policy if exists "conv: participant can read" on public.chat_conversations;
create policy "conv: participant can read"
  on public.chat_conversations for select
  using (public.chat_is_participant(id));

drop policy if exists "part: own conv participants" on public.chat_participants;
create policy "part: own conv participants"
  on public.chat_participants for select
  using (
    user_id = auth.uid()
    or public.chat_is_participant(conversation_id)
  );

drop policy if exists "msg: participant can read" on public.chat_messages;
create policy "msg: participant can read"
  on public.chat_messages for select
  using (public.chat_is_participant(conversation_id));

-- INSERT policy: re-state using the helper so a future trigger-driven
-- send doesn't have to do its own membership lookup.
drop policy if exists "msg: participant can send" on public.chat_messages;
create policy "msg: participant can send"
  on public.chat_messages for insert
  with check (
    sender_id = auth.uid()
    and public.chat_is_participant(conversation_id)
  );

-- ── Atomic DM creation ─────────────────────────────────────────────────────
-- The previous client-side getOrCreateDM did insert → select-back → insert
-- participants. With RLS the select-back couldn't see the new conversation
-- (no participants yet), so the function would silently return null. We
-- replace it with a single SECURITY DEFINER RPC that:
--   1. Validates both users belong to the same org.
--   2. Looks up an existing DM by the deterministic dm_key.
--   3. Creates the conversation + both participant rows in one transaction.
--   4. Returns the conversation id (callable across re-runs — idempotent).
create or replace function public.chat_get_or_create_dm(p_other uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me        uuid := auth.uid();
  v_org       uuid;
  v_other_org uuid;
  v_key       text;
  v_conv      uuid;
begin
  if v_me is null or p_other is null or v_me = p_other then
    return null;
  end if;

  select organization_id into v_org
    from public.users where id = v_me;
  select organization_id into v_other_org
    from public.users where id = p_other;
  if v_org is null or v_org is distinct from v_other_org then
    return null;
  end if;

  -- Deterministic dedupe key — sorted user ids joined by '|'. Mirrors the
  -- partial unique index on chat_conversations.dm_key so concurrent calls
  -- collapse to one row even if two clients race.
  v_key := case when v_me::text < p_other::text
    then v_me::text || '|' || p_other::text
    else p_other::text || '|' || v_me::text
  end;

  select id into v_conv
    from public.chat_conversations
    where organization_id = v_org and type = 'dm' and dm_key = v_key
    limit 1;

  if v_conv is null then
    insert into public.chat_conversations (organization_id, type, dm_key)
      values (v_org, 'dm', v_key)
      returning id into v_conv;
  end if;

  insert into public.chat_participants (conversation_id, user_id)
    values (v_conv, v_me), (v_conv, p_other)
    on conflict do nothing;

  return v_conv;
end;
$$;

grant execute on function public.chat_get_or_create_dm(uuid) to authenticated;
