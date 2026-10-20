# Plans and billing readiness

The app is ready to have paid plans, but takes no payments. During the private beta every
group gets Pro through a "Beta access" override, and the Plan screen says so.

## Plans

| Plan | Price | Notes |
| --- | --- | --- |
| Free | ₹0 | 1 group, up to 12 active members, attendance, ball costs and current settlement |
| Group Pro Monthly | ₹299 a month | For the whole group |
| Group Pro Annual | ₹2,499 a year | |
| Founding Club Pass | ₹4,999 once | Limited to the first 100 clubs; does not expire |

Pro adds balances for any date range and more than 12 active members. The matrix lives in
`public.plan_features()` and `apps/web/lib/plans.ts`; `billing.test.ts` keeps them equal.

## Rules

- `public.group_has_entitlement(group, feature)` is the authority. The app checks it on the
  server (`lib/entitlements.ts`) and fails closed.
- A downgrade never hides financial history. Balances, payments, purchases and cost
  drill-downs are Free features. Going back to Free only hides the date-range filter and
  stops new members joining a group that already has 12; nobody is removed.
- Order of precedence: an active override (beta, or a per-group grant), then a live
  subscription, then Free. A cancelled subscription stays Pro until its period ends.

## Provider and webhooks

- `lib/billing/provider.ts` defines `BillingProvider` and `handleBillingWebhook`. Only
  `FakeBillingProvider` exists, for tests and local work; `createCheckout` always fails with
  `checkout_unavailable`.
- Events are normalised to `subscription.activated`, `.renewed`, `.past_due`, `.canceled`,
  `.expired` and `.revoked` (refund), and applied by `public.apply_billing_event()`.
- That function is granted to the service role only. Each provider event id is stored once
  in `billing_events`, so a retried delivery returns `duplicate` and changes nothing.
- There is no webhook route yet. When a real provider is chosen, add a route that verifies
  the provider's signature and calls `apply_billing_event` with a server-only key. The
  service-role key must never reach the browser.

## In-app purchase policy, for the native app decision

If the app ships in the Apple App Store or Google Play, digital features unlocked inside
the app (Group Pro) generally have to be sold through the store's own in-app purchase, with
the store's commission, rather than through our own checkout. Points to settle before then:

- Apple: in-app purchase is required for digital subscriptions bought in the app. Linking
  out to a web checkout is restricted and varies by region and programme (for example the
  reader-app and external purchase link entitlements).
- Google Play: Play Billing is required for digital goods, with user-choice billing
  available in some countries.
- Both stores require clear cancellation, renewal terms and restore-purchases in the app.
- A web-only (PWA) checkout avoids store billing, but the native app must not then point
  users to it in ways the store disallows.
- Store purchases would arrive through the store's server notifications, normalised into
  the same events above, so entitlements work the same whichever way someone paid.

Check each store's current guidelines when the decision is made; they change often.
