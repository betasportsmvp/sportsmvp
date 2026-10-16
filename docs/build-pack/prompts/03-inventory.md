# Prompt 03 — Ball Inventory and Purchases

```text
Continue from the persistent Beta Sports MVP context and completed attendance phase. Implement Phase 2 only.

Goal: record tennis-ball inventory as a trustworthy movement ledger, not an editable counter.

Deliver:
1. Generic consumable items, seeded with “Tennis balls”; units support can, tube, ball, and pack.
2. Admin/member purchase form: item, quantity, total price, purchaser, purchase date, note, optional receipt upload.
3. Purchase posting command that creates a purchase, FIFO inventory lot(s), positive inventory movement, and audit event atomically. Money must be integer minor units.
4. Private receipt storage with group-aware authorization and no public bucket.
5. Balls screen with on-hand stock, low-stock indication, and chronological ledger. Show purchaser and cost without calling it a debt yet.
6. Admin-only adjustment flow requiring a reason; corrections/reversals remain visible.
7. RLS and tests: unauthorized user cannot view receipts/inventory; duplicate request cannot duplicate a purchase; stock equals the sum of posted movements/lots.

Do not consume balls, allocate costs, calculate balances, or record payments yet. Do not allow direct editing of on-hand quantity.

Acceptance: two purchases at different unit costs can be posted and the stock ledger correctly explains the on-hand total.
```
