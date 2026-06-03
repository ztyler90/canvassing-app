-- ============================================================
-- Team Chat — schema for in-app DMs + org team channel
--
-- Adds three tables:
--   1. chat_conversations  — a thread (either the org's #all room or a 1:1 DM)
--   2. chat_participants   — who's in each conversation + per-user last_read_at
--   3. chat_messages       — message rows; one realtime channel listens here
--
-- Design notes:
--   • One #all conversation per org, auto-created by trigger so existing
--     orgs and new ones don't need a manual seed step.
--   • DM uniqueness is enforced by a deterministic key (sorted user ids)
--     so getOrCreateDM() is idempotent — no duplicate threads if both
--     users tap "message" at the same moment.
--   • RLS is scoped by participant membership (not org), so a DM in org A
--     can't be peeked at by other org members even if they share an org.
--   • chat_messages is added to the supabase_realtime publication so the
--     client can subscribe to INSERTs for instant delivery.
-- ============================================================

-- ── 1. Conversations ────────────────────────────────────────────────────────
create table if not exists public.chat_conversations (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations(id) on delete cascade,
  type            text        not null check (type in ('team', 'dm')),
  -- For team channels: display name (e.g. "All Team"). NULL for DMs — UI
  -- derives the DM title from the other participant's name.
  name            text,
  -- DM dedupe key: lower-uuid|higher-uuid for DM rows, NULL for team. The
  -- partial unique index below makes this idempotent.
  dm_key          text,
  created_at      timestamptz not null default now(),
  -- Bumped by trigger whenever a message lands. Drives inbox sorting
  -- ("most recent activity at top") without a window-function read.
  last_message_at timestamptz not null default now()
);

-- One team conversation per org. Partial index — only enforced when type='team'.
create unique index if not exists chat_conversations_team_per_org_uq
  on public.chat_conversations (organization_id)
  where type = 'team';

-- One DM per (org, sorted-user-pair). Partial — only enforced for DMs.
create unique index if not exists chat_conversations_dm_unique_uq
  on public.chat_conversations (organization_id, dm_key)
  where type = 'dm';

-- Indexes for the common lookups: inbox sort + per-org listing.
create index if not exists chat_conversations_org_last_idx
  on public.chat_conversations (organization_id, last_message_at desc);

-- ── 2. Participants ─────────────────────────────────────────────────────────
create table if not exists public.chat_participants (
  conversation_id uuid        not null references public.chat_conversations(id) on delete cascade,
  user_id         uuid        not null references public.users(id) on delete cascade,
  -- Drives the unread badge: messages with created_at > last_read_at are unread.
  -- NULL means "never opened" — every message is unread on first load.
  last_read_at    timestamptz,
  joined_at       timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists chat_participants_user_idx
  on public.chat_participants (user_id);

-- ── 3. Messages ─────────────────────────────────────────────────────────────
create table if not exists public.chat_messages (
  id              uuid        primary key default gen_random_uuid(),
  conversation_id uuid        not null references public.chat_conversations(id) on delete cascade,
  sender_id       uuid        not null references public.users(id) on delete cascade,
  body            text        not null check (length(trim(body)) > 0 and length(body) <= 4000),
  created_at      timestamptz not null default now()
);

-- Most common read: latest N messages in a conversation, newest first.
create index if not exists chat_messages_conv_created_idx
  on public.chat_messages (conversation_id, created_at desc);

-- ── 4. Trigger: bump last_message_at on insert ──────────────────────────────
create or replace function public.chat_messages_bump_conversation()
returns trigger as $$
begin
  update public.chat_conversations
    set last_message_at = new.created_at
    where id = new.conversation_id;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists chat_messages_bump_trg on public.chat_messages;
create trigger chat_messages_bump_trg
  after insert on public.chat_messages
  for each row execute function public.chat_messages_bump_conversation();

-- ── 5. Auto-create #all conversation for each org ──────────────────────────
-- Called on org creation; also backfilled for existing orgs at the bottom
-- of this migration so the team channel exists everywhere by the time the
-- client tries to ensureTeamConversation().
create or replace function public.chat_ensure_team_conversation_for_org(p_org uuid)
returns uuid
language plpgsql
security definer
as $$
declare
  v_conv uuid;
begin
  select id into v_conv
    from public.chat_conversations
    where organization_id = p_org and type = 'team'
    limit 1;
  if v_conv is null then
    insert into public.chat_conversations (organization_id, type, name)
      values (p_org, 'team', 'All Team')
      returning id into v_conv;
  end if;
  -- Add every active org member as a participant (idempotent ON CONFLICT).
  insert into public.chat_participants (conversation_id, user_id)
    select v_conv, u.id
      from public.users u
      where u.organization_id = p_org
    on conflict do nothing;
  return v_conv;
end;
$$;

-- Trigger: when a new org is created, seed its team channel.
create or replace function public.chat_seed_team_channel_on_org_insert()
returns trigger as $$
begin
  perform public.chat_ensure_team_conversation_for_org(new.id);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists chat_seed_team_trg on public.organizations;
create trigger chat_seed_team_trg
  after insert on public.organizations
  for each row execute function public.chat_seed_team_channel_on_org_insert();

-- Trigger: when a user joins an org (insert OR organization_id update), add
-- them to the org's team conversation. Idempotent — duplicate participant
-- inserts are swallowed by the primary key.
create or replace function public.chat_add_user_to_team_channel()
returns trigger as $$
declare
  v_conv uuid;
begin
  if new.organization_id is null then return new; end if;
  -- Only act when the org actually changed (or this is an insert).
  if tg_op = 'UPDATE' and old.organization_id is not distinct from new.organization_id then
    return new;
  end if;
  v_conv := public.chat_ensure_team_conversation_for_org(new.organization_id);
  insert into public.chat_participants (conversation_id, user_id)
    values (v_conv, new.id)
    on conflict do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists chat_add_user_to_team_trg on public.users;
create trigger chat_add_user_to_team_trg
  after insert or update of organization_id on public.users
  for each row execute function public.chat_add_user_to_team_channel();

-- ── 6. Row Level Security ──────────────────────────────────────────────────
alter table public.chat_conversations enable row level security;
alter table public.chat_participants  enable row level security;
alter table public.chat_messages      enable row level security;

-- Conversations: a user can see a conversation iff they're a participant.
drop policy if exists "conv: participant can read" on public.chat_conversations;
create policy "conv: participant can read"
  on public.chat_conversations for select
  using (
    exists (
      select 1 from public.chat_participants p
      where p.conversation_id = chat_conversations.id
        and p.user_id = auth.uid()
    )
  );

-- Conversations: a user can create a DM in their own org. Team channels
-- are created by triggers, not the client.
drop policy if exists "conv: org member can create dm" on public.chat_conversations;
create policy "conv: org member can create dm"
  on public.chat_conversations for insert
  with check (
    type = 'dm'
    and organization_id = (
      select organization_id from public.users where id = auth.uid()
    )
  );

-- Participants: a user can see participant rows for conversations they're
-- in. This lets the client render the "members" of a DM or team channel.
drop policy if exists "part: own conv participants" on public.chat_participants;
create policy "part: own conv participants"
  on public.chat_participants for select
  using (
    exists (
      select 1 from public.chat_participants me
      where me.conversation_id = chat_participants.conversation_id
        and me.user_id = auth.uid()
    )
  );

-- Participants: a user can insert participants when creating a DM. We
-- only allow inserting (self) OR (someone in the same org as self).
drop policy if exists "part: insert self or same-org for new dm" on public.chat_participants;
create policy "part: insert self or same-org for new dm"
  on public.chat_participants for insert
  with check (
    user_id = auth.uid()
    or exists (
      select 1
      from public.users me
      join public.users other on other.organization_id = me.organization_id
      where me.id    = auth.uid()
        and other.id = chat_participants.user_id
    )
  );

-- Participants: a user can update only their own row (last_read_at).
drop policy if exists "part: update own last_read" on public.chat_participants;
create policy "part: update own last_read"
  on public.chat_participants for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Messages: a user can read messages in conversations they're in.
drop policy if exists "msg: participant can read" on public.chat_messages;
create policy "msg: participant can read"
  on public.chat_messages for select
  using (
    exists (
      select 1 from public.chat_participants p
      where p.conversation_id = chat_messages.conversation_id
        and p.user_id = auth.uid()
    )
  );

-- Messages: a user can send to conversations they're in, must be sender.
drop policy if exists "msg: participant can send" on public.chat_messages;
create policy "msg: participant can send"
  on public.chat_messages for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.chat_participants p
      where p.conversation_id = chat_messages.conversation_id
        and p.user_id = auth.uid()
    )
  );

-- ── 7. Realtime publication ────────────────────────────────────────────────
-- Add the chat tables to the supabase_realtime publication so the client
-- can subscribe to INSERTs/UPDATEs. Each ALTER is wrapped in DO so it's
-- idempotent across re-runs.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'chat_conversations'
  ) then
    alter publication supabase_realtime add table public.chat_conversations;
  end if;
end $$;

-- ── 8. Backfill: seed team channel + members for existing orgs ─────────────
-- Safe to run repeatedly — chat_ensure_team_conversation_for_org is idempotent.
do $$
declare
  r record;
begin
  for r in select id from public.organizations loop
    perform public.chat_ensure_team_conversation_for_org(r.id);
  end loop;
end $$;
