import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createAuthUser, createTestDatabase, type TestDb } from "./db";

// Phase 5 motivation: weekly goals, streaks and group progress from present attendance only,
// in the group's own calendar, with a privacy choice per member.

let db: TestDb;
let admin: string;
let maya: string;
let nik: string;
let group: string;

const key = () => `key-${crypto.randomUUID()}`;

async function localToday(tz: string) {
  const { rows } = await db.client.query("select (now() at time zone $1)::date::text as d", [tz]);
  return rows[0].d as string;
}

/** Marks attendance directly, as of a given group-local date. */
async function mark(groupId: string, user: string, date: string, status: "present" | "absent" = "present") {
  const { rows } = await db.client.query(
    `insert into public.sessions (group_id, local_date, created_by) values ($1, $2, $3)
     on conflict (group_id, local_date) do update set local_date = excluded.local_date returning id`,
    [groupId, date, user],
  );
  await db.client.query(
    `insert into public.attendance (session_id, user_id, status, recorded_by) values ($1, $2, $3, $2)
     on conflict (session_id, user_id) do update set status = excluded.status`,
    [rows[0].id, user, status],
  );
}

async function streak(user: string, today: string, target = 2) {
  const { rows } = await db.client.query("select public.week_streak($1, $2, $3, $4) as n", [group, user, today, target]);
  return rows[0].n as number;
}

function progress(viewer: string, groupId = group) {
  return as(db.client, viewer, async (q) => {
    const { rows } = await q("select * from public.member_progress($1)", [groupId]);
    return rows;
  });
}

function setPrefs(user: string, opts: { target?: number; hide?: boolean; reminders?: boolean; days?: number[] } = {}) {
  return as(db.client, user, (q) =>
    q("select public.set_my_preferences($1, $2, $3, $4, $5, '18:30')", [
      group,
      opts.target ?? 2,
      opts.hide ?? false,
      opts.reminders ?? false,
      opts.days ?? [],
    ]),
  );
}

async function join(groupId: string, owner: string, user: string) {
  const { rows } = await as(db.client, owner, (q) => q("select token from public.create_invite($1)", [groupId]));
  await as(db.client, user, (q) => q("select public.join_group_from_invite($1, $2)", [rows[0].token, key()]));
}

beforeAll(async () => {
  db = await createTestDatabase();
  admin = await createAuthUser(db.client, "admin@example.test", "Ada Admin");
  maya = await createAuthUser(db.client, "maya@example.test", "Maya M");
  nik = await createAuthUser(db.client, "nik@example.test", "Nik N");
  const { rows } = await as(db.client, admin, (q) =>
    q("select public.create_group('Club', 'tennis', 'Asia/Kolkata', 'INR', $1) as id", [key()]),
  );
  group = rows[0].id;
  await join(group, admin, maya);
  await join(group, admin, nik);
});

afterAll(async () => {
  await db?.drop();
});

describe("week streaks", () => {
  // 2026-10-19 is a Monday.
  it("counts Monday-to-Sunday weeks and lets the week in progress pass", async () => {
    for (const d of ["2026-09-29", "2026-10-01", "2026-10-06", "2026-10-11", "2026-10-12", "2026-10-18"]) {
      await mark(group, maya, d);
    }
    // Weeks of 28 Sep, 5 Oct and 12 Oct each have two games (12 Oct and 18 Oct are Mon and Sun).
    expect(await streak(maya, "2026-10-19")).toBe(3);
    // Sunday 18 Oct is still the week of 12 Oct.
    expect(await streak(maya, "2026-10-18")).toBe(3);
    await mark(group, maya, "2026-10-19");
    await mark(group, maya, "2026-10-21");
    expect(await streak(maya, "2026-10-21")).toBe(4);
  });

  it("breaks on a week below target, and ignores days marked not playing", async () => {
    await mark(group, nik, "2026-10-06");
    await mark(group, nik, "2026-10-08");
    await mark(group, nik, "2026-10-13");
    await mark(group, nik, "2026-10-15", "absent");
    expect(await streak(nik, "2026-10-19")).toBe(0);
    expect(await streak(nik, "2026-10-19", 1)).toBe(2);
  });
});

describe("this week and month", () => {
  it("uses the group's own date, not the server's", async () => {
    // UTC+14: often already tomorrow for the server.
    const { rows } = await as(db.client, admin, (q) =>
      q("select public.create_group('Island', 'tennis', 'Pacific/Kiritimati', 'INR', $1) as id", [key()]),
    );
    const island = rows[0].id as string;
    await mark(island, admin, await localToday("Pacific/Kiritimati"));
    const [me] = await progress(admin, island);
    expect(me).toMatchObject({ sessions_this_week: 1, sessions_this_month: 1 });

    const g = await as(db.client, admin, (q) => q("select * from public.group_progress($1)", [island]));
    expect(g.rows[0]).toMatchObject({ sessions_played: 1, monthly_target: 12, players_this_week: 1 });
  });

  it("counts group sessions where anyone played against the monthly goal", async () => {
    const today = await localToday("Asia/Kolkata");
    await mark(group, nik, today);
    await mark(group, maya, today);
    const { rows } = await as(db.client, maya, (q) => q("select * from public.group_progress($1)", [group]));
    expect(rows[0].sessions_played).toBeGreaterThanOrEqual(1);

    await expect(
      as(db.client, maya, (q) => q("select public.set_group_monthly_target($1, 8)", [group])),
    ).rejects.toThrow("forbidden");
    await as(db.client, admin, (q) => q("select public.set_group_monthly_target($1, 8)", [group]));
    const after = await as(db.client, maya, (q) => q("select monthly_target from public.group_progress($1)", [group]));
    expect(after.rows[0].monthly_target).toBe(8);
  });
});

describe("privacy and preferences", () => {
  it("hides a member's consistency from other members but not from admins or themselves", async () => {
    await setPrefs(nik, { hide: true });
    const ids = (rows: { user_id: string }[]) => rows.map((r) => r.user_id).sort();
    expect(ids(await progress(maya))).toEqual([admin, maya].sort());
    expect(ids(await progress(nik))).toContain(nik);
    expect(ids(await progress(admin))).toEqual([admin, maya, nik].sort());

    // The group total still counts everyone.
    const { rows } = await as(db.client, maya, (q) => q("select players_this_week from public.group_progress($1)", [group]));
    expect(rows[0].players_this_week).toBeGreaterThanOrEqual(2);
  });

  it("stores reminder choices, validates them, and keeps them private", async () => {
    await setPrefs(maya, { target: 3, reminders: true, days: [1, 3] });
    await expect(setPrefs(maya, { reminders: true, days: [] })).rejects.toThrow("invalid_preferences");
    await expect(setPrefs(maya, { target: 0 })).rejects.toThrow("invalid_preferences");

    const own = await as(db.client, maya, (q) => q("select weekly_target, reminder_days from public.member_preferences"));
    expect(own.rows).toEqual([{ weekly_target: 3, reminder_days: [1, 3] }]);
    const others = await as(db.client, admin, (q) =>
      q("select count(*)::int as n from public.member_preferences where user_id = $1", [maya]),
    );
    expect(others.rows[0].n).toBe(0);
    await expect(
      as(db.client, maya, (q) => q("update public.member_preferences set weekly_target = 7")),
    ).rejects.toThrow("permission denied");
  });

  it("keeps non-members out", async () => {
    const stranger = await createAuthUser(db.client, "stranger@example.test", "Sam S");
    await expect(progress(stranger)).rejects.toThrow("forbidden");
    await expect(setPrefs(stranger)).rejects.toThrow("forbidden");
  });
});

describe("no link to money", () => {
  it("reads nothing financial, so payments and ball costs never change progress", async () => {
    const before = await progress(admin);
    await as(db.client, admin, (q) =>
      q("select public.record_payment($1, $2, $3, 5000, $4, null, true, $5)", [
        group,
        maya,
        admin,
        "2026-10-01",
        key(),
      ]),
    );
    expect(await progress(admin)).toEqual(before);

    const { rows } = await db.client.query(
      `select distinct d.refobjid::regclass::text as dep
       from pg_depend d join pg_proc p on p.oid = d.objid
       where p.proname in ('member_progress', 'group_progress', 'week_streak') and d.classid = 'pg_proc'::regclass
         and d.refclassid = 'pg_class'::regclass`,
    );
    expect(rows).toEqual([]);
    const src = await db.client.query(
      "select string_agg(prosrc, ' ') as body from pg_proc where proname in ('member_progress', 'group_progress', 'week_streak')",
    );
    expect(src.rows[0].body).not.toMatch(/payments|purchases|allocations|consumptions|plans|subscriptions/);
  });
});
