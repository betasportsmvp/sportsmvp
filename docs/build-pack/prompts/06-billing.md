# Prompt 06 — Subscription Readiness and Beta Entitlements

```text
Continue from the persistent Beta Sports MVP context and completed settlement phase. Implement Phase 5A only.

Goal: make the product subscription-ready without blocking private beta or enabling a live payment provider.

Pricing reference:
- Free: one group, up to 12 active members, current settlement and core attendance.
- Group Pro Monthly: ₹299/month.
- Group Pro Annual: ₹2,499/year.
- Founding Club Pass: ₹4,999 one-time, only for a deliberately limited early cohort.

Deliver:
1. Billing accounts, plans, subscriptions, entitlements, and billing-events schema with RLS.
2. Feature-gate service with server-authoritative `hasEntitlement(groupId, feature)` checks and client-friendly read model.
3. Free and Pro feature matrix. Never revoke visibility of a user’s historical financial records because a group downgrades.
4. Pricing/settings screen describing plans and showing a non-purchasable “Beta access” state.
5. Provider abstraction and webhook interface with idempotent event handling; implement a local fake provider/test fixture only.
6. Tests for entitlement expiry, beta override, group isolation, and duplicate webhook event.

Do not collect cards, create a Stripe account, invoke a store SDK, or add a real checkout. Keep in-app subscription policy constraints documented for the later native-app decision.
```
