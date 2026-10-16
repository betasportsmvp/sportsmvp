# Beta Sports MVP — Data, Accounting, and Settlement Rules

## Core entities

```text
profiles(id, email, display_name, avatar_url, created_at)
groups(id, name, sport, timezone, currency, backdate_days, owner_id)
memberships(id, group_id, user_id, role, joined_at, left_at)
sessions(id, group_id, local_date, created_by, created_at, status)
attendance(id, session_id, user_id, status, recorded_by, recorded_at)
items(id, group_id, name, unit_label, reorder_threshold)
purchases(id, group_id, item_id, purchaser_id, quantity, total_minor, purchased_on, note, receipt_path, status)
inventory_lots(id, purchase_id, received_quantity, remaining_quantity, unit_cost_minor)
inventory_movements(id, group_id, item_id, lot_id, kind, quantity, session_id, occurred_at, recorded_by)
cost_allocations(id, group_id, session_id, movement_id, user_id, amount_minor, rule_version, status)
payments(id, group_id, payer_id, payee_id, amount_minor, paid_on, note, recorded_by, status)
audit_events(id, group_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at)
```

All values ending in `_minor` are integer paise/cents. Timestamps are UTC; user-facing dates use `groups.timezone`.

## Invariants

- `sessions(group_id, local_date)` is unique.
- `attendance(session_id, user_id)` is unique.
- A user must be a current or historically valid group member for every group-owned record.
- `remaining_quantity` may not become negative through normal consumption.
- Posted financial entries are never overwritten; make a reversal or corrective replacement.
- Only `present` attendance is eligible for cost allocation by default.

## Posting a purchase

1. Validate purchaser is a group member and amount/quantity are positive.
2. Insert purchase and a corresponding inventory lot.
3. No player owes money merely because the purchase was made.
4. Audit the action.

## Posting consumption

1. Lock/select stock lots in FIFO order.
2. Validate total available quantity.
3. Create negative inventory movements linked to the session.
4. Get eligible present attendees. If zero, reject and explain why.
5. Allocate the consumed cost equally in integer minor units.
6. Distribute any rounding remainder deterministically by ascending member UUID, and show it in the allocation detail.
7. Write all rows and audit event atomically.

## Balance equation

For each member in one group:

```text
net_balance = purchase_reimbursements + payments_received
              - attendance_cost_allocations - payments_sent
```

A positive balance means the group owes the member; a negative balance means the member owes the group.

## Settlement-hub algorithm

1. Include only posted purchases, active allocations, and confirmed payments in the selected period.
2. Find positive balances (creditors) and negative balances (debtors).
3. Select the creditor with the largest positive balance as the default Settlement Lead.
4. Suggest each debtor pays the lead their absolute balance.
5. Suggest the lead pays every other creditor their positive balance.
6. The lead retains its own positive balance.

If no creditor exists, do not produce a plan. If the admin changes the lead, recalculate and show any required extra transfer. A plan is informational until all payments are recorded as confirmed.

## Corrections

- Attendance changes that affect a posted allocation trigger an explicit recalculation/reversal workflow; never mutate a confirmed payment.
- Corrections display old value, new value, actor, reason, and timestamp.
- Never delete business-financial history from the UI.
