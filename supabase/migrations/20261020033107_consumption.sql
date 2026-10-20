-- Phase 3 consumption and cost allocation: balls used in a session come out of stock
-- oldest lot first, and their actual cost is split equally among the members marked
-- present that day.
--
-- Commands (SECURITY DEFINER, audited, owners/admins only):
--   record_consumption_and_allocate  take stock FIFO, cost it from its lots, split it
--   reverse_consumption              put the stock back and cancel the allocations
--   reallocate_consumption           re-split after attendance changed for that day
--
-- Allocation rule `equal_split_v1`: every present member pays floor(total / n); the
-- remaining minor units go one each to members in ascending user id order. Allocations
-- are never edited or deleted, only reversed and replaced.

create type public.consumption_status as enum ('posted', 'reversed');
create type public.allocation_status as enum ('active', 'reversed');
alter type public.movement_kind add value 'consumption';
alter type public.movement_kind add value 'consumption_reversal';

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.consumptions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id),
  session_id uuid not null references public.sessions (id),
  item_id uuid not null references public.items (id),
  quantity integer not null check (quantity between 1 and 100000),
  total_cost_minor bigint not null default 0 check (total_cost_minor >= 0),
  note text check (note is null or char_length(note) <= 500),
  status public.consumption_status not null default 'posted',
  recorded_by uuid not null references public.profiles (id),
  reversed_by uuid references public.profiles (id),
  reversed_at timestamptz,
  reversal_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index consumptions_session_idx on public.consumptions (session_id);
create index consumptions_group_idx on public.consumptions (group_id, created_at desc);

create trigger consumptions_updated_at before update on public.consumptions
  for each row execute function public.set_updated_at();

-- Consumption movements carry the session they were used in and the cost taken from the lot.
alter table public.inventory_movements
  add column session_id uuid references public.sessions (id),
  add column consumption_id uuid references public.consumptions (id),
  add column cost_minor bigint;
create index inventory_movements_consumption_idx on public.inventory_movements (consumption_id)
  where consumption_id is not null;

create table public.cost_allocations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id),
  session_id uuid not null references public.sessions (id),
  consumption_id uuid not null references public.consumptions (id),
  user_id uuid not null references public.profiles (id),
  amount_minor bigint not null check (amount_minor >= 0),
  -- 1 when this person absorbed one minor unit of the rounding remainder.
  rounding_minor integer not null default 0 check (rounding_minor in (0, 1)),
  rule_version text not null default 'equal_split_v1',
  status public.allocation_status not null default 'active',
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  reversed_by uuid references public.profiles (id),
  reversed_at timestamptz,
  reversal_reason text
);
create unique index cost_allocations_active_idx on public.cost_allocations (consumption_id, user_id)
  where status = 'active';
create index cost_allocations_user_idx on public.cost_allocations (group_id, user_id);

-- Allocations can only move from active to reversed; nothing else about them changes.
create function public.guard_allocation_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or old.status <> 'active' or new.status <> 'reversed'
     or (to_jsonb(new) - array['status', 'reversed_by', 'reversed_at', 'reversal_reason'])
        <> (to_jsonb(old) - array['status', 'reversed_by', 'reversed_at', 'reversal_reason']) then
    raise exception 'allocations_append_only';
  end if;
  return new;
end;
$$;

create trigger cost_allocations_guard before update or delete on public.cost_allocations
  for each row execute function public.guard_allocation_change();

-- ---------------------------------------------------------------------------
-- Commands
-- ---------------------------------------------------------------------------

-- Splits a posted consumption among the members present at its session. Internal: callers
-- have already authorised the user and locked the consumption and session.
create function public.allocate_consumption(p_consumption public.consumptions, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_people uuid[];
  v_n integer;
  v_base bigint;
  v_extra integer;
begin
  select coalesce(array_agg(a.user_id order by a.user_id), '{}') into v_people
  from public.attendance a
  where a.session_id = p_consumption.session_id
    and a.status = 'present'
    and exists (
      select 1 from public.memberships m
      where m.group_id = p_consumption.group_id and m.user_id = a.user_id
    );
  v_n := cardinality(v_people);
  if v_n = 0 then
    raise exception 'no_present_attendees';
  end if;

  v_base := p_consumption.total_cost_minor / v_n;
  v_extra := (p_consumption.total_cost_minor % v_n)::integer;

  insert into public.cost_allocations (group_id, session_id, consumption_id, user_id, amount_minor,
                                       rounding_minor, created_by)
  select p_consumption.group_id, p_consumption.session_id, p_consumption.id, person,
         v_base + case when ord <= v_extra then 1 else 0 end,
         case when ord <= v_extra then 1 else 0 end,
         p_actor
  from unnest(v_people) with ordinality as t (person, ord);

  return (
    select jsonb_agg(jsonb_build_object('user_id', c.user_id, 'amount_minor', c.amount_minor)
                     order by c.user_id)
    from public.cost_allocations c
    where c.consumption_id = p_consumption.id and c.status = 'active'
  );
end;
$$;

create function public.record_consumption_and_allocate(
  p_group_id uuid,
  p_local_date date,
  p_item_id uuid,
  p_quantity integer,
  p_note text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_receipt jsonb;
  v_today date;
  v_session public.sessions;
  v_consumption public.consumptions;
  v_available integer;
  v_left integer;
  v_take integer;
  v_used integer;
  v_cost bigint;
  v_total bigint := 0;
  v_lot public.inventory_lots;
  v_allocations jsonb;
begin
  select result into v_receipt from public.command_receipts
  where user_id = v_uid and command = 'record_consumption_and_allocate' and idempotency_key = p_idempotency_key;
  if found then
    return (v_receipt ->> 'consumption_id')::uuid;
  end if;

  if not public.is_group_admin(p_group_id) then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from public.items where id = p_item_id and group_id = p_group_id) then
    raise exception 'item_not_found';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 100000 or p_local_date is null then
    raise exception 'invalid_consumption';
  end if;
  select (now() at time zone g.timezone)::date into v_today from public.groups g where g.id = p_group_id;
  if p_local_date > v_today then
    raise exception 'future_date';
  end if;

  -- Lock the session so attendance-driven reallocation can't interleave with this split.
  select * into v_session from public.sessions
  where group_id = p_group_id and local_date = p_local_date
  for update;
  if v_session.id is null or not exists (
    select 1 from public.attendance where session_id = v_session.id and status = 'present'
  ) then
    raise exception 'no_present_attendees';
  end if;

  -- Serialise stock changes for this item, then check there is enough.
  perform 1 from public.items where id = p_item_id for update;
  select coalesce(sum(remaining_quantity), 0) into v_available from public.inventory_lots where item_id = p_item_id;
  if v_available < p_quantity then
    raise exception 'insufficient_stock';
  end if;

  insert into public.consumptions (group_id, session_id, item_id, quantity, note, recorded_by)
  values (p_group_id, v_session.id, p_item_id, p_quantity, nullif(btrim(p_note), ''), v_uid)
  returning * into v_consumption;

  -- Take from the oldest lots. A lot's cost is spread over its units cumulatively, so
  -- using a whole lot always costs exactly what was paid for it.
  v_left := p_quantity;
  for v_lot in
    select * from public.inventory_lots
    where item_id = p_item_id and remaining_quantity > 0
    order by received_on, created_at, id
    for update
  loop
    exit when v_left = 0;
    v_take := least(v_left, v_lot.remaining_quantity);
    v_used := v_lot.received_quantity - v_lot.remaining_quantity;
    v_cost := v_lot.total_cost_minor * (v_used + v_take) / v_lot.received_quantity
            - v_lot.total_cost_minor * v_used / v_lot.received_quantity;
    update public.inventory_lots set remaining_quantity = remaining_quantity - v_take where id = v_lot.id;
    insert into public.inventory_movements (entry_id, group_id, item_id, lot_id, kind, quantity, occurred_on,
                                            session_id, consumption_id, cost_minor, reason, recorded_by)
    values (v_consumption.id, p_group_id, p_item_id, v_lot.id, 'consumption', -v_take, p_local_date,
            v_session.id, v_consumption.id, v_cost, v_consumption.note, v_uid);
    v_total := v_total + v_cost;
    v_left := v_left - v_take;
  end loop;

  update public.consumptions set total_cost_minor = v_total where id = v_consumption.id
  returning * into v_consumption;

  v_allocations := public.allocate_consumption(v_consumption, v_uid);

  perform public.write_audit(p_group_id, v_uid, 'consumption.posted', 'consumption', v_consumption.id, null,
    to_jsonb(v_consumption) || jsonb_build_object('local_date', p_local_date, 'allocations', v_allocations,
                                                   'rule_version', 'equal_split_v1'));

  insert into public.command_receipts (user_id, command, idempotency_key, result)
  values (v_uid, 'record_consumption_and_allocate', p_idempotency_key,
          jsonb_build_object('consumption_id', v_consumption.id));

  return v_consumption.id;
end;
$$;

-- Undoes a mistaken entry: the balls go back to the lots they came from and nobody is
-- charged for them. The consumption stays visible as reversed.
create function public.reverse_consumption(p_consumption_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_before public.consumptions;
  v_after public.consumptions;
  v_today date;
  v_entry uuid := gen_random_uuid();
  v_move public.inventory_movements;
begin
  select * into v_before from public.consumptions where id = p_consumption_id for update;
  if v_before.id is null or not public.is_group_admin(v_before.group_id) then
    raise exception 'forbidden';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'reason_required';
  end if;
  if v_before.status = 'reversed' then
    return;
  end if;

  select (now() at time zone g.timezone)::date into v_today from public.groups g where g.id = v_before.group_id;
  perform 1 from public.items where id = v_before.item_id for update;

  for v_move in
    select * from public.inventory_movements
    where consumption_id = p_consumption_id and kind = 'consumption'
    order by lot_id
  loop
    update public.inventory_lots set remaining_quantity = remaining_quantity - v_move.quantity
    where id = v_move.lot_id;
    insert into public.inventory_movements (entry_id, group_id, item_id, lot_id, kind, quantity, occurred_on,
                                            session_id, consumption_id, cost_minor, reason, recorded_by)
    values (v_entry, v_move.group_id, v_move.item_id, v_move.lot_id, 'consumption_reversal', -v_move.quantity,
            v_today, v_move.session_id, p_consumption_id, -v_move.cost_minor, btrim(p_reason), v_uid);
  end loop;

  update public.cost_allocations
  set status = 'reversed', reversed_by = v_uid, reversed_at = now(), reversal_reason = btrim(p_reason)
  where consumption_id = p_consumption_id and status = 'active';

  update public.consumptions
  set status = 'reversed', reversed_by = v_uid, reversed_at = now(), reversal_reason = btrim(p_reason)
  where id = p_consumption_id
  returning * into v_after;

  perform public.write_audit(v_before.group_id, v_uid, 'consumption.reversed', 'consumption', p_consumption_id,
    to_jsonb(v_before), to_jsonb(v_after) || jsonb_build_object('entry_id', v_entry));
end;
$$;

-- Re-splits a consumption after attendance for its day changed. The old allocations are
-- reversed (kept for the record) and new ones are written for whoever is present now.
create function public.reallocate_consumption(p_consumption_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_consumption public.consumptions;
  v_before jsonb;
  v_after jsonb;
begin
  select * into v_consumption from public.consumptions where id = p_consumption_id for update;
  if v_consumption.id is null or not public.is_group_admin(v_consumption.group_id) then
    raise exception 'forbidden';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'reason_required';
  end if;
  if v_consumption.status <> 'posted' then
    raise exception 'consumption_reversed';
  end if;
  perform 1 from public.sessions where id = v_consumption.session_id for update;

  select jsonb_agg(jsonb_build_object('user_id', user_id, 'amount_minor', amount_minor) order by user_id)
  into v_before
  from public.cost_allocations where consumption_id = p_consumption_id and status = 'active';

  -- Nothing to do when the people charged are still exactly the people present.
  if (select coalesce(array_agg(user_id order by user_id), '{}') from public.cost_allocations
      where consumption_id = p_consumption_id and status = 'active')
     = (select coalesce(array_agg(a.user_id order by a.user_id), '{}') from public.attendance a
        where a.session_id = v_consumption.session_id and a.status = 'present'
          and exists (select 1 from public.memberships m
                      where m.group_id = v_consumption.group_id and m.user_id = a.user_id)) then
    return;
  end if;

  update public.cost_allocations
  set status = 'reversed', reversed_by = v_uid, reversed_at = now(), reversal_reason = btrim(p_reason)
  where consumption_id = p_consumption_id and status = 'active';

  v_after := public.allocate_consumption(v_consumption, v_uid);

  if v_after is distinct from v_before then
    perform public.write_audit(v_consumption.group_id, v_uid, 'allocation.reallocated', 'consumption',
      p_consumption_id, jsonb_build_object('allocations', v_before),
      jsonb_build_object('allocations', v_after, 'reason', btrim(p_reason)));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row level security (reads only) and privileges
-- ---------------------------------------------------------------------------

alter table public.consumptions enable row level security;
alter table public.cost_allocations enable row level security;

create policy "consumptions: members read" on public.consumptions
  for select to authenticated using (public.is_group_member(group_id));
create policy "cost_allocations: members read" on public.cost_allocations
  for select to authenticated using (public.is_group_member(group_id));

revoke all on public.consumptions, public.cost_allocations from anon, authenticated;
grant select on public.consumptions, public.cost_allocations to authenticated;

revoke execute on function
  public.guard_allocation_change(),
  public.allocate_consumption(public.consumptions, uuid),
  public.record_consumption_and_allocate(uuid, date, uuid, integer, text, text),
  public.reverse_consumption(uuid, text),
  public.reallocate_consumption(uuid, text)
from public, anon, authenticated;
grant execute on function
  public.record_consumption_and_allocate(uuid, date, uuid, integer, text, text),
  public.reverse_consumption(uuid, text),
  public.reallocate_consumption(uuid, text)
to authenticated;
