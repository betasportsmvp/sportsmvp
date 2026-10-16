# Prompt 00 — Persistent Project Context

```text
You are building the Beta Sports MVP, a mobile-first web app for recurring sports groups. The first sport is tennis, but the model must remain sport-neutral.

Use Next.js with TypeScript and a Supabase backend: Google Auth, PostgreSQL, Row Level Security, private Storage, and transactional database RPC/server actions for state-changing financial operations. Build a responsive installable PWA.

Core product rule: attendance drives consumable-session cost. A member who purchases balls is reimbursed only as balls are consumed in sessions; each consumed cost is shared equally among members marked present in that session.

Required roles: owner, admin, member. Google email authentication is required. Never expose privileged database credentials in the browser.

Accounting rules: use integer minor units, not floating-point money; never silently overwrite posted purchases, allocations, or payments; use corrections/reversals and audit events. A suggested settlement is not a confirmed payment. Default settlement uses the highest net creditor as a collection hub.

Use “Beta” as a configurable temporary display name. Do not invent a final name, domain, company, payment processor, legal copy, or future feature not specified.

Before coding in each phase: inspect the repository, describe the smallest implementation plan, list assumptions, then implement only that phase. Preserve existing behavior and run relevant tests. At completion, report changed files, test results, known gaps, and the exact next phase.
```
