-- Phase 5: plan readiness (no payments are taken) and gentle motivation.
--
-- Plans and entitlements
--   * A group is on the Free or Pro tier. Pro comes from a beta override (the private beta
--     gives every group Pro) or from a subscription recorded by a billing provider's webhook.
--   * group_has_entitlement() is the authority for feature gates; the app checks it on the
--     server. The feature matrix lives in plan_features() and is mirrored in lib/plans.ts.
--   * A downgrade never hides financial history: balances, payments, purchases and cost
--     drill-downs are Free features, so they stay visible on every tier.
--   * Free groups take at most 12 active members. Existing members are never removed; only
--     new joins are blocked while a Free group is full.
--   * Only a fake provider exists. apply_billing_event() is for the server's service role
--     and ignores a repeated provider event id, so webhook retries are safe.
--
-- Motivation
--   * Each member has a weekly target (default 2 sessions) and each group a monthly target.
--   * Consistency counts present attendance only, in group-local calendar weeks (Monday
--     start). A week streak is the run of weeks at target, ending this week if it is already
--     met, otherwise last week, so the week in progress never breaks a streak.
--   * A member can hide their own consistency from other non-admin members. Group totals
--     stay visible. Nothing here reads money: no prizes, rankings or pressure.
--   * Reminder preferences are stored only; nothing sends notifications yet.

-- ---------------------------------------------------------------------------
-- Plans and billing
-- ---------------------------------------------------------------------------

create type public.plan_tier as enum ('free', 'pro');
create type public.plan_interval as enum ('none', 'month', 'year', 'one_time');
create type public.subscription_status as enum ('active', 'past_due', 'canceled', 'expired', 'revoked');

create table public.plans (
  code text primary key,
  name text not null,
  tier public.plan_tier not null,
  price_minor bigint not null check (price_minor >= 0),
  currency text not null default 'INR',
  billing_interval public.plan_interval not null,
  -- Limited cohort size (Founding Club Pass); null is unlimited.
  cohort_limit integer check (cohort_limit is null or cohort_limit > 0),
  -- Nothing is for sale during the private beta.
  purchasable boolean not null default false,
  sort_order integer not null
);

insert into public.plans (code, name, tier, price_minor, billing_interval, cohort_limit, sort_order) values
  ('free', 'Free', 'free', 0, 'none', null, 0),
  ('pro_monthly', 'Group Pro Monthly', 'pro', 29900, 'month', null, 1),
  ('pro_annual', 'Group Pro Annual', 'pro', 249900, 'year', null, 2),
  ('founding_pass', 'Founding Club Pass', 'pro', 499900, 'one_time', 100, 3);

-- Who pays for a group, as known to the provider.
create table public.billing_accounts (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null unique references public.groups (id),
  provider text not null,
  provider_customer_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_customer_id)
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id),
  billing_account_id uuid not null references public.billing_accounts (id),
  plan_code text not null references public.plans (code),
  status public.subscription_status not null,
  provider text not null,
  provider_subscription_id text not null,
  current_period_start timestamptz not null,
  -- Null for a one-time pass that does not expire.
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_subscription_id)
);
create index subscriptions_group_idx on public.subscriptions (group_id);

-- Pro without a subscription. A null group_id applies to every group (the private beta).
create table public.entitlement_overrides (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.groups (id),
  tier public.plan_tier not null default 'pro',
  label text not null check (char_length(btrim(label)) between 1 and 60),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

insert into public.entitlement_overrides (group_id, tier, label, starts_at)
values (null, 'pro', 'Beta access', '2026-01-01T00:00:00Z');

-- Every webhook event received, once per provider event id.
create table public.billing_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  payload jsonb not null,
  outcome text not null,
  received_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create trigger billing_accounts_updated_at before update on public.billing_accounts
  for each row execute function public.set_updated_at();
create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- The Free/Pro feature matrix.
create function public.plan_features(p_tier public.plan_tier)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_tier
    when 'pro' then array['attendance', 'inventory', 'settlement', 'financial_history', 'motivation',
                          'settlement_periods', 'unlimited_members']
    else array['attendance', 'inventory', 'settlement', 'financial_history', 'motivation']
  end;
$$;

-- The group's tier and where it comes from, without a membership check. Internal.
create function public.resolve_group_plan(p_group_id uuid)
returns table (tier public.plan_tier, source text, label text, plan_code text, status public.subscription_status,
               current_period_end timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select x.tier, x.source, x.label, x.plan_code, x.status, x.period_end from (
    select o.tier, 'override'::text as source, o.label, null::text as plan_code,
           null::public.subscription_status as status, o.ends_at as period_end, 0 as rank
    from public.entitlement_overrides o
    where (o.group_id = p_group_id or o.group_id is null)
      and o.starts_at <= now() and (o.ends_at is null or o.ends_at > now())
    union all
    select p.tier, 'subscription', p.name, s.plan_code, s.status, s.current_period_end, 1
    from public.subscriptions s join public.plans p on p.code = s.plan_code
    where s.group_id = p_group_id
      and s.status in ('active', 'past_due', 'canceled')
      and (s.current_period_end is null or s.current_period_end > now())
    union all
    select 'free'::public.plan_tier, 'free', 'Free', 'free', null, null, 2
  ) x
  -- Pro beats Free; an override beats a subscription; the longest-running wins.
  order by x.tier = 'pro' desc, x.rank, x.period_end desc nulls first
  limit 1;
$$;

-- The caller's view of the group's plan.
create function public.group_plan(p_group_id uuid)
returns table (tier public.plan_tier, source text, label text, plan_code text, status public.subscription_status,
               current_period_end timestamptz, features text[], member_limit integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'forbidden';
  end if;
  return query
  select r.tier, r.source, r.label, r.plan_code, r.status, r.current_period_end, public.plan_features(r.tier),
         case when 'unlimited_members' = any (public.plan_features(r.tier)) then null else 12 end
  from public.resolve_group_plan(p_group_id) r;
end;
$$;

create function public.group_has_entitlement(p_group_id uuid, p_feature text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'forbidden';
  end if;
  return p_feature = any (public.plan_features((select r.tier from public.resolve_group_plan(p_group_id) r)));
end;
$$;

-- Applies one normalised provider event. Service role only (the webhook handler).
-- Event types: subscription.activated, subscription.renewed, subscription.past_due,
-- subscription.canceled, subscription.expired, subscription.revoked (refund).
-- Returns 'processed', 'duplicate' or 'ignored'.
create function public.apply_billing_event(
  p_provider text, p_event_id text, p_type text, p_payload jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid := nullif(p_payload ->> 'group_id', '')::uuid;
  v_account_id uuid;
  v_sub public.subscriptions;
  v_before public.subscriptions;
  v_outcome text := 'processed';
  v_period_end timestamptz := nullif(p_payload ->> 'current_period_end', '')::timestamptz;
begin
  if p_provider is null or p_event_id is null or p_type is null then
    raise exception 'invalid_billing_event';
  end if;

  insert into public.billing_events (provider, provider_event_id, event_type, payload, outcome)
  values (p_provider, p_event_id, p_type, coalesce(p_payload, '{}'), 'pending')
  on conflict (provider, provider_event_id) do nothing;
  if not found then
    return 'duplicate';
  end if;

  select * into v_before from public.subscriptions
  where provider = p_provider and provider_subscription_id = p_payload ->> 'subscription_id'
  for update;

  if p_type = 'subscription.activated' then
    if p_payload ->> 'subscription_id' is null or p_payload ->> 'customer_id' is null
       or not exists (select 1 from public.groups where id = v_group_id)
       or not exists (select 1 from public.plans where code = p_payload ->> 'plan_code' and tier = 'pro') then
      v_outcome := 'ignored';
    else
      insert into public.billing_accounts (group_id, provider, provider_customer_id)
      values (v_group_id, p_provider, p_payload ->> 'customer_id')
      on conflict (group_id) do update set provider = excluded.provider,
        provider_customer_id = excluded.provider_customer_id
      returning id into v_account_id;

      insert into public.subscriptions (group_id, billing_account_id, plan_code, status, provider,
        provider_subscription_id, current_period_start, current_period_end)
      values (v_group_id, v_account_id, p_payload ->> 'plan_code', 'active', p_provider,
        p_payload ->> 'subscription_id', coalesce((p_payload ->> 'current_period_start')::timestamptz, now()),
        v_period_end)
      on conflict (provider, provider_subscription_id) do update set status = 'active',
        current_period_end = excluded.current_period_end
      returning * into v_sub;
    end if;
  elsif v_before.id is null then
    v_outcome := 'ignored';
  elsif p_type = 'subscription.renewed' then
    update public.subscriptions set status = 'active', current_period_end = v_period_end
    where id = v_before.id returning * into v_sub;
  elsif p_type in ('subscription.past_due', 'subscription.canceled', 'subscription.expired',
                   'subscription.revoked') then
    update public.subscriptions
    set status = split_part(p_type, '.', 2)::public.subscription_status
    where id = v_before.id returning * into v_sub;
  else
    v_outcome := 'ignored';
  end if;

  update public.billing_events set outcome = v_outcome
  where provider = p_provider and provider_event_id = p_event_id;

  if v_sub.id is not null then
    perform public.write_audit(v_sub.group_id, null, 'billing.' || p_type, 'subscription', v_sub.id,
      to_jsonb(v_before), to_jsonb(v_sub));
  end if;
  return v_outcome;
end;
$$;

-- Free groups are full at 12 active members; joining is otherwise unchanged from Phase 0.
create or replace function public.join_group_from_invite(p_token text, p_idempotency_key text)
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

  if not 'unlimited_members' = any (public.plan_features(
       (select r.tier from public.resolve_group_plan(v_invite.group_id) r)))
     and (select count(*) from public.memberships m
          where m.group_id = v_invite.group_id and m.left_at is null) >= 12 then
    raise exception 'member_limit_reached';
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

-- ---------------------------------------------------------------------------
-- Motivation
-- ---------------------------------------------------------------------------

alter table public.groups add column monthly_target integer not null default 12
  check (monthly_target between 1 and 31);

create table public.member_preferences (
  group_id uuid not null references public.groups (id),
  user_id uuid not null references public.profiles (id),
  weekly_target integer not null default 2 check (weekly_target between 1 and 7),
  hide_consistency boolean not null default false,
  reminders_enabled boolean not null default false,
  -- ISO weekdays, 1 = Monday.
  reminder_days smallint[] not null default '{}'
    check (reminder_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  reminder_time time not null default '07:00',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create trigger member_preferences_updated_at before update on public.member_preferences
  for each row execute function public.set_updated_at();

-- Present sessions per group-local week for one member, newest first.
-- Consecutive weeks at or above the target, ending this week if met, otherwise last week.
create function public.week_streak(p_group_id uuid, p_user_id uuid, p_today date, p_target integer)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_counts jsonb;
  v_week date := date_trunc('week', p_today)::date;
  v_streak integer := 0;
begin
  select coalesce(jsonb_object_agg(w.week, w.n), '{}') into v_counts from (
    select date_trunc('week', s.local_date)::date as week, count(*) as n
    from public.attendance a join public.sessions s on s.id = a.session_id
    where s.group_id = p_group_id and a.user_id = p_user_id and a.status = 'present'
      and s.local_date <= p_today
    group by 1
  ) w;

  if coalesce((v_counts ->> v_week::text)::int, 0) < p_target then
    v_week := v_week - 7;
  end if;
  while coalesce((v_counts ->> v_week::text)::int, 0) >= p_target loop
    v_streak := v_streak + 1;
    v_week := v_week - 7;
  end loop;
  return v_streak;
end;
$$;

-- Each active member's consistency. Members who hid theirs appear only to themselves and
-- admins; hidden rows are left out for everyone else.
create function public.member_progress(p_group_id uuid)
returns table (user_id uuid, weekly_target integer, sessions_this_week integer, sessions_this_month integer,
               week_streak integer, hidden boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_today date;
  v_admin boolean := public.is_group_admin(p_group_id);
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'forbidden';
  end if;
  select (now() at time zone g.timezone)::date into v_today from public.groups g where g.id = p_group_id;

  return query
  with people as (
    select m.user_id, coalesce(p.weekly_target, 2) as target, coalesce(p.hide_consistency, false) as hidden
    from public.memberships m
    left join public.member_preferences p on p.group_id = m.group_id and p.user_id = m.user_id
    where m.group_id = p_group_id and m.left_at is null
  ),
  played as (
    select a.user_id, s.local_date
    from public.attendance a join public.sessions s on s.id = a.session_id
    where s.group_id = p_group_id and a.status = 'present'
      and s.local_date between date_trunc('month', v_today)::date - 7 and v_today
  )
  select pe.user_id, pe.target,
         (select count(*)::int from played x where x.user_id = pe.user_id
            and x.local_date >= date_trunc('week', v_today)::date),
         (select count(*)::int from played x where x.user_id = pe.user_id
            and x.local_date >= date_trunc('month', v_today)::date),
         public.week_streak(p_group_id, pe.user_id, v_today, pe.target),
         pe.hidden
  from people pe
  where not pe.hidden or pe.user_id = v_uid or v_admin
  order by pe.user_id;
end;
$$;

-- The group's month so far: sessions where anyone played, against the monthly target.
create function public.group_progress(p_group_id uuid)
returns table (month_start date, sessions_played integer, monthly_target integer, players_this_week integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date;
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'forbidden';
  end if;
  select (now() at time zone g.timezone)::date into v_today from public.groups g where g.id = p_group_id;

  return query
  select date_trunc('month', v_today)::date,
         (select count(distinct s.id)::int
          from public.sessions s join public.attendance a on a.session_id = s.id and a.status = 'present'
          where s.group_id = p_group_id
            and s.local_date between date_trunc('month', v_today)::date and v_today),
         g.monthly_target,
         (select count(distinct a.user_id)::int
          from public.sessions s join public.attendance a on a.session_id = s.id and a.status = 'present'
          where s.group_id = p_group_id
            and s.local_date between date_trunc('week', v_today)::date and v_today)
  from public.groups g where g.id = p_group_id;
end;
$$;

create function public.set_my_preferences(
  p_group_id uuid,
  p_weekly_target integer,
  p_hide_consistency boolean,
  p_reminders_enabled boolean,
  p_reminder_days smallint[],
  p_reminder_time time
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'forbidden';
  end if;
  if p_weekly_target is null or p_weekly_target not between 1 and 7 then
    raise exception 'invalid_preferences';
  end if;
  if p_reminders_enabled and (coalesce(cardinality(p_reminder_days), 0) = 0 or p_reminder_time is null) then
    raise exception 'invalid_preferences';
  end if;
  if not coalesce(p_reminder_days, '{}') <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[] then
    raise exception 'invalid_preferences';
  end if;

  insert into public.member_preferences (group_id, user_id, weekly_target, hide_consistency,
    reminders_enabled, reminder_days, reminder_time)
  values (p_group_id, v_uid, p_weekly_target, coalesce(p_hide_consistency, false),
    coalesce(p_reminders_enabled, false), coalesce(p_reminder_days, '{}'), coalesce(p_reminder_time, '07:00'))
  on conflict (group_id, user_id) do update set
    weekly_target = excluded.weekly_target,
    hide_consistency = excluded.hide_consistency,
    reminders_enabled = excluded.reminders_enabled,
    reminder_days = excluded.reminder_days,
    reminder_time = excluded.reminder_time;
end;
$$;

create function public.set_group_monthly_target(p_group_id uuid, p_target integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_before integer;
begin
  if not public.is_group_admin(p_group_id) then
    raise exception 'forbidden';
  end if;
  if p_target is null or p_target not between 1 and 31 then
    raise exception 'invalid_target';
  end if;
  select monthly_target into v_before from public.groups where id = p_group_id for update;
  if v_before = p_target then
    return;
  end if;
  update public.groups set monthly_target = p_target where id = p_group_id;
  perform public.write_audit(p_group_id, v_uid, 'group.monthly_target_changed', 'group', p_group_id,
    jsonb_build_object('monthly_target', v_before), jsonb_build_object('monthly_target', p_target));
end;
$$;

-- ---------------------------------------------------------------------------
-- Row level security (reads only) and privileges
-- ---------------------------------------------------------------------------

alter table public.plans enable row level security;
alter table public.billing_accounts enable row level security;
alter table public.subscriptions enable row level security;
alter table public.entitlement_overrides enable row level security;
alter table public.billing_events enable row level security;
alter table public.member_preferences enable row level security;

create policy "plans: signed-in read" on public.plans
  for select to authenticated using (true);
create policy "subscriptions: members read" on public.subscriptions
  for select to authenticated using (public.is_group_member(group_id));
create policy "member_preferences: own read" on public.member_preferences
  for select to authenticated using (user_id = auth.uid());

revoke all on public.plans, public.billing_accounts, public.subscriptions, public.entitlement_overrides,
  public.billing_events, public.member_preferences from anon, authenticated;
grant select on public.plans, public.subscriptions, public.member_preferences to authenticated;

revoke execute on function
  public.plan_features(public.plan_tier),
  public.resolve_group_plan(uuid),
  public.group_plan(uuid),
  public.group_has_entitlement(uuid, text),
  public.apply_billing_event(text, text, text, jsonb),
  public.join_group_from_invite(text, text),
  public.week_streak(uuid, uuid, date, integer),
  public.member_progress(uuid),
  public.group_progress(uuid),
  public.set_my_preferences(uuid, integer, boolean, boolean, smallint[], time),
  public.set_group_monthly_target(uuid, integer)
from public, anon, authenticated;
grant execute on function
  public.group_plan(uuid),
  public.group_has_entitlement(uuid, text),
  public.join_group_from_invite(text, text),
  public.member_progress(uuid),
  public.group_progress(uuid),
  public.set_my_preferences(uuid, integer, boolean, boolean, smallint[], time),
  public.set_group_monthly_target(uuid, integer)
to authenticated;
grant execute on function public.apply_billing_event(text, text, text, jsonb) to service_role;
