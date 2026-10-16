# Prompt 04 — Session Consumption and Attendance-Based Cost Allocation

```text
Continue from the persistent Beta Sports MVP context and completed inventory phase. Implement Phase 3 only.

Goal: when balls are used in a session, allocate their actual consumed cost equally and only to members marked Present.

Deliver:
1. Admin “Record ball use” flow from a session and the Balls screen: item, quantity, session, optional note.
2. A transactional `record_consumption_and_allocate` command that:
   - authorizes the admin;
   - selects available lots FIFO with locking/concurrency safety;
   - rejects insufficient stock or a session with zero Present attendees;
   - writes consumption movements tied to lots and session;
   - calculates cost from consumed lots;
   - creates exactly one allocation per present eligible attendee;
   - handles rounding deterministically in minor units;
   - writes audit records and supports idempotency.
3. Session detail section showing balls used, total cost, attendee list, and per-person allocation.
4. A “Why this cost?” drill-down from a member balance placeholder to allocations and source lots.
5. Correction flow: consumption can be reversed before settlement/payment; attendance changes affecting active allocations prompt an explicit reallocation/reversal operation rather than a silent rewrite.
6. Unit/integration tests for FIFO, mixed lot costs, three-way rounding, absent member exclusion, no-present rejection, low-stock rejection, retries, and corrections.

Do not build the final settlement dashboard or payment recording in this phase. Ensure all new tables are protected by RLS and every allocation is traceable.
```
