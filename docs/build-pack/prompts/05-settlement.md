# Prompt 05 — Balances, Payer/Payee Settlement, and Payment Records

```text
Continue from the persistent Beta Sports MVP context and completed consumption/allocation phase. Implement Phase 4 only.

Goal: transparently calculate balances and propose a collection-hub settlement, without moving money.

Definitions:
- Positive net balance: the group owes this person.
- Negative net balance: this person owes the group.
- Net balance = purchase reimbursements + confirmed payments received - active attendance allocations - confirmed payments sent.
- The default Settlement Lead is the highest net creditor, not the person with the highest total purchase spend.

Deliver:
1. Authoritative group and member balance query/view. Exclude reversed/draft entries and use a selected period.
2. Settlement screen with a personal balance card, per-session explanation, and Suggested/Confirmed statuses.
3. Settlement plan algorithm: every debtor pays the Settlement Lead; the lead pays every other creditor; the lead retains its own credit. Permit admin to nominate a different lead and clearly surface any consequence.
4. Payment recording form: payer, payee, amount, payment date, optional reference/note, recorder. Confirmation is explicit and creates audit record. No external payment gateway.
5. Payment reversal/correction, preserving original history.
6. Seeded demo scenario matching this expected result: Asha +800, Vikram -100, Neha -400, Rohan +200; suggest Vikram -> Asha 100, Neha -> Asha 400, Asha -> Rohan 200.
7. Tests for balanced group, no creditors, partial payment, non-member attempts, settlement after correction, and the seeded scenario.

Do not introduce real money transfer, wallet/custody behavior, multi-currency, or fees. Make calculation inputs inspectable in the UI.
```
