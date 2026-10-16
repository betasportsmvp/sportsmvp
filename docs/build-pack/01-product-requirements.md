# Beta Sports MVP — Product Requirements

## Problem

Informal, recurring sports groups coordinate attendance and share consumable costs in chats or spreadsheets. This makes it easy to forget attendance, lose track of supplies, and argue over who should reimburse whom.

## Target users

- **Player:** joins recurring sessions, records their attendance, views costs and settlement.
- **Admin:** runs a group, records attendance and supplies, corrects mistakes, and initiates settlement.
- **Owner:** the primary admin; manages membership, roles, subscription, exports, and group-level policies.

Start with tennis. The domain model must support another sport without migration: a generic group, session, consumable item, and attendance record.

## MVP outcomes

1. A group can accurately answer: “Who attended this session?”
2. A purchaser can record balls bought and the group can see remaining stock.
3. A session can record balls consumed; only marked attendees bear that session’s cost.
4. Members can see a transparent current balance and a proposed payer/payee settlement.
5. Corrections can be understood later.

## Required features

### Identity and groups

- Sign in with Google only.
- Profile created from verified identity data.
- Create a group with name, timezone, currency, sport, and backdate window.
- Invite by secure, expiring link; join after Google sign-in.
- Roles: `owner`, `admin`, `member`.

### Attendance

- Create or open one session per group and local calendar date.
- Mark self as `present` or `absent`; admin can mark all active members.
- Calendar view supports backdated attendance within the group policy (default: 14 days for a member).
- Admin may correct any historic attendance.
- Late edits show actor and timestamp.

### Inventory and expense capture

- Add consumable: tennis balls initially; generic units such as can, tube, ball, pack.
- Record purchase: quantity, total amount, purchaser, date, note; receipt image optional.
- Record consumption against a session; inventory cannot go below zero without an explicit admin adjustment.
- Use FIFO cost layers for MVP where possible; otherwise require a chosen unit cost and retain its source.

### Costs and settlement

- Generate one allocation per eligible `present` attendee when consumption is posted.
- Equal split is the only required split rule for MVP.
- Record confirmed person-to-person payments (`payer`, `payee`, amount, date, optional reference).
- Display balances and a settlement plan.
- Default settlement hub is the largest **net creditor**, not necessarily the largest gross purchaser.
- Show a direct transfer plan as an alternative future option, but ship hub settlement first.

### Billing and motivation

- Feature flags/entitlements must exist from the beginning; charging is not required in the first private beta.
- Include a small attendance summary and personal/group streaks only after core flows work.

## Explicitly out of scope for first release

- Court booking, coaching marketplace, score/ranking system, live payments, UPI/card transfers, multiple currencies per group, OCR, split-by-weight, and public discovery.

## Acceptance metrics for private beta

- A new group reaches its first recorded session in under five minutes.
- A player can mark today’s attendance in under ten seconds.
- An admin can record a ball purchase and use in under one minute.
- Every displayed balance can be traced to allocations, purchases, and confirmed payments.
