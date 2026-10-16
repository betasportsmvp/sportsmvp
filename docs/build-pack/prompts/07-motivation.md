# Prompt 07 — Fitness Motivation Without Financial Pressure

```text
Continue from the persistent Beta Sports MVP context and a stable core MVP. Implement Phase 5B only.

Goal: encourage real participation through supportive, private, attendance-based motivation. Do not introduce cash prizes, entry fees, public rankings, betting, or shame-oriented messaging.

Deliver:
1. Personal weekly target (default: two sessions) and group monthly target, both configurable.
2. Attendance streak/consistency calculation based only on present attendance in the group timezone.
3. Today and group screens with encouraging progress language, e.g. “You played twice this week” and “Your group is 4 sessions from its goal.”
4. Optional reminder preferences modeled in the database but do not send real push notifications yet.
5. Privacy settings: a member can hide their individual consistency from non-admin group members; aggregate group progress remains available.
6. Tests for timezone/week boundaries, streak break, privacy rules, and no financial-data coupling.

Keep the implementation small. The attendance and settlement flows must remain faster and clearer than any gamification surface.
```
