# Beta Sports MVP — UI/UX Specification

## Design principles

- The primary interaction is a ten-second court-side check-in.
- Use friendly, unambiguous language: “I’m playing”, “Mark as present”, “Record ball use”, “Confirm payment”.
- Explain money before asking for action.
- Make corrections possible but visibly accountable.
- The phone layout is primary; desktop improves administration rather than changing workflows.

## Navigation

Mobile bottom tabs:

```text
Today | Calendar | Balls | Settle | Group
```

The **Today** screen opens by default. Admin actions live in an overflow/menu when they are not daily.

## Screens

### 1. Welcome / Google sign-in

- App mark plus concise value statement.
- One dominant “Continue with Google” button.
- Terms/privacy links are placeholders/configurable for beta.

### 2. Create or join group

- Create: group name, sport, timezone, currency.
- Join: validate invite and preview group name before confirmation.
- Keep optional configuration behind “More settings.”

### 3. Today

- Date and group switcher.
- Large status card: Not recorded / Playing / Not playing.
- Admin roster with quick present toggles.
- Compact inventory alert and “Record ball use” only when an admin.
- Summary: players present, cost pending/posted, current balance.

### 4. Calendar

- Month grid with presence indicator per day.
- Tap a date for details; an out-of-policy date is read-only with explanation.
- Distinguish date attended from time the record was added.

### 5. Balls / inventory

- On-hand quantity by item.
- Primary actions: “Add purchase”, “Record use”.
- History timeline of purchase, consumption, adjustment, and reversal.
- Never expose an editable “stock count” as the primary state.

### 6. Settlement

- Personal card: “You owe ₹X” or “You are owed ₹X.”
- “How this was calculated” opens allocations by session.
- Settlement plan: clear payer -> payee rows; status is Suggested or Confirmed.
- Recording payment requires payer, payee, amount, date, optional note, and confirmation.

### 7. Group/admin

- Members and roles.
- Group policies, invites, audit history, export, billing placeholder.

## Accessibility and UX checks

- 44px minimum touch targets, keyboard-operable forms, visible focus, labels for icons.
- Never rely on red/green alone for attendance or balances.
- Currency uses locale-aware display but stores minor integers.
- All destructive-looking actions use reversible correction vocabulary, not “Delete”.
