# Beta Sports MVP — Delivery Plan

## Phase 0 — Foundation

Deliverable: deployable PWA shell, Google auth, protected routes, schema/migrations, test setup, environment documentation.

Exit: a signed-in user can create a group and another user can join it using a test invite.

## Phase 1 — Attendance

Deliverable: Today roster, self/admin attendance, session creation, backdated calendar, audit entries.

Exit: attendance policies are enforced and calendar edits survive refresh/relogin.

## Phase 2 — Inventory

Deliverable: consumable catalogue, purchases, inventory lots, receipt upload, on-hand view.

Exit: purchase posting is idempotent; stock numbers are reproducible from movements.

## Phase 3 — Consumption and allocation

Deliverable: consume balls per session; FIFO cost selection; equal present-attendee allocations; traceability UI.

Exit: automated tests cover uneven costs, no attendance, corrections, insufficient stock, and rounding.

## Phase 4 — Settlement

Deliverable: balances, hub plan, payment recording, correction/recalculation rules, settlement history.

Exit: seeded examples reconcile exactly and no plan records a payment automatically.

## Phase 5 — Monetization and motivation

Deliverable: entitlement model, paywall placeholder/feature flags, attendance summaries, optional streaks.

Exit: free/pro state is testable without a live payment gateway.

## Phase 6 — Beta readiness

Deliverable: privacy/terms placeholders, error states, monitoring, backup check, row-level access tests, PWA install flow, feedback channel.

Exit: a 10–20 person private group can use the app for a month without spreadsheet fallback.
