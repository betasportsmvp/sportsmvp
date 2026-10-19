import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createAuthUser, createTestDatabase, type TestDb } from "./db";

// Phase 3: recording balls used in a session and splitting their cost among attendees.

let db: TestDb;
let alice: string; // owner
let bob: string; // member
let dan: string; // member
let carol: string; // outsider
let groupId: string;
let balls: string;
let today: string;

const key = () => `key-${crypto.randomUUID()}`;

async function daysAgo(n: number) {
  const { rows } = await db.client.query(
    "select ((now() at time zone 'Asia/Kolkata')::date - $1::int)::text as d",
    [n],
  );
  return rows[0].d as string;
}

function purchase(quantity: number, total: number, on: string) {
  return as(db.client, alice, async (q) => {
    const { rows } = await q(
      "select public.record_purchase($1, $2, $3, $4, $5, $6, null, null, $7) as id",
      [groupId, balls, alice, quantity, total, on, key()],
    );
    return rows[0].id as string;
  });
}

// Each call runs its own transaction on the shared client, so call these one at a time.
function mark(date: string, user: string, status: "present" | "absent") {
  return as(db.client, alice, (q) =>
    q("select public.upsert_attendance($1, $2, $3, $4, $5)", [groupId, date, user, status, key()]),
  );
}

function consume(date: string, quantity: number, opts: { actor?: string; idem?: string } = {}) {
  return as(db.client, opts.actor ?? alice, async (q) => {
    const { rows } = await q(
      "select public.record_consumption_and_allocate($1, $2, $3, $4, 'match play', $5) as id",
      [groupId, date, balls, quantity, opts.idem ?? key()],
    );
    return rows[0].id as string;
  });
}

async function allocations(consumptionId: string, status = "active") {
  const { rows } = await db.client.query(
    `select user_id, amount_minor::int as amount, rounding_minor as rounding from public.cost_allocations
     where consumption_id = $1 and status = $2 order by user_id`,
    [consumptionId, status],
  );
  return rows as { user_id: string; amount: number; rounding: number }[];
}

async function consumption(id: string) {
  const { rows } = await db.client.query(
    "select quantity, total_cost_minor::int as total, status from public.consumptions where id = $1",
    [id],
  );
  return rows[0] as { quantity: number; total: number; status: string };
}

async function onHand() {
  const { rows } = await db.client.query("select on_hand from public.item_stock where item_id = $1", [balls]);
  return rows[0].on_hand as number;
}

async function emptyStock() {
  const n = await onHand();
  if (n > 0) {
    await as(db.client, alice, (q) =>
      q("select public.adjust_inventory($1, $2, $3, 'reset for test', $4)", [groupId, balls, -n, key()]),
    );
  }
}

beforeAll(async () => {
  db = await createTestDatabase();
  alice = await createAuthUser(db.client, "alice@example.test", "Alice A");
  bob = await createAuthUser(db.client, "bob@example.test", "Bob B");
  dan = await createAuthUser(db.client, "dan@example.test", "Dan D");
  carol = await createAuthUser(db.client, "carol@example.test", "Carol C");

  groupId = await as(db.client, alice, async (q) => {
    const { rows } = await q("select public.create_group('Club', 'tennis', 'Asia/Kolkata', 'INR', $1) as id", [key()]);
    return rows[0].id as string;
  });
  const token = await as(db.client, alice, async (q) => {
    const { rows } = await q("select token from public.create_invite($1)", [groupId]);
    return rows[0].token as string;
  });
  for (const u of [bob, dan]) {
    await as(db.client, u, (q) => q("select public.join_group_from_invite($1, $2)", [token, key()]));
  }
  const { rows } = await db.client.query("select id from public.items where group_id = $1", [groupId]);
  balls = rows[0].id;
  today = await daysAgo(0);
});

afterAll(async () => {
  await db?.drop();
});

describe("record_consumption_and_allocate", () => {
  it("takes the oldest lots first and costs each slice from its own lot", async () => {
    const day = await daysAgo(10);
    await purchase(2, 60000, await daysAgo(20)); // ₹300 a can
    await purchase(3, 120000, await daysAgo(15)); // ₹400 a can
    await mark(day, alice, "present");
    await mark(day, bob, "present");

    const id = await consume(day, 3);
    expect(await consumption(id)).toMatchObject({ quantity: 3, total: 60000 + 40000, status: "posted" });

    const { rows: moves } = await db.client.query(
      `select l.total_cost_minor::int as lot_total, m.quantity, m.cost_minor::int as cost
       from public.inventory_movements m join public.inventory_lots l on l.id = m.lot_id
       where m.consumption_id = $1 order by l.received_on`,
      [id],
    );
    expect(moves).toEqual([
      { lot_total: 60000, quantity: -2, cost: 60000 },
      { lot_total: 120000, quantity: -1, cost: 40000 },
    ]);
    expect(await onHand()).toBe(2);

    const split = await allocations(id);
    expect(split.map((s) => s.amount)).toEqual([50000, 50000]);
    await emptyStock();
  });

  it("splits three ways in whole paise, giving the remainder by ascending member id", async () => {
    const day = await daysAgo(9);
    await purchase(1, 10000, day);
    await mark(day, alice, "present");
    await mark(day, bob, "present");
    await mark(day, dan, "present");

    const id = await consume(day, 1);
    const split = await allocations(id);
    const sorted = [alice, bob, dan].sort();
    expect(split.map((s) => s.user_id)).toEqual(sorted);
    expect(split.map((s) => s.amount)).toEqual([3334, 3333, 3333]);
    expect(split.map((s) => s.rounding)).toEqual([1, 0, 0]);
    expect(split.reduce((sum, s) => sum + s.amount, 0)).toBe(10000);
  });

  it("charges a lot exactly what it cost even when used one unit at a time", async () => {
    const day = await daysAgo(8);
    await purchase(3, 10000, day);
    await mark(day, alice, "present");
    const totals = [];
    for (let i = 0; i < 3; i++) totals.push((await consumption(await consume(day, 1))).total);
    expect(totals).toEqual([3333, 3333, 3334]);
  });

  it("excludes absent and unrecorded members", async () => {
    const day = await daysAgo(7);
    await purchase(1, 9000, day);
    await mark(day, alice, "present");
    await mark(day, bob, "absent");
    const split = await allocations(await consume(day, 1));
    expect(split).toEqual([{ user_id: alice, amount: 9000, rounding: 0 }]);
  });

  it("rejects a day with nobody present, and leaves stock alone", async () => {
    const day = await daysAgo(6);
    await purchase(1, 5000, day);
    await expect(consume(day, 1)).rejects.toThrow("no_present_attendees");
    await mark(day, bob, "absent");
    await expect(consume(day, 1)).rejects.toThrow("no_present_attendees");
    expect(await onHand()).toBe(1);
    await emptyStock();
  });

  it("rejects using more than is in stock", async () => {
    const day = await daysAgo(5);
    await purchase(2, 8000, day);
    await mark(day, alice, "present");
    await expect(consume(day, 3)).rejects.toThrow("insufficient_stock");
    expect(await onHand()).toBe(2);
    await emptyStock();
  });

  it("returns the same result when retried with the same key", async () => {
    const day = await daysAgo(4);
    await purchase(2, 8000, day);
    await mark(day, alice, "present");
    const idem = key();
    const first = await consume(day, 1, { idem });
    const second = await consume(day, 1, { idem });
    expect(second).toBe(first);
    expect(await onHand()).toBe(1);
    await emptyStock();
  });

  it("is admin-only, rejects future dates, and writes an audit event", async () => {
    const day = await daysAgo(3);
    await purchase(1, 1000, day);
    await mark(day, bob, "present");
    await expect(consume(day, 1, { actor: bob })).rejects.toThrow("forbidden");
    await expect(consume(day, 1, { actor: carol })).rejects.toThrow("forbidden");
    const tomorrow = await daysAgo(-1);
    await expect(consume(tomorrow, 1)).rejects.toThrow("future_date");

    const id = await consume(day, 1);
    const { rows } = await db.client.query(
      "select after_json from public.audit_events where action = 'consumption.posted' and entity_id = $1",
      [id],
    );
    expect(rows[0].after_json.allocations).toEqual([{ user_id: bob, amount_minor: 1000 }]);
  });
});

describe("corrections", () => {
  it("reverses a consumption: stock returns to its lots and allocations are cancelled", async () => {
    const day = await daysAgo(2);
    await purchase(2, 20000, day);
    await mark(day, alice, "present");
    await mark(day, bob, "present");
    const id = await consume(day, 2);
    expect(await onHand()).toBe(0);

    await expect(
      as(db.client, bob, (q) => q("select public.reverse_consumption($1, 'oops')", [id])),
    ).rejects.toThrow("forbidden");
    await expect(
      as(db.client, alice, (q) => q("select public.reverse_consumption($1, ' ')", [id])),
    ).rejects.toThrow("reason_required");

    await as(db.client, alice, (q) => q("select public.reverse_consumption($1, 'Entered on the wrong day')", [id]));
    expect(await onHand()).toBe(2);
    expect((await consumption(id)).status).toBe("reversed");
    expect(await allocations(id)).toEqual([]);
    expect((await allocations(id, "reversed")).length).toBe(2);

    // The same balls can be used again at the same cost.
    const again = await consume(day, 2);
    expect((await consumption(again)).total).toBe(20000);
  });

  it("re-splits after attendance changes, keeping the old split as reversed", async () => {
    const day = await daysAgo(1);
    await purchase(1, 9000, day);
    await mark(day, alice, "present");
    await mark(day, bob, "present");
    const id = await consume(day, 1);
    expect((await allocations(id)).map((a) => a.amount)).toEqual([4500, 4500]);

    // Attendance changes don't silently rewrite who pays.
    await mark(day, dan, "present");
    expect((await allocations(id)).length).toBe(2);

    await as(db.client, alice, (q) => q("select public.reallocate_consumption($1, 'Dan played too')", [id]));
    expect((await allocations(id)).map((a) => a.amount)).toEqual([3000, 3000, 3000]);
    expect((await allocations(id, "reversed")).length).toBe(2);

    // Running it again with nothing changed is a no-op.
    await as(db.client, alice, (q) => q("select public.reallocate_consumption($1, 'again')", [id]));
    expect((await allocations(id, "reversed")).length).toBe(2);

    // If nobody is present any more, the admin has to reverse the use instead.
    await mark(day, alice, "absent");
    await mark(day, bob, "absent");
    await mark(day, dan, "absent");
    await expect(
      as(db.client, alice, (q) => q("select public.reallocate_consumption($1, 'rained off')", [id])),
    ).rejects.toThrow("no_present_attendees");
    expect((await allocations(id)).length).toBe(3);
  });

  it("never lets allocations be edited or deleted", async () => {
    const { rows } = await db.client.query("select id from public.cost_allocations where status = 'active' limit 1");
    await expect(
      db.client.query("update public.cost_allocations set amount_minor = 1 where id = $1", [rows[0].id]),
    ).rejects.toThrow("allocations_append_only");
    await expect(db.client.query("delete from public.cost_allocations where id = $1", [rows[0].id])).rejects.toThrow(
      "allocations_append_only",
    );
  });
});

describe("access", () => {
  it("lets members read consumptions and allocations, and nobody write them directly", async () => {
    const { rows } = await as(db.client, bob, (q) =>
      q("select count(*)::int as n from public.cost_allocations where group_id = $1", [groupId]),
    );
    expect(rows[0].n).toBeGreaterThan(0);
    const outsider = await as(db.client, carol, (q) =>
      q(
        `select (select count(*) from public.cost_allocations)::int as a,
                (select count(*) from public.consumptions)::int as c`,
      ),
    );
    expect(outsider.rows[0]).toEqual({ a: 0, c: 0 });

    await expect(
      as(db.client, alice, (q) => q("update public.cost_allocations set amount_minor = 0")),
    ).rejects.toThrow("permission denied");
    await expect(
      as(db.client, alice, (q) =>
        q("insert into public.consumptions (group_id, session_id, item_id, quantity, recorded_by) values ($1, $1, $1, 1, $2)", [
          groupId,
          alice,
        ]),
      ),
    ).rejects.toThrow("permission denied");
    await expect(
      as(db.client, null, (q) =>
        q("select public.record_consumption_and_allocate($1, $2, $3, 1, null, $4)", [groupId, today, balls, key()]),
      ),
    ).rejects.toThrow("permission denied");
  });
});
