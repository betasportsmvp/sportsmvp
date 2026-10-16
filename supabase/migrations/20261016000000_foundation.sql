-- Phase 0 foundation: profiles, groups, memberships, invites, sessions, attendance, audit.
--
-- Access model
--   * Every table has RLS enabled and is default-deny.
--   * The browser (role `authenticated`) may only SELECT, plus update its own profile's
--     display fields. All other writes go through the SECURITY DEFINER commands below,
--     which check membership/role, honour an idempotency key, and write an audit event
--     in the same transaction.
--   * `anon` gets nothing.
--
-- Errors raised by commands use SQLSTATE P0001 with a stable machine-readable message
-- (for example `forbidden`, `invite_invalid`) that the app maps to friendly copy.

-- ---------------------------------------------------------------------------
-- Types and shared helpers
-- ---------------------------------------------------------------------------

create type public.member_role as enum ('owner', 'admin', 'member');
create type public.session_status as enum ('open', 'closed');
create type public.attendance_status as enum ('present', 'absent');

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text not null default '' check (char_length(display_name) <= 80),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 2048),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  sport text not null default 'tennis' check (char_length(btrim(sport)) between 1 and 40),
  timezone text not null default 'UTC',
  currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  backdate_days integer not null default 14 check (backdate_days between 0 and 365),
  owner_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id),
  user_id uuid not null references public.profiles (id),
  role public.member_role not null default 'member',
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id) where left_at is null;

create table public.group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id),
  -- Only a SHA-256 hash of the token is stored; the raw token is returned once.
  token_hash text not null unique,
  created_by uuid not null references public.profiles (id),
  expires_at timestamptz not null,
  max_uses integer check (max_uses is null or max_uses > 0),
  use_count integer not null default 0 check (use_count >= 0),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index group_invites_group_idx on public.group_invites (group_id);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id),
  local_date date not null,
  status public.session_status not null default 'open',
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, local_date)
);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id),
  user_id uuid not null references public.profiles (id),
  status public.attendance_status not null,
  recorded_by uuid not null references public.profiles (id),
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, user_id)
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.groups (id),
  actor_id uuid references public.profiles (id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_json jsonb,
  after_json jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_group_idx on public.audit_events (group_id, created_at desc);

-- Results of idempotent commands, keyed by caller + command + client-supplied key.
create table public.command_receipts (
  user_id uuid not null references public.profiles (id),
  command text not null,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 128),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, command, idempotency_key)
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger groups_updated_at before update on public.groups
  for each row execute function public.set_updated_at();
create trigger memberships_updated_at before update on public.memberships
  for each row execute function public.set_updated_at();
create trigger group_invites_updated_at before update on public.group_invites
  for each row execute function public.set_updated_at();
create trigger sessions_updated_at before update on public.sessions
  for each row execute function public.set_updated_at();
create trigger attendance_updated_at before update on public.attendance
  for each row execute function public.set_updated_at();

-- The audit log is append-only, including for privileged roles.
create function public.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_events_append_only';
end;
$$;

create trigger audit_events_append_only before update or delete on public.audit_events
  for each row execute function public.prevent_audit_mutation();

-- ---------------------------------------------------------------------------
-- Profile bootstrap from the verified Google identity
-- ---------------------------------------------------------------------------

create function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    left(coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      split_part(coalesce(new.email, ''), '@', 1)
    ), 80),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Keep the profile email in step with the identity provider.
create function public.handle_auth_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = coalesce(new.email, '') where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.handle_auth_user_email_change();

-- ---------------------------------------------------------------------------
-- Authorization helpers (SECURITY DEFINER so RLS policies don't recurse)
-- ---------------------------------------------------------------------------

create function public.is_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.group_id = p_group_id and m.user_id = auth.uid() and m.left_at is null
  );
$$;

create function public.has_group_role(p_group_id uuid, p_roles public.member_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.group_id = p_group_id and m.user_id = auth.uid() and m.left_at is null
      and m.role = any (p_roles)
  );
$$;

create function public.shares_group_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.group_id = mine.group_id
    where mine.user_id = auth.uid() and mine.left_at is null
      and theirs.user_id = p_user_id and theirs.left_at is null
  );
$$;

-- Internal helpers used by the commands below; never granted to API roles.
create function public.require_user()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'profile_missing';
  end if;
  return v_uid;
end;
$$;

create function public.hash_invite_token(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

create function public.write_audit(
  p_group_id uuid, p_actor_id uuid, p_action text, p_entity_type text, p_entity_id uuid,
  p_before jsonb, p_after jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_events (group_id, actor_id, action, entity_type, entity_id, before_json, after_json)
  values (p_group_id, p_actor_id, p_action, p_entity_type, p_entity_id, p_before, p_after);
$$;

-- ---------------------------------------------------------------------------
-- Commands
-- ---------------------------------------------------------------------------

-- Creates the profile row for the signed-in user if the auth trigger missed it.
create function public.ensure_profile()
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  insert into public.profiles (id, email, display_name, avatar_url)
  select u.id,
         coalesce(u.email, ''),
         left(coalesce(
           nullif(u.raw_user_meta_data ->> 'full_name', ''),
           nullif(u.raw_user_meta_data ->> 'name', ''),
           split_part(coalesce(u.email, ''), '@', 1)
         ), 80),
         coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture')
  from auth.users u
  where u.id = v_uid
  on conflict (id) do nothing;

  select * into v_profile from public.profiles where id = v_uid;
  if v_profile.id is null then
    raise exception 'profile_missing';
  end if;
  return v_profile;
end;
$$;

create function public.create_group(
  p_name text,
  p_sport text,
  p_timezone text,
  p_currency text,
  p_idempotency_key text,
  p_backdate_days integer default 14
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_receipt jsonb;
  v_group public.groups;
  v_membership public.memberships;
begin
  select result into v_receipt from public.command_receipts
  where user_id = v_uid and command = 'create_group' and idempotency_key = p_idempotency_key;
  if found then
    return (v_receipt ->> 'group_id')::uuid;
  end if;

  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'invalid_timezone';
  end if;

  insert into public.groups (name, sport, timezone, currency, backdate_days, owner_id)
  values (btrim(p_name), lower(btrim(coalesce(nullif(p_sport, ''), 'tennis'))), p_timezone,
          upper(p_currency), coalesce(p_backdate_days, 14), v_uid)
  returning * into v_group;

  insert into public.memberships (group_id, user_id, role)
  values (v_group.id, v_uid, 'owner')
  returning * into v_membership;

  perform public.write_audit(v_group.id, v_uid, 'group.created', 'group', v_group.id, null, to_jsonb(v_group));
  perform public.write_audit(v_group.id, v_uid, 'membership.created', 'membership', v_membership.id, null, to_jsonb(v_membership));

  insert into public.command_receipts (user_id, command, idempotency_key, result)
  values (v_uid, 'create_group', p_idempotency_key, jsonb_build_object('group_id', v_group.id));

  return v_group.id;
end;
$$;

create function public.create_invite(
  p_group_id uuid,
  p_expires_in_hours integer default 168,
  p_max_uses integer default null
)
returns table (invite_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_token text;
  v_invite public.group_invites;
begin
  if not public.has_group_role(p_group_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'forbidden';
  end if;
  if p_expires_in_hours is null or p_expires_in_hours < 1 or p_expires_in_hours > 24 * 30 then
    raise exception 'invalid_expiry';
  end if;

  -- Two v4 UUIDs give ~244 bits of randomness from the server CSPRNG.
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  insert into public.group_invites (group_id, token_hash, created_by, expires_at, max_uses)
  values (p_group_id, public.hash_invite_token(v_token), v_uid,
          now() + make_interval(hours => p_expires_in_hours), p_max_uses)
  returning * into v_invite;

  perform public.write_audit(p_group_id, v_uid, 'invite.created', 'group_invite', v_invite.id, null,
    jsonb_build_object('expires_at', v_invite.expires_at, 'max_uses', v_invite.max_uses));

  return query select v_invite.id, v_token, v_invite.expires_at;
end;
$$;

create function public.revoke_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_invite public.group_invites;
begin
  select * into v_invite from public.group_invites where id = p_invite_id for update;
  if v_invite.id is null
     or not public.has_group_role(v_invite.group_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'forbidden';
  end if;
  if v_invite.revoked_at is not null then
    return;
  end if;

  update public.group_invites set revoked_at = now() where id = p_invite_id;
  perform public.write_audit(v_invite.group_id, v_uid, 'invite.revoked', 'group_invite', v_invite.id,
    jsonb_build_object('revoked_at', null), jsonb_build_object('revoked_at', now()));
end;
$$;

-- Lets a signed-in user see which group an invite is for before joining.
create function public.get_invite_preview(p_token text)
returns table (group_id uuid, group_name text, sport text, member_count bigint, already_member boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_invite public.group_invites;
begin
  select * into v_invite from public.group_invites
  where token_hash = public.hash_invite_token(p_token);

  if v_invite.id is null or v_invite.revoked_at is not null or v_invite.expires_at <= now()
     or (v_invite.max_uses is not null and v_invite.use_count >= v_invite.max_uses) then
    raise exception 'invite_invalid';
  end if;

  return query
  select g.id, g.name, g.sport,
         (select count(*) from public.memberships m where m.group_id = g.id and m.left_at is null),
         exists (select 1 from public.memberships m
                 where m.group_id = g.id and m.user_id = v_uid and m.left_at is null)
  from public.groups g
  where g.id = v_invite.group_id;
end;
$$;

create function public.join_group_from_invite(p_token text, p_idempotency_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_receipt jsonb;
  v_invite public.group_invites;
  v_existing public.memberships;
  v_membership public.memberships;
begin
  select result into v_receipt from public.command_receipts
  where user_id = v_uid and command = 'join_group_from_invite' and idempotency_key = p_idempotency_key;
  if found then
    return (v_receipt ->> 'group_id')::uuid;
  end if;

  select * into v_invite from public.group_invites
  where token_hash = public.hash_invite_token(p_token)
  for update;

  if v_invite.id is null or v_invite.revoked_at is not null or v_invite.expires_at <= now() then
    raise exception 'invite_invalid';
  end if;

  select * into v_existing from public.memberships
  where group_id = v_invite.group_id and user_id = v_uid
  for update;

  if v_existing.id is not null and v_existing.left_at is null then
    -- Already a member: succeed without spending an invite use.
    return v_invite.group_id;
  end if;

  if v_invite.max_uses is not null and v_invite.use_count >= v_invite.max_uses then
    raise exception 'invite_invalid';
  end if;

  if v_existing.id is not null then
    update public.memberships
    set left_at = null, role = 'member', joined_at = now()
    where id = v_existing.id
    returning * into v_membership;
    perform public.write_audit(v_invite.group_id, v_uid, 'membership.rejoined', 'membership', v_membership.id,
      to_jsonb(v_existing), to_jsonb(v_membership));
  else
    insert into public.memberships (group_id, user_id, role)
    values (v_invite.group_id, v_uid, 'member')
    returning * into v_membership;
    perform public.write_audit(v_invite.group_id, v_uid, 'membership.created', 'membership', v_membership.id,
      null, to_jsonb(v_membership) || jsonb_build_object('invite_id', v_invite.id));
  end if;

  update public.group_invites set use_count = use_count + 1 where id = v_invite.id;

  insert into public.command_receipts (user_id, command, idempotency_key, result)
  values (v_uid, 'join_group_from_invite', p_idempotency_key, jsonb_build_object('group_id', v_invite.group_id));

  return v_invite.group_id;
end;
$$;

-- Owner only: promote a member to admin or demote an admin. Ownership transfer is out of scope.
create function public.set_member_role(p_group_id uuid, p_user_id uuid, p_role public.member_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_before public.memberships;
  v_after public.memberships;
begin
  if not public.has_group_role(p_group_id, array['owner']::public.member_role[]) then
    raise exception 'forbidden';
  end if;
  if p_role = 'owner' then
    raise exception 'ownership_transfer_unsupported';
  end if;

  select * into v_before from public.memberships
  where group_id = p_group_id and user_id = p_user_id and left_at is null
  for update;
  if v_before.id is null then
    raise exception 'member_not_found';
  end if;
  if v_before.role = 'owner' then
    raise exception 'cannot_change_owner';
  end if;
  if v_before.role = p_role then
    return;
  end if;

  update public.memberships set role = p_role where id = v_before.id returning * into v_after;
  perform public.write_audit(p_group_id, v_uid, 'membership.role_changed', 'membership', v_after.id,
    to_jsonb(v_before), to_jsonb(v_after));
end;
$$;

-- Owner can remove admins and members; admins can remove members. History is kept (left_at).
create function public.remove_member(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_before public.memberships;
  v_after public.memberships;
begin
  if not public.has_group_role(p_group_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'forbidden';
  end if;

  select * into v_before from public.memberships
  where group_id = p_group_id and user_id = p_user_id and left_at is null
  for update;
  if v_before.id is null then
    raise exception 'member_not_found';
  end if;
  if v_before.role = 'owner' then
    raise exception 'cannot_remove_owner';
  end if;
  if v_before.role = 'admin' and not public.has_group_role(p_group_id, array['owner']::public.member_role[]) then
    raise exception 'forbidden';
  end if;

  update public.memberships set left_at = now() where id = v_before.id returning * into v_after;
  perform public.write_audit(p_group_id, v_uid, 'membership.removed', 'membership', v_after.id,
    to_jsonb(v_before), to_jsonb(v_after));
end;
$$;

-- ---------------------------------------------------------------------------
-- Row level security (default deny; reads only)
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.memberships enable row level security;
alter table public.group_invites enable row level security;
alter table public.sessions enable row level security;
alter table public.attendance enable row level security;
alter table public.audit_events enable row level security;
alter table public.command_receipts enable row level security;

create policy "profiles: read self and groupmates" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.shares_group_with(id));

create policy "profiles: update own display fields" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "groups: members read" on public.groups
  for select to authenticated
  using (public.is_group_member(id));

create policy "memberships: members read their group's roster" on public.memberships
  for select to authenticated
  using (public.is_group_member(group_id));

create policy "group_invites: owners and admins read" on public.group_invites
  for select to authenticated
  using (public.has_group_role(group_id, array['owner', 'admin']::public.member_role[]));

create policy "sessions: members read" on public.sessions
  for select to authenticated
  using (public.is_group_member(group_id));

create policy "attendance: members read" on public.attendance
  for select to authenticated
  using (exists (
    select 1 from public.sessions s
    where s.id = attendance.session_id and public.is_group_member(s.group_id)
  ));

create policy "audit_events: members read" on public.audit_events
  for select to authenticated
  using (group_id is not null and public.is_group_member(group_id));

-- command_receipts: no policies, reachable only from SECURITY DEFINER commands.

-- ---------------------------------------------------------------------------
-- Privileges: narrow Supabase's broad defaults
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
grant select on public.profiles, public.groups, public.memberships, public.group_invites,
  public.sessions, public.attendance, public.audit_events to authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.is_group_member(uuid),
  public.has_group_role(uuid, public.member_role[]),
  public.shares_group_with(uuid),
  public.ensure_profile(),
  public.create_group(text, text, text, text, text, integer),
  public.create_invite(uuid, integer, integer),
  public.revoke_invite(uuid),
  public.get_invite_preview(text),
  public.join_group_from_invite(text, text),
  public.set_member_role(uuid, uuid, public.member_role),
  public.remove_member(uuid, uuid)
to authenticated;
