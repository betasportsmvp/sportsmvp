# Beta Sports MVP — Builder Pack

This pack is the canonical hand-off for building the unnamed **Beta** sports-group app. It begins with the foundation and releases a small vertical slice at each phase. Use the prompts in order; do not paste every prompt into an agent at once.

## Product in one sentence

Beta helps recurring sports groups show up, record shared consumables, and settle the resulting costs fairly from actual attendance.

## Build order

1. `prompts/00-project-context.md` — provide once at the beginning of a build-agent thread.
2. `prompts/01-foundation.md` through `05-settlement.md` — required MVP path.
3. `prompts/06-billing.md` and `07-motivation.md` — launch extensions, after core data is stable.
4. `prompts/08-quality-security.md` and `09-release.md` — required before real users.

## Reference documents

- `01-product-requirements.md`
- `02-architecture.md`
- `03-data-and-settlement.md`
- `04-ui-ux-spec.md`
- `05-delivery-plan.md`

## Naming rule

Use the display name **Beta** only. Keep all product name, support email, legal URLs, package names, domains, and store IDs configurable. Do not make naming decisions or buy domains during the MVP build.

## Non-negotiables

- Google email authentication is required.
- Attendance drives session-cost allocation.
- Monetary values use integer minor units, never floating point.
- Purchases, inventory consumption, allocations, and payments are auditable.
- A payment suggestion never implies a payment has happened.
- Never treat this as a wallet, custody product, or payment processor in the MVP.
