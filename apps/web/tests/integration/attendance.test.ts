import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createAuthUser, createTestDatabase, type TestDb } from "./db";

// Phase 1: one session per group-local date, self check-in, backdate window,
// admin corrections, timezone boundaries and audit events.

let db: TestDb;
let alice: string; // owner
let dana: string; // admin
let bob: string; // member
let carol: string; // outsider
let groupId: string;
let today: string;

const key = () => `key-${crypto.randomUUID()}`;

async function createGroup(owner: string, name: string, timezone: string, backdateDays = 14) {
  return as(db.client, owner, async (q) => {
    const { rows } = await q("select public.create_group($1, 'tennis', $2, 'INR', $3, $4) as id", [
      name,
      timezone,
      key(),
      backdateDays,
    ]);
    return rows[0].id as string;
  });
}

async function join(owner: string, group: string, user: string) {
  const token = await as(db.client, owner, async (q) => {
    const { rows } = await q("select token from public.create_invite($1)", [group]);
    return rows[0].token as string;
  });
  await as(db.client, user, (q) => q("select public.join_group_from_invite($1, $2)", [token, key()]));
}

async function localToday(timezone: string, offsetDays = 0) {
  const { rows } = await db.client.query(
    "select ((now() at time zone $1)::date + $2::int)::text as d",
    [timezone, offsetDays],
  );
  return rows[0].d as string;
}

function mark(
  actor: string,
  target: string,
  date: string,
  status: "present" | "absent",
  idem = key(),
  group = groupId,
) {
  return as(db.client, actor, async (q) => {
    const { rows } = await q("select * from public.upsert_attendance($1, $2, $3, $4, $5)", [
      group,
      date,
      target,
      status,
      idem,
    ]);
    return rows[0];
  });
}

async function auditFor(attendanceId: string) {
  const { rows } = await db.client.query(
    "select action, actor_id, before_json, after_json from public.audit_events where entity_id = $1 order by created_at",
    [attendanceId],
  );
  return rows;
}

beforeAll(async () => {
  db = await createTestDatabase();
  alice = await createAuthUser(db.client, "alice@example.test", "Alice A");
  dana = await createAuthUser(db.client, "dana@example.test", "Dana D");
  bob = await createAuthUser(db.client, "bob@example.test", "Bob B");
  carol = await createAuthUser(db.client, "carol@example.test", "Carol C");

  groupId = await createGroup(alice, "Sunday Doubles", "Asia/Kolkata");
  await join(alice, groupId, dana);
  await join(alice, groupId, bob);
  await as(db.client, alice, (q) => q("select public.set_member_role($1, $2, 'admin')", [groupId, dana]));
  today = await localToday("Asia/Kolkata");
});

afterAll(async () => {
  await db?.drop();
});

describe("self check-in", () => {
  it("creates the day's session on the first action and records the member as present", async () => {
    const row = await mark(bob, bob, today, "present");
    expect(row).toMatchObject({ user_id: bob, status: "present", recorded_by: bob });

    const sessions = await as(db.client, bob, (q) =>
      q("select local_date::text, created_by from public.sessions where group_id = $1", [groupId]),
    );
    expect(sessions.rows).toEqual([{ local_date: today, created_by: bob }]);

    const audit = await auditFor(row.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "attendance.recorded", actor_id: bob, before_json: null });
    expect(audit[0].after_json).toMatchObject({
      local_date: today,
      user_id: bob,
      status: "present",
      recorded_by: bob,
      late: false,
      on_behalf: false,
    });

    const sessionAudit = await db.client.query(
      "select count(*)::int as n from public.audit_events where action = 'session.created' and group_id = $1",
      [groupId],
    );
    expect(sessionAudit.rows[0].n).toBe(1);
  });

  it("reuses the same session for everyone on that date", async () => {
    await mark(alice, alice, today, "present");
    const { rows } = await db.client.query(
      "select count(*)::int as n from public.sessions where group_id = $1 and local_date = $2",
      [groupId, today],
    );
    expect(rows[0].n).toBe(1);
    await expect(
      db.client.query("insert into public.sessions (group_id, local_date, created_by) values ($1, $2, $3)", [
        groupId,
        today,
        alice,
      ]),
    ).rejects.toThrow(/duplicate key/);
  });

  it("is idempotent and does not audit a no-op", async () => {
    const idem = key();
    const first = await mark(bob, bob, today, "absent", idem);
    const replay = await mark(bob, bob, today, "absent", idem);
    expect(replay.id).toBe(first.id);
    const same = await mark(bob, bob, today, "absent");
    expect(same.status).toBe("absent");

    const audit = await auditFor(first.id);
    expect(audit.map((a) => a.after_json.status)).toEqual(["present", "absent"]);
    expect(audit[1].before_json).toMatchObject({ status: "present", recorded_by: bob });
  });

  it("survives a fresh read, as after a refresh or re-login", async () => {
    const { rows } = await as(db.client, bob, (q) =>
      q(
        `select a.status from public.attendance a join public.sessions s on s.id = a.session_id
         where s.group_id = $1 and s.local_date = $2 and a.user_id = $3`,
        [groupId, today, bob],
      ),
    );
    expect(rows).toEqual([{ status: "absent" }]);
  });
});

describe("membership access", () => {
  it("rejects outsiders and anonymous callers", async () => {
    await expect(mark(carol, carol, today, "present")).rejects.toThrow(/forbidden/);
    await expect(
      as(db.client, null, (q) =>
        q("select public.upsert_attendance($1, $2, $3, 'present', $4)", [groupId, today, carol, key()]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("hides sessions and attendance from outsiders", async () => {
    for (const table of ["sessions", "attendance"]) {
      const { rows } = await as(db.client, carol, (q) => q(`select * from public.${table}`));
      expect(rows).toHaveLength(0);
    }
    const { rows } = await as(db.client, carol, (q) => q("select public.group_local_today($1) as d", [groupId]));
    expect(rows[0].d).toBeNull();
  });

  it("does not let a member mark someone else", async () => {
    await expect(mark(bob, alice, today, "absent")).rejects.toThrow(/forbidden/);
  });

  it("only records attendance for active members", async () => {
    await expect(mark(alice, carol, today, "present")).rejects.toThrow(/member_not_found/);
  });

  it("does not allow direct writes to sessions or attendance", async () => {
    await expect(
      as(db.client, bob, (q) =>
        q("update public.attendance set status = 'present' where user_id = $1", [bob]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(db.client, bob, (q) =>
        q("insert into public.sessions (group_id, local_date, created_by) values ($1, '2020-01-01', $2)", [
          groupId,
          bob,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("backdate window", () => {
  it("lets a member backdate their own attendance up to backdate_days", async () => {
    const edge = await localToday("Asia/Kolkata", -14);
    const row = await mark(bob, bob, edge, "present");
    const audit = await auditFor(row.id);
    expect(audit[0].after_json).toMatchObject({ late: true, on_behalf: false, local_date: edge });
  });

  it("rejects older dates for members", async () => {
    const tooOld = await localToday("Asia/Kolkata", -15);
    await expect(mark(bob, bob, tooOld, "present")).rejects.toThrow(/outside_backdate_window/);
  });

  it("rejects future dates for everyone", async () => {
    const tomorrow = await localToday("Asia/Kolkata", 1);
    await expect(mark(bob, bob, tomorrow, "present")).rejects.toThrow(/future_date/);
    await expect(mark(alice, bob, tomorrow, "present")).rejects.toThrow(/future_date/);
  });
});

describe("admin override", () => {
  it("lets an admin correct a member's historic record, with who and when", async () => {
    const old = await localToday("Asia/Kolkata", -30);
    const row = await mark(dana, bob, old, "present");
    expect(row).toMatchObject({ user_id: bob, recorded_by: dana });

    const seen = await as(db.client, bob, (q) =>
      q("select recorded_by, recorded_at from public.attendance where id = $1", [row.id]),
    );
    expect(seen.rows[0].recorded_by).toBe(dana);
    expect(seen.rows[0].recorded_at).toBeInstanceOf(Date);

    const audit = await auditFor(row.id);
    expect(audit[0]).toMatchObject({ actor_id: dana });
    expect(audit[0].after_json).toMatchObject({ late: true, on_behalf: true, recorded_by: dana });

    const visible = await as(db.client, bob, (q) =>
      q("select count(*)::int as n from public.audit_events where entity_id = $1", [row.id]),
    );
    expect(visible.rows[0].n).toBe(1);
  });

  it("but members still cannot change that old record themselves", async () => {
    const old = await localToday("Asia/Kolkata", -30);
    await expect(mark(bob, bob, old, "absent")).rejects.toThrow(/outside_backdate_window/);
  });
});

describe("timezone boundaries", () => {
  // Kiritimati is UTC+14 and Pago Pago UTC-11, so their calendar dates always differ.
  let ahead: string;
  let behind: string;

  beforeAll(async () => {
    ahead = await createGroup(alice, "Ahead", "Pacific/Kiritimati", 0);
    behind = await createGroup(alice, "Behind", "Pacific/Pago_Pago", 0);
    await join(alice, ahead, bob);
    await join(alice, behind, bob);
  });

  it("uses each group's own local date for 'today'", async () => {
    const { rows } = await as(db.client, bob, (q) =>
      q("select public.group_local_today($1)::text as a, public.group_local_today($2)::text as b", [ahead, behind]),
    );
    expect(rows[0].a).toBe(await localToday("Pacific/Kiritimati"));
    expect(rows[0].b).toBe(await localToday("Pacific/Pago_Pago"));
    expect(rows[0].a > rows[0].b).toBe(true);
  });

  it("treats the ahead group's today as the future for the behind group", async () => {
    const aheadToday = await localToday("Pacific/Kiritimati");
    await mark(bob, bob, aheadToday, "present", key(), ahead);
    await expect(mark(bob, bob, aheadToday, "present", key(), behind)).rejects.toThrow(/future_date/);
  });

  it("treats the behind group's today as the past for the ahead group", async () => {
    const behindToday = await localToday("Pacific/Pago_Pago");
    await mark(bob, bob, behindToday, "present", key(), behind);
    await expect(mark(bob, bob, behindToday, "present", key(), ahead)).rejects.toThrow(
      /outside_backdate_window/,
    );
  });
});
