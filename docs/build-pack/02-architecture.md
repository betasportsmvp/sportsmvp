# Beta Sports MVP — Technical Architecture

## Recommendation

Build a responsive, installable web app first.

```text
Next.js PWA (TypeScript) -> Supabase Auth -> PostgreSQL + RLS
                         -> Supabase Storage (private receipts)
                         -> Edge Functions / database RPC for financial writes
                         -> optional scheduled jobs for reminders
```

## Why this shape

- Daily attendance works well in a mobile browser/PWA without app-store friction.
- PostgreSQL represents memberships, sessions, lots, allocations, and payments naturally.
- Supabase provides Google authentication, row-level authorization, storage, and a viable future path to realtime updates.
- Financial state transitions are kept server-side, transactional, and auditable.

## Application structure

```text
apps/web/
  app/                 route/UI layer
  components/          reusable UI
  features/            attendance, groups, inventory, settlement, billing
  lib/                 typed client, permissions, formatting
  tests/               unit, integration, end-to-end
supabase/
  migrations/          schema and RLS policies
  functions/           privileged webhooks/reminders only
  seed.sql
```

## Trust boundaries

- Client: presents data and requests actions; it never calculates authoritative balances.
- Database/RPC: validates membership, role, idempotency, stock availability, allocation input, and writes audit events atomically.
- Service-role credentials: never exposed to the browser.
- Storage: private bucket; signed URLs only for authorized group members.

## Server-side commands

Use database functions or an equivalent server action for:

- `create_group`
- `join_group_from_invite`
- `upsert_attendance`
- `record_purchase`
- `record_consumption_and_allocate`
- `reverse_or_correct_entry`
- `record_payment`
- `calculate_settlement`

Each command accepts an idempotency key and writes an audit event inside the same transaction.

## Environments

- `local`: seeded local database, test Google auth substitute.
- `staging`: real OAuth test client, isolated project/database/storage.
- `production`: separate OAuth configuration, monitored backups, no test data.

## Rename readiness

Use `NEXT_PUBLIC_APP_NAME=Beta`. Keep logo, metadata, emails, URLs, product IDs, and legal links centrally configured. No hard-coded name in database records or migrations.
