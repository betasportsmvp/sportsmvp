# Prompt 08 — Security, Audit, Quality, and Beta Hardening

```text
Continue from the persistent Beta Sports MVP context and completed MVP features. Implement Phase 6 hardening only.

Goal: prepare a private beta safely without expanding scope.

Perform and fix:
1. RLS review for every table, view, function, storage object, and new endpoint. Demonstrate member/admin/owner/non-member cases with automated tests.
2. Authorization checks for every mutation; do not rely on hidden UI controls.
3. Idempotency/retry tests for all financial write commands.
4. Audit-event coverage review for attendance, invitations, role changes, purchase, consumption, allocation, payment, correction, and billing entitlement changes.
5. Validation, rate limiting where suitable, secure headers, error boundaries, and safe user-facing errors.
6. Backup/restore documentation, privacy/data-deletion policy draft, and receipt access review.
7. Mobile accessibility pass: focus, contrast, touch targets, labels, loading, no-network and conflict states.
8. Test suite and CI quality gate.

Return a concise risk register with severity, remediation, and any explicit decision needed from the product owner. Do not claim compliance certification or legal approval.
```
