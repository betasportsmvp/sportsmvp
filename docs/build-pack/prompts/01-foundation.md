# Prompt 01 — Foundation and Architecture

```text
Continue from the persistent Beta Sports MVP context. Implement Phase 0 only.

Goal: establish a production-shaped but lightweight Next.js PWA and Supabase foundation. Do not build attendance, inventory, settlement, real billing, or motivation features yet.

Deliver:
1. TypeScript Next.js app with mobile-first layout and configurable Beta branding.
2. Supabase client/server setup using environment variables and clear `.env.example` documentation.
3. Google OAuth sign-in, protected app routes, sign-out, profile bootstrap.
4. Initial SQL migrations for profiles, groups, memberships, sessions, attendance, audit_events, and created/updated timestamps.
5. RLS policies proving that only members can view their group and only owners/admins can manage membership; use default-deny where appropriate.
6. Group creation and secure invite-token data model/UI sufficient for a second test user to join.
7. Seed data and at least one integration test for authorization boundaries.
8. README instructions for local setup, Supabase setup, Google OAuth redirect URLs, migrations, and tests.

Acceptance: two test users can sign in, user A can create a group, user B can join through a valid invite, and user C cannot read either group’s data.

Do not use service-role credentials in client code. Do not hard-code the product name. Finish with a compact implementation report and the precise migration/test commands run.
```
