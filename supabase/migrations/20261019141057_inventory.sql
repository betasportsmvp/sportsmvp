-- Phase 2 inventory: consumable items, purchases, FIFO cost lots and an append-only
-- movement ledger. On-hand stock is never stored or edited directly: it is the sum of
-- posted movements, and every lot's remaining quantity is kept in step with them.
--
-- Commands (SECURITY DEFINER, audited):
--   record_purchase   any member for themselves; owners/admins for any member
--   reverse_purchase  owners/admins, with a reason, only while the lot is untouched
--   adjust_inventory  owners/admins, with a reason; cannot take stock below zero
--   create_item / update_item  owners/admins
-- Receipts live in the private `receipts` bucket under `<group_id>/...`.

create type public.inventory_unit as enum ('can', 'tube', 'ball', 'pack');
create type public.purchase_status as enum ('posted', 'reversed');
create type public.movement_kind as enum ('purchase', 'purchase_reversal', 'adjustment');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.items (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  unit public.inventory_unit not null default 'can',
  reorder_threshold integer check (reorder_threshold is null or reorder_threshold between 0 and 100000),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index items_group_name_idx on public.items (group_id, lower(btrim(name)));

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id),
  item_id uuid not null references public.items (id),
  purchaser_id uuid not null references public.profiles (id),
  quantity integer not null check (quantity between 1 and 100000),
  total_minor bigint not null check (total_minor between 1 and 100000000000),
  purchased_on date not null,
  note text check (note is null or char_length(note) <= 500),
  receipt_path text check (receipt_path is null or char_length(receipt_path) <= 300),
  status public.purchase_status not null default 'posted',
  recorded_by uuid not null references public.profiles (id),
  reversed_by uuid references public.profiles (id),
  reversed_at timestamptz,
  reversal_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index purchases_group_idx on public.purchases (group_id, purchased_on desc);

-- A cost layer. Purchases create one lot each; positive adjustments create a zero-cost lot.
create table public.inventory_lots (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id),
  item_id uuid not null references public.items (id),
  purchase_id uuid unique references public.purchases (id),
  received_on date not null,
  received_quantity integer not null check (received_quantity > 0),
  remaining_quantity integer not null check (remaining_quantity >= 0),
  total_cost_minor bigint not null check (total_cost_minor >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (remaining_quantity <= received_quantity)
);
create index inventory_lots_fifo_idx on public.inventory_lots (item_id, received_on, created_at, id)
  where remaining_quantity > 0;

-- The ledger. One command writes one `entry_id`, with one row per lot it touched.
create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null,
  group_id uuid not null references public.groups (id),
  item_id uuid not null references public.items (id),
  lot_id uuid not null references public.inventory_lots (id),
  kind public.movement_kind not null,
  quantity integer not null check (quantity <> 0),
  occurred_on date not null,
  purchase_id uuid references public.purchases (id),
  reason text check (reason is null or char_length(reason) <= 500),
  recorded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);
create index inventory_movements_group_idx on public.inventory_movements (group_id, created_at desc);
create index inventory_movements_item_idx on public.inventory_movements (item_id);

create trigger items_updated_at before update on public.items
  for each row execute function public.set_updated_at();
create trigger purchases_updated_at before update on public.purchases
  for each row execute function public.set_updated_at();
create trigger inventory_lots_updated_at before update on public.inventory_lots
  for each row execute function public.set_updated_at();

create function public.prevent_ledger_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'inventory_ledger_append_only';
end;
$$;

create trigger inventory_movements_append_only before update or delete on public.inventory_movements
  for each row execute function public.prevent_ledger_mutation();

-- On-hand stock per item: the sum of its movements. Runs with the caller's RLS.
create view public.item_stock with (security_invoker = true) as
select i.id as item_id, i.group_id, coalesce(sum(m.quantity), 0)::integer as on_hand
from public.items i
left join public.inventory_movements m on m.item_id = i.id
group by i.id, i.group_id;

-- ---------------------------------------------------------------------------
-- Every group starts with tennis balls
-- ---------------------------------------------------------------------------

create function public.seed_group_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.items (group_id, name, unit, reorder_threshold)
  values (new.id, 'Tennis balls', 'can', 2)
  on conflict do nothing;
  return new;
end;
$$;

create trigger groups_seed_items after insert on public.groups
  for each row execute function public.seed_group_items();

insert into public.items (group_id, name, unit, reorder_threshold)
select g.id, 'Tennis balls', 'can', 2 from public.groups g
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Commands
-- ---------------------------------------------------------------------------

create function public.is_group_admin(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_group_role(p_group_id, array['owner', 'admin']::public.member_role[]);
$$;

create function public.create_item(
  p_group_id uuid, p_name text, p_unit public.inventory_unit, p_reorder_threshold integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_item public.items;
begin
  if not public.is_group_admin(p_group_id) then
    raise exception 'forbidden';
  end if;
  begin
    insert into public.items (group_id, name, unit, reorder_threshold, created_by)
    values (p_group_id, btrim(p_name), coalesce(p_unit, 'can'), p_reorder_threshold, v_uid)
    returning * into v_item;
  exception when unique_violation then
    raise exception 'item_exists';
  end;
  perform public.write_audit(p_group_id, v_uid, 'item.created', 'item', v_item.id, null, to_jsonb(v_item));
  return v_item.id;
end;
$$;

-- The unit can't change once an item exists, since recorded quantities are in that unit.
create function public.update_item(p_item_id uuid, p_name text, p_reorder_threshold integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_before public.items;
  v_after public.items;
begin
  select * into v_before from public.items where id = p_item_id for update;
  if v_before.id is null or not public.is_group_admin(v_before.group_id) then
    raise exception 'forbidden';
  end if;
  begin
    update public.items set name = btrim(p_name), reorder_threshold = p_reorder_threshold
    where id = p_item_id returning * into v_after;
  exception when unique_violation then
    raise exception 'item_exists';
  end;
  perform public.write_audit(v_before.group_id, v_uid, 'item.updated', 'item', p_item_id,
    to_jsonb(v_before), to_jsonb(v_after));
end;
$$;

create function public.record_purchase(
  p_group_id uuid,
  p_item_id uuid,
  p_purchaser_id uuid,
  p_quantity integer,
  p_total_minor bigint,
  p_purchased_on date,
  p_note text,
  p_receipt_path text,
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
  v_purchase public.purchases;
  v_lot public.inventory_lots;
  v_entry uuid := gen_random_uuid();
begin
  select result into v_receipt from public.command_receipts
  where user_id = v_uid and command = 'record_purchase' and idempotency_key = p_idempotency_key;
  if found then
    return (v_receipt ->> 'purchase_id')::uuid;
  end if;

  if not public.is_group_member(p_group_id) then
    raise exception 'forbidden';
  end if;
  if p_purchaser_id is distinct from v_uid and not public.is_group_admin(p_group_id) then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from public.items where id = p_item_id and group_id = p_group_id) then
    raise exception 'item_not_found';
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.group_id = p_group_id and m.user_id = p_purchaser_id and m.left_at is null
  ) then
    raise exception 'member_not_found';
  end if;
  if p_quantity is null or p_quantity < 1 or p_total_minor is null or p_total_minor < 1 then
    raise exception 'invalid_purchase';
  end if;
  select (now() at time zone g.timezone)::date into v_today from public.groups g where g.id = p_group_id;
  if p_purchased_on is null or p_purchased_on > v_today then
    raise exception 'future_date';
  end if;
  if nullif(p_receipt_path, '') is not null
     and (p_receipt_path not like p_group_id::text || '/%' or p_receipt_path like '%..%') then
    raise exception 'invalid_receipt';
  end if;

  insert into public.purchases (group_id, item_id, purchaser_id, quantity, total_minor, purchased_on,
                                note, receipt_path, recorded_by)
  values (p_group_id, p_item_id, p_purchaser_id, p_quantity, p_total_minor, p_purchased_on,
          nullif(btrim(p_note), ''), nullif(p_receipt_path, ''), v_uid)
  returning * into v_purchase;

  insert into public.inventory_lots (group_id, item_id, purchase_id, received_on, received_quantity,
                                     remaining_quantity, total_cost_minor)
  values (p_group_id, p_item_id, v_purchase.id, p_purchased_on, p_quantity, p_quantity, p_total_minor)
  returning * into v_lot;

  insert into public.inventory_movements (entry_id, group_id, item_id, lot_id, kind, quantity, occurred_on,
                                          purchase_id, recorded_by)
  values (v_entry, p_group_id, p_item_id, v_lot.id, 'purchase', p_quantity, p_purchased_on, v_purchase.id, v_uid);

  perform public.write_audit(p_group_id, v_uid, 'purchase.posted', 'purchase', v_purchase.id, null,
    to_jsonb(v_purchase) || jsonb_build_object('lot_id', v_lot.id, 'entry_id', v_entry));

  insert into public.command_receipts (user_id, command, idempotency_key, result)
  values (v_uid, 'record_purchase', p_idempotency_key, jsonb_build_object('purchase_id', v_purchase.id));

  return v_purchase.id;
end;
$$;

-- Takes a mistaken purchase back out of stock. Only possible while none of its lot has been
-- used or adjusted; the purchase stays visible as reversed.
create function public.reverse_purchase(p_purchase_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_before public.purchases;
  v_after public.purchases;
  v_lot public.inventory_lots;
  v_today date;
begin
  select * into v_before from public.purchases where id = p_purchase_id for update;
  if v_before.id is null or not public.is_group_admin(v_before.group_id) then
    raise exception 'forbidden';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'reason_required';
  end if;
  if v_before.status = 'reversed' then
    return;
  end if;

  select * into v_lot from public.inventory_lots where purchase_id = p_purchase_id for update;
  if v_lot.remaining_quantity <> v_lot.received_quantity then
    raise exception 'purchase_already_used';
  end if;

  select (now() at time zone g.timezone)::date into v_today from public.groups g where g.id = v_before.group_id;

  update public.inventory_lots set remaining_quantity = 0 where id = v_lot.id;
  insert into public.inventory_movements (entry_id, group_id, item_id, lot_id, kind, quantity, occurred_on,
                                          purchase_id, reason, recorded_by)
  values (gen_random_uuid(), v_before.group_id, v_before.item_id, v_lot.id, 'purchase_reversal',
          -v_lot.received_quantity, v_today, p_purchase_id, btrim(p_reason), v_uid);

  update public.purchases
  set status = 'reversed', reversed_by = v_uid, reversed_at = now(), reversal_reason = btrim(p_reason)
  where id = p_purchase_id
  returning * into v_after;

  perform public.write_audit(v_before.group_id, v_uid, 'purchase.reversed', 'purchase', p_purchase_id,
    to_jsonb(v_before), to_jsonb(v_after));
end;
$$;

-- Corrects stock to match reality (found, lost or damaged items). Removals come out of the
-- oldest lots first; additions arrive as a zero-cost lot.
create function public.adjust_inventory(
  p_group_id uuid, p_item_id uuid, p_quantity_delta integer, p_reason text, p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_receipt jsonb;
  v_entry uuid := gen_random_uuid();
  v_today date;
  v_before integer;
  v_left integer;
  v_take integer;
  v_lot public.inventory_lots;
begin
  select result into v_receipt from public.command_receipts
  where user_id = v_uid and command = 'adjust_inventory' and idempotency_key = p_idempotency_key;
  if found then
    return (v_receipt ->> 'entry_id')::uuid;
  end if;

  if not public.is_group_admin(p_group_id) then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from public.items where id = p_item_id and group_id = p_group_id) then
    raise exception 'item_not_found';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'reason_required';
  end if;
  if p_quantity_delta is null or p_quantity_delta = 0 or abs(p_quantity_delta) > 100000 then
    raise exception 'invalid_adjustment';
  end if;

  select (now() at time zone g.timezone)::date into v_today from public.groups g where g.id = p_group_id;

  -- Serialise stock changes for this item.
  perform 1 from public.items where id = p_item_id for update;
  select coalesce(sum(remaining_quantity), 0) into v_before from public.inventory_lots where item_id = p_item_id;

  if p_quantity_delta > 0 then
    insert into public.inventory_lots (group_id, item_id, received_on, received_quantity, remaining_quantity,
                                       total_cost_minor)
    values (p_group_id, p_item_id, v_today, p_quantity_delta, p_quantity_delta, 0)
    returning * into v_lot;
    insert into public.inventory_movements (entry_id, group_id, item_id, lot_id, kind, quantity, occurred_on,
                                            reason, recorded_by)
    values (v_entry, p_group_id, p_item_id, v_lot.id, 'adjustment', p_quantity_delta, v_today,
            btrim(p_reason), v_uid);
  else
    if v_before < -p_quantity_delta then
      raise exception 'insufficient_stock';
    end if;
    v_left := -p_quantity_delta;
    for v_lot in
      select * from public.inventory_lots
      where item_id = p_item_id and remaining_quantity > 0
      order by received_on, created_at, id
      for update
    loop
      exit when v_left = 0;
      v_take := least(v_left, v_lot.remaining_quantity);
      update public.inventory_lots set remaining_quantity = remaining_quantity - v_take where id = v_lot.id;
      insert into public.inventory_movements (entry_id, group_id, item_id, lot_id, kind, quantity, occurred_on,
                                              reason, recorded_by)
      values (v_entry, p_group_id, p_item_id, v_lot.id, 'adjustment', -v_take, v_today, btrim(p_reason), v_uid);
      v_left := v_left - v_take;
    end loop;
  end if;

  perform public.write_audit(p_group_id, v_uid, 'inventory.adjusted', 'item', p_item_id,
    jsonb_build_object('on_hand', v_before),
    jsonb_build_object('on_hand', v_before + p_quantity_delta, 'delta', p_quantity_delta,
                       'reason', btrim(p_reason), 'entry_id', v_entry));

  insert into public.command_receipts (user_id, command, idempotency_key, result)
  values (v_uid, 'adjust_inventory', p_idempotency_key, jsonb_build_object('entry_id', v_entry));

  return v_entry;
end;
$$;

-- ---------------------------------------------------------------------------
-- Receipts: private bucket, readable and uploadable only by members of the group
-- named by the first path segment.
-- ---------------------------------------------------------------------------

create function public.receipt_group_id(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid
  end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do nothing;

create policy "receipts: members read" on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts' and public.is_group_member(public.receipt_group_id(name)));

create policy "receipts: members upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipts' and public.is_group_member(public.receipt_group_id(name)));

-- ---------------------------------------------------------------------------
-- Row level security (reads only) and privileges
-- ---------------------------------------------------------------------------

alter table public.items enable row level security;
alter table public.purchases enable row level security;
alter table public.inventory_lots enable row level security;
alter table public.inventory_movements enable row level security;

create policy "items: members read" on public.items
  for select to authenticated using (public.is_group_member(group_id));
create policy "purchases: members read" on public.purchases
  for select to authenticated using (public.is_group_member(group_id));
create policy "inventory_lots: members read" on public.inventory_lots
  for select to authenticated using (public.is_group_member(group_id));
create policy "inventory_movements: members read" on public.inventory_movements
  for select to authenticated using (public.is_group_member(group_id));

revoke all on public.items, public.purchases, public.inventory_lots, public.inventory_movements,
  public.item_stock from anon, authenticated;
grant select on public.items, public.purchases, public.inventory_lots, public.inventory_movements,
  public.item_stock to authenticated;

revoke execute on function
  public.prevent_ledger_mutation(),
  public.seed_group_items(),
  public.is_group_admin(uuid),
  public.create_item(uuid, text, public.inventory_unit, integer),
  public.update_item(uuid, text, integer),
  public.record_purchase(uuid, uuid, uuid, integer, bigint, date, text, text, text),
  public.reverse_purchase(uuid, text),
  public.adjust_inventory(uuid, uuid, integer, text, text),
  public.receipt_group_id(text)
from public, anon, authenticated;
grant execute on function
  public.is_group_admin(uuid),
  public.create_item(uuid, text, public.inventory_unit, integer),
  public.update_item(uuid, text, integer),
  public.record_purchase(uuid, uuid, uuid, integer, bigint, date, text, text, text),
  public.reverse_purchase(uuid, text),
  public.adjust_inventory(uuid, uuid, integer, text, text),
  public.receipt_group_id(text)
to authenticated;
