-- Phase 4 settlement: balances, a collection-hub settlement plan and payment records.
-- Nothing here moves money; payments are records of transfers members made themselves.
--
-- Balance per member over an optional date range:
--   net = purchases paid for (posted) - share of balls used (active allocations)
--         + payments sent (confirmed) - payments received (confirmed)
-- Positive: the group owes the member. Negative: the member owes the group.
--
-- Settlement plan (calculate_settlement): every debtor pays the Settlement Lead, the lead
-- pays every other creditor, and the lead keeps its own credit. The lead is the group's
-- nominated lead when an admin chose one, otherwise the largest net creditor.
--
-- Commands (SECURITY DEFINER, audited):
--   record_payment       admins for anyone; members for payments they sent or received
--   reverse_payment      admins, or whoever recorded it; with a reason
--   set_settlement_lead  admins

create type public.payment_status as enum ('confirmed', 'reversed');

alter table public.groups add column settlement_lead_id uuid references public.profiles (id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id),
  payer_id uuid not null references public.profiles (id),
  payee_id uuid not null references public.profiles (id),
  amount_minor bigint not null check (amount_minor between 1 and 100000000000),
  paid_on date not null,
  note text check (note is null or char_length(note) <= 500),
  status public.payment_status not null default 'confirmed',
  recorded_by uuid not null references public.profiles (id),
  reversed_by uuid references public.profiles (id),
  reversed_at timestamptz,
  reversal_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (payer_id <> payee_id)
);
create index payments_group_idx on public.payments (group_id, paid_on desc);

create trigger payments_updated_at before update on public.payments
  for each row execute function public.set_updated_at();

-- Payments can only move from confirmed to reversed; nothing else about them changes.
create function public.guard_payment_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or old.status <> 'confirmed' or new.status <> 'reversed'
     or (to_jsonb(new) - array['status', 'reversed_by', 'reversed_at', 'reversal_reason', 'updated_at'])
        <> (to_jsonb(old) - array['status', 'reversed_by', 'reversed_at', 'reversal_reason', 'updated_at']) then
    raise exception 'payments_append_only';
  end if;
  return new;
end;
$$;

create trigger payments_guard before update or delete on public.payments
  for each row execute function public.guard_payment_change();

-- ---------------------------------------------------------------------------
-- Queries
-- ---------------------------------------------------------------------------

-- Every current member, plus any former member with a non-zero figure, with the inputs
-- to their balance. Dates are inclusive and either bound may be null.
create function public.group_balances(p_group_id uuid, p_from date default null, p_to date default null)
returns table (
  user_id uuid,
  purchases_minor bigint,
  allocations_minor bigint,
  payments_sent_minor bigint,
  payments_received_minor bigint,
  net_minor bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'forbidden';
  end if;

  return query
  with people as (
    select m.user_id, bool_or(m.left_at is null) as active
    from public.memberships m where m.group_id = p_group_id group by m.user_id
  ),
  bought as (
    select p.purchaser_id as user_id, sum(p.total_minor) as amount
    from public.purchases p
    where p.group_id = p_group_id and p.status = 'posted'
      and (p_from is null or p.purchased_on >= p_from) and (p_to is null or p.purchased_on <= p_to)
    group by p.purchaser_id
  ),
  used as (
    select a.user_id, sum(a.amount_minor) as amount
    from public.cost_allocations a join public.sessions s on s.id = a.session_id
    where a.group_id = p_group_id and a.status = 'active'
      and (p_from is null or s.local_date >= p_from) and (p_to is null or s.local_date <= p_to)
    group by a.user_id
  ),
  confirmed as (
    select * from public.payments x
    where x.group_id = p_group_id and x.status = 'confirmed'
      and (p_from is null or x.paid_on >= p_from) and (p_to is null or x.paid_on <= p_to)
  ),
  sent as (select c.payer_id as user_id, sum(c.amount_minor) as amount from confirmed c group by c.payer_id),
  received as (select c.payee_id as user_id, sum(c.amount_minor) as amount from confirmed c group by c.payee_id),
  totals as (
    select pe.user_id, pe.active,
           coalesce(b.amount, 0)::bigint as purchases_minor,
           coalesce(u.amount, 0)::bigint as allocations_minor,
           coalesce(s.amount, 0)::bigint as payments_sent_minor,
           coalesce(r.amount, 0)::bigint as payments_received_minor
    from people pe
    left join bought b on b.user_id = pe.user_id
    left join used u on u.user_id = pe.user_id
    left join sent s on s.user_id = pe.user_id
    left join received r on r.user_id = pe.user_id
  )
  select t.user_id, t.purchases_minor, t.allocations_minor, t.payments_sent_minor, t.payments_received_minor,
         t.purchases_minor - t.allocations_minor + t.payments_sent_minor - t.payments_received_minor
  from totals t
  where t.active
     or t.purchases_minor <> 0 or t.allocations_minor <> 0
     or t.payments_sent_minor <> 0 or t.payments_received_minor <> 0
  order by t.user_id;
end;
$$;

-- The suggested transfers. `p_lead` overrides the group's lead for a what-if view.
create function public.calculate_settlement(
  p_group_id uuid, p_from date default null, p_to date default null, p_lead uuid default null
)
returns table (payer_id uuid, payee_id uuid, amount_minor bigint, lead_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'forbidden';
  end if;

  return query
  with b as (
    select g.user_id, g.net_minor as net from public.group_balances(p_group_id, p_from, p_to) g
  ),
  lead as (
    select coalesce(
      (select b.user_id from b where b.user_id = p_lead),
      (select b.user_id from b join public.groups gr on gr.settlement_lead_id = b.user_id where gr.id = p_group_id),
      (select b.user_id from b order by b.net desc, b.user_id limit 1)
    ) as id
    where exists (select 1 from b where b.net > 0)
  )
  select x.payer, x.payee, x.amount, x.lead from (
    select b.user_id as payer, l.id as payee, -b.net as amount, l.id as lead
    from b, lead l where b.net < 0 and b.user_id <> l.id
    union all
    select l.id, b.user_id, b.net, l.id
    from b, lead l where b.net > 0 and b.user_id <> l.id
  ) x
  -- Collections into the lead first, then the lead's payouts; largest first.
  order by x.payee = x.lead desc, x.amount desc, x.payer, x.payee;
end;
$$;

-- ---------------------------------------------------------------------------
-- Commands
-- ---------------------------------------------------------------------------

create function public.record_payment(
  p_group_id uuid,
  p_payer_id uuid,
  p_payee_id uuid,
  p_amount_minor bigint,
  p_paid_on date,
  p_note text,
  p_confirmed boolean,
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
  v_payment public.payments;
begin
  select result into v_receipt from public.command_receipts
  where user_id = v_uid and command = 'record_payment' and idempotency_key = p_idempotency_key;
  if found then
    return (v_receipt ->> 'payment_id')::uuid;
  end if;

  if not public.is_group_member(p_group_id) then
    raise exception 'forbidden';
  end if;
  if v_uid not in (p_payer_id, p_payee_id) and not public.is_group_admin(p_group_id) then
    raise exception 'forbidden';
  end if;
  if p_payer_id is null or p_payee_id is null or p_payer_id = p_payee_id
     or p_amount_minor is null or p_amount_minor < 1 then
    raise exception 'invalid_payment';
  end if;
  if (select count(distinct m.user_id) from public.memberships m
      where m.group_id = p_group_id and m.user_id in (p_payer_id, p_payee_id)) <> 2 then
    raise exception 'member_not_found';
  end if;
  select (now() at time zone g.timezone)::date into v_today from public.groups g where g.id = p_group_id;
  if p_paid_on is null or p_paid_on > v_today then
    raise exception 'future_date';
  end if;
  if p_confirmed is not true then
    raise exception 'confirmation_required';
  end if;

  insert into public.payments (group_id, payer_id, payee_id, amount_minor, paid_on, note, recorded_by)
  values (p_group_id, p_payer_id, p_payee_id, p_amount_minor, p_paid_on, nullif(btrim(p_note), ''), v_uid)
  returning * into v_payment;

  perform public.write_audit(p_group_id, v_uid, 'payment.recorded', 'payment', v_payment.id, null,
    to_jsonb(v_payment));

  insert into public.command_receipts (user_id, command, idempotency_key, result)
  values (v_uid, 'record_payment', p_idempotency_key, jsonb_build_object('payment_id', v_payment.id));

  return v_payment.id;
end;
$$;

-- Marks a mistaken payment record as reversed. The original stays visible; record a new
-- payment to correct it.
create function public.reverse_payment(p_payment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_before public.payments;
  v_after public.payments;
begin
  select * into v_before from public.payments where id = p_payment_id for update;
  if v_before.id is null or not public.is_group_member(v_before.group_id)
     or (v_before.recorded_by <> v_uid and not public.is_group_admin(v_before.group_id)) then
    raise exception 'forbidden';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'reason_required';
  end if;
  if v_before.status = 'reversed' then
    return;
  end if;

  update public.payments
  set status = 'reversed', reversed_by = v_uid, reversed_at = now(), reversal_reason = btrim(p_reason)
  where id = p_payment_id
  returning * into v_after;

  perform public.write_audit(v_before.group_id, v_uid, 'payment.reversed', 'payment', p_payment_id,
    to_jsonb(v_before), to_jsonb(v_after));
end;
$$;

-- Null goes back to the default: the largest net creditor.
create function public.set_settlement_lead(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_before uuid;
begin
  if not public.is_group_admin(p_group_id) then
    raise exception 'forbidden';
  end if;
  if p_user_id is not null and not exists (
    select 1 from public.memberships m
    where m.group_id = p_group_id and m.user_id = p_user_id and m.left_at is null
  ) then
    raise exception 'member_not_found';
  end if;

  select settlement_lead_id into v_before from public.groups where id = p_group_id for update;
  if v_before is not distinct from p_user_id then
    return;
  end if;
  update public.groups set settlement_lead_id = p_user_id where id = p_group_id;

  perform public.write_audit(p_group_id, v_uid, 'settlement.lead_changed', 'group', p_group_id,
    jsonb_build_object('settlement_lead_id', v_before), jsonb_build_object('settlement_lead_id', p_user_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Row level security (reads only) and privileges
-- ---------------------------------------------------------------------------

alter table public.payments enable row level security;

create policy "payments: members read" on public.payments
  for select to authenticated using (public.is_group_member(group_id));

revoke all on public.payments from anon, authenticated;
grant select on public.payments to authenticated;

revoke execute on function
  public.guard_payment_change(),
  public.group_balances(uuid, date, date),
  public.calculate_settlement(uuid, date, date, uuid),
  public.record_payment(uuid, uuid, uuid, bigint, date, text, boolean, text),
  public.reverse_payment(uuid, text),
  public.set_settlement_lead(uuid, uuid)
from public, anon, authenticated;
grant execute on function
  public.group_balances(uuid, date, date),
  public.calculate_settlement(uuid, date, date, uuid),
  public.record_payment(uuid, uuid, uuid, bigint, date, text, boolean, text),
  public.reverse_payment(uuid, text),
  public.set_settlement_lead(uuid, uuid)
to authenticated;
