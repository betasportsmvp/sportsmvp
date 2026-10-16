# Beta Sports MVP

Beta helps recurring sports groups show up, record shared consumables, and settle the resulting costs fairly from actual attendance. "Beta" is a temporary, configurable display name.

The product spec and the phased build prompts live in [`docs/build-pack/`](docs/build-pack/README.md). Work proceeds one phase at a time.

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Foundation: PWA shell, Google sign-in, groups, invites, schema, RLS | In progress |
| 1 | Attendance and calendar | Not started |
| 2 | Inventory | Not started |
| 3 | Consumption and allocation | Not started |
| 4 | Settlement | Not started |
| 5 | Billing readiness and motivation | Not started |
| 6 | Quality, security and beta release | Not started |

## Stack

```text
apps/web/              Next.js 16 (App Router, TypeScript) installable PWA
  app/                 routes and UI
  components/          shared UI
  lib/                 config, Supabase clients, helpers
  tests/unit/          Vitest unit tests
  tests/integration/   database access-rule tests (real Postgres)
supabase/
  migrations/          schema, RLS policies and server-side commands
  seed.sql             local demo data
  tests/supabase-shim.sql  test-only stand-in for Supabase's auth schema and roles
```

Supabase provides Google auth, Postgres with Row Level Security, and (later) private storage. The browser only ever uses the **publishable** key. All writes beyond editing your own display name go through `SECURITY DEFINER` database commands (`create_group`, `create_invite`, `join_group_from_invite`, `set_member_role`, `remove_member`, ...) that check membership and role, accept an idempotency key where it matters, and write an `audit_events` row in the same transaction.

## Prerequisites

- Node 22+ and pnpm 10 (`corepack enable`)
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) and Docker, for running Supabase locally
- A PostgreSQL 15+ server for the database tests (Supabase local's database works)

## Local setup

```bash
pnpm install
supabase start                    # starts local Supabase, applies migrations and seed
supabase status                   # prints the API URL and publishable key
cp apps/web/.env.example apps/web/.env.local
# set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY from `supabase status`
# set NEXT_PUBLIC_ENABLE_DEV_LOGIN=true to sign in as the seeded users without Google
pnpm dev                          # http://localhost:3000
```

### Signing in locally

Google sign-in is off in `supabase/config.toml` by default so you can work without OAuth credentials. With `NEXT_PUBLIC_ENABLE_DEV_LOGIN=true`, the welcome page shows **Local test sign-in**: enter a seeded email and open the link from the local mail inbox at http://127.0.0.1:54324.

| User | Seeded state |
| --- | --- |
| `alice@example.test` | Owner of "Sunday Doubles" |
| `bob@example.test` | Not a member; join at `/join/local-dev-invite-token-not-secret` |
| `carol@example.test` | Outsider; must not see the group |

To try real Google sign-in locally, follow the comment above `[auth.external.google]` in `supabase/config.toml`.

**Never set `NEXT_PUBLIC_ENABLE_DEV_LOGIN=true` in staging or production.**

## Hosted Supabase setup (staging / production)

New to Supabase, Google Cloud or Vercel? Follow the click-by-click [setup guide](docs/setup-guide.md) instead.

Use separate Supabase projects for staging and production.

1. Create the project, then link and push the schema:
   ```bash
   supabase link --project-ref <project-ref>
   supabase db push              # applies supabase/migrations (never the seed)
   ```
2. **Authentication → Sign In / Providers → Google:** enable it and paste the Google client ID and secret (below).
3. **Authentication → URL Configuration:**
   - Site URL: your app origin, for example `https://staging.example.com`
   - Redirect URLs: `https://staging.example.com/auth/callback` (add `http://localhost:3000/auth/callback` only on a dev project)
4. **Project Settings → API Keys:** copy the project URL and the **publishable** key into the app's environment. Do not put the secret/service-role key in the web app.

### Google OAuth client

In Google Cloud Console → APIs & Services → Credentials, create an **OAuth client ID** of type **Web application**:

- Authorized JavaScript origins: your app origin (for example `https://staging.example.com`, and `http://localhost:3000` for development)
- Authorized redirect URIs: `https://<project-ref>.supabase.co/auth/v1/callback` (and `http://127.0.0.1:54321/auth/v1/callback` for local Supabase)

Configure the OAuth consent screen with the scopes `openid`, `email` and `profile`. Use a separate client for production.

## Environment variables

See [`apps/web/.env.example`](apps/web/.env.example). Everything is `NEXT_PUBLIC_*` because the app currently needs no server-only secrets.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase API URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable (anon) key |
| `NEXT_PUBLIC_SITE_URL` | Public app origin used in OAuth and invite links |
| `NEXT_PUBLIC_APP_NAME` | Display name, defaults to `Beta` |
| `NEXT_PUBLIC_APP_TAGLINE`, `NEXT_PUBLIC_SUPPORT_EMAIL`, `NEXT_PUBLIC_TERMS_URL`, `NEXT_PUBLIC_PRIVACY_URL` | Rename-ready identity and legal links |
| `NEXT_PUBLIC_ENABLE_DEV_LOGIN` | Local-only email sign-in for seeded users |

## Migrations

```bash
supabase migration new <name>     # create a new migration file
supabase db reset                 # local: re-apply all migrations and the seed
supabase db push                  # hosted: apply pending migrations to the linked project
```

Rules for new tables and functions:

- Enable RLS and add explicit policies; with no policy a table is closed.
- Supabase grants broad default privileges to `anon`/`authenticated` on new objects. Each migration must `revoke` and then `grant` only what is needed, as the foundation migration does.
- Financial and membership writes go through `SECURITY DEFINER` commands with `set search_path = ''`, an idempotency key, and an audit event.

## Tests

```bash
pnpm lint
pnpm typecheck
pnpm test                         # unit tests
pnpm test:db                      # access-rule tests against Postgres
pnpm build
```

`pnpm test:db` creates a throwaway database for each run, applies `supabase/tests/supabase-shim.sql`, every migration and the seed, then exercises the rules as real `authenticated`/`anon` requests would. By default it connects to `postgresql://postgres:postgres@localhost:5432/postgres`; point it elsewhere with `TEST_DATABASE_ADMIN_URL` (for local Supabase: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`).

The Phase 0 acceptance case is covered there: user A signs in and creates a group, user B joins through a valid invite, and user C cannot read either user's group data.

CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests and build; the database tests on Postgres 16; and the migrations plus seed on Supabase's own Postgres image with `supabase db lint`.
