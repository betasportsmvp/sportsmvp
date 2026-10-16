# Prompt 02 — Attendance and Calendar

```text
Continue from the persistent Beta Sports MVP context and the completed foundation. Implement Phase 1 only.

Goal: make attendance quick, accurate, backdatable, and auditable.

Deliver:
1. One group session per local group date, created on first attendance action.
2. Today screen: a member can mark self Present or Absent in no more than two taps after opening the app; admin can mark any active member.
3. Group calendar showing the signed-in member’s attendance by day; tap a date to review or update it.
4. Policy enforcement: members may backdate only their own attendance within `backdate_days` (default 14); admins can correct historic records. Future dates are rejected.
5. Database function/server action `upsert_attendance` that verifies membership, role, target date, idempotency, and writes a detailed audit event transactionally.
6. Accessible status labels and empty/error/offline-pending states.
7. Tests for unique session/date, membership access, backdate window, admin override, timezone boundaries, and audit creation.

Do not add balls, purchases, allocation, payments, leaderboards, or billing in this phase. Do not calculate money from attendance yet.

Acceptance: refresh/re-login preserves attendance; calendar date reflects the group timezone; late edits show who changed the record and when.
```
