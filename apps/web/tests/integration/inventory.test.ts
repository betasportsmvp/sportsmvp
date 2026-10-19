import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createAuthUser, createTestDatabase, type TestDb } from "./db";

// Phase 2: items, purchases, FIFO lots, adjustments, reversals, receipts and the ledger.

let db: TestDb;
let alice: string; // owner
let bob: string; // member
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

function purchase(
  actor: string,
  opts: { purchaser?: string; quantity: number; total: number; on?: string; receipt?: string | null; idem?: string },
) {
  return as(db.client, actor, async (q) => {
    const { rows } = await q(
      "select public.record_purchase($1, $2, $3, $4, $5, $6, 'note', $7, $8) as id",
      [groupId, balls, opts.purchaser ?? actor, opts.quantity, opts.total, opts.on ?? today, opts.receipt ?? null, opts.idem ?? key()],
    );
    return rows[0].id as string;
  });
}

function adjust(actor: string, delta: number, reason = "Counted the bag") {
  return as(db.client, actor, (q) =>
    q("select public.adjust_inventory($1, $2, $3, $4, $5)", [groupId, balls, delta, reason, key()]),
  );
}

async function onHand(viewer = alice) {
  const { rows } = await as(db.client, viewer, (q) =>
    q("select on_hand from public.item_stock where item_id = $1", [balls]),
  );
  return rows[0]?.on_hand as number | undefined;
}

async function lotsRemaining() {
  const { rows } = await db.client.query(
    "select coalesce(sum(remaining_quantity), 0)::int as n from public.inventory_lots where item_id = $1",
    [balls],
  );
  return rows[0].n as number;
}

beforeAll(async () => {
  db = await createTestDatabase();
  alice = await createAuthUser(db.client, "alice@example.test", "Alice A");
  bob = await createAuthUser(db.client, "bob@example.test", "Bob B");
  carol = await createAuthUser(db.client, "carol@example.test", "Carol C");

  groupId = await as(db.client, alice, async (q) => {
    const { rows } = await q("select public.create_group('Club', 'tennis', 'Asia/Kolkata', 'INR', $1) as id", [key()]);
    return rows[0].id as string;
  });
  const token = await as(db.client, alice, async (q) => {
    const { rows } = await q("select token from public.create_invite($1)", [groupId]);
    return rows[0].token as string;
  });
  await as(db.client, bob, (q) => q("select public.join_group_from_invite($1, $2)", [token, key()]));
  today = await daysAgo(0);
});

afterAll(async () => {
  await db?.drop();
});

describe("items", () => {
  it("seeds every new group with tennis balls in cans", async () => {
    const { rows } = await as(db.client, bob, (q) =>
      q("select id, name, unit, reorder_threshold from public.items where group_id = $1", [groupId]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Tennis balls", unit: "can", reorder_threshold: 2 });
    balls = rows[0].id;
    expect(await onHand()).toBe(0);
  });

  it("lets admins add generic items but not members", async () => {
    await expect(
      as(db.client, bob, (q) => q("select public.create_item($1, 'Grips', 'pack')", [groupId])),
    ).rejects.toThrow(/forbidden/);
    await as(db.client, alice, (q) => q("select public.create_item($1, 'Shuttlecocks', 'tube', 1)", [groupId]));
    await expect(
      as(db.client, alice, (q) => q("select public.create_item($1, ' tennis BALLS ', 'ball')", [groupId])),
    ).rejects.toThrow(/item_exists/);
  });
});

describe("purchases", () => {
  it("posts two purchases at different unit costs and explains the total", async () => {
    // 4 cans for ₹1,200.00 (₹300 a can), then 3 cans for ₹1,050.00 (₹350 a can).
    await purchase(bob, { quantity: 4, total: 120000, on: await daysAgo(3) });
    await purchase(alice, { quantity: 3, total: 105000 });
    expect(await onHand(bob)).toBe(7);

    const lots = await as(db.client, bob, (q) =>
      q(
        "select received_quantity, remaining_quantity, total_cost_minor::int as cost from public.inventory_lots where item_id = $1 order by received_on",
        [balls],
      ),
    );
    expect(lots.rows).toEqual([
      { received_quantity: 4, remaining_quantity: 4, cost: 120000 },
      { received_quantity: 3, remaining_quantity: 3, cost: 105000 },
    ]);

    const ledger = await as(db.client, bob, (q) =>
      q("select kind, quantity from public.inventory_movements where item_id = $1 order by occurred_on", [balls]),
    );
    expect(ledger.rows).toEqual([
      { kind: "purchase", quantity: 4 },
      { kind: "purchase", quantity: 3 },
    ]);

    const audit = await db.client.query(
      "select count(*)::int as n from public.audit_events where action = 'purchase.posted' and group_id = $1",
      [groupId],
    );
    expect(audit.rows[0].n).toBe(2);
  });

  it("does not duplicate a purchase on a repeated request", async () => {
    const idem = key();
    const first = await purchase(bob, { quantity: 1, total: 30000, idem });
    const again = await purchase(bob, { quantity: 1, total: 30000, idem });
    expect(again).toBe(first);
    expect(await onHand()).toBe(8);
  });

  it("lets admins record for another member, but members only for themselves", async () => {
    await expect(purchase(bob, { purchaser: alice, quantity: 1, total: 100 })).rejects.toThrow(/forbidden/);
    const id = await purchase(alice, { purchaser: bob, quantity: 1, total: 30000 });
    const { rows } = await db.client.query("select purchaser_id, recorded_by from public.purchases where id = $1", [id]);
    expect(rows[0]).toEqual({ purchaser_id: bob, recorded_by: alice });
  });

  it("validates quantity, amount, date and purchaser", async () => {
    await expect(purchase(bob, { quantity: 0, total: 100 })).rejects.toThrow(/invalid_purchase/);
    await expect(purchase(bob, { quantity: 1, total: 0 })).rejects.toThrow(/invalid_purchase/);
    const tomorrow = await daysAgo(-1);
    await expect(purchase(bob, { quantity: 1, total: 100, on: tomorrow })).rejects.toThrow(/future_date/);
    await expect(purchase(alice, { purchaser: carol, quantity: 1, total: 100 })).rejects.toThrow(/member_not_found/);
  });

  it("only accepts receipts stored under the group's own folder", async () => {
    await expect(
      purchase(bob, { quantity: 1, total: 100, receipt: "00000000-0000-4000-8000-000000000000/x.jpg" }),
    ).rejects.toThrow(/invalid_receipt/);
    await expect(
      purchase(bob, { quantity: 1, total: 100, receipt: `${groupId}/../other/x.jpg` }),
    ).rejects.toThrow(/invalid_receipt/);
  });
});

describe("adjustments and reversals", () => {
  it("requires an admin and a reason", async () => {
    await expect(adjust(bob, -1)).rejects.toThrow(/forbidden/);
    await expect(adjust(alice, -1, "  ")).rejects.toThrow(/reason_required/);
  });

  it("removes stock from the oldest lot first and never below zero", async () => {
    const before = await onHand();
    await adjust(alice, -5, "Five cans went flat");
    expect(await onHand()).toBe(before! - 5);

    const oldest = await db.client.query(
      "select remaining_quantity from public.inventory_lots where item_id = $1 order by received_on, created_at limit 2",
      [balls],
    );
    expect(oldest.rows.map((r) => r.remaining_quantity)).toEqual([0, 2]);

    await expect(adjust(alice, -100)).rejects.toThrow(/insufficient_stock/);
  });

  it("adds found stock as a zero-cost lot", async () => {
    const before = await onHand();
    await adjust(alice, 2, "Found two cans in the shed");
    expect(await onHand()).toBe(before! + 2);
    const { rows } = await db.client.query(
      "select total_cost_minor::int as cost from public.inventory_lots where item_id = $1 and purchase_id is null",
      [balls],
    );
    expect(rows).toEqual([{ cost: 0 }]);
  });

  it("reverses an untouched purchase, visibly, but not one that has been used", async () => {
    const id = await purchase(bob, { quantity: 2, total: 70000 });
    const before = await onHand();
    await expect(as(db.client, bob, (q) => q("select public.reverse_purchase($1, 'oops')", [id]))).rejects.toThrow(
      /forbidden/,
    );
    await as(db.client, alice, (q) => q("select public.reverse_purchase($1, 'Entered twice')", [id]));
    await as(db.client, alice, (q) => q("select public.reverse_purchase($1, 'Entered twice')", [id]));
    expect(await onHand()).toBe(before! - 2);

    const { rows } = await as(db.client, bob, (q) =>
      q("select status, reversal_reason from public.purchases where id = $1", [id]),
    );
    expect(rows[0]).toEqual({ status: "reversed", reversal_reason: "Entered twice" });

    const used = await db.client.query(
      "select purchase_id from public.inventory_lots where purchase_id is not null and remaining_quantity < received_quantity limit 1",
    );
    await expect(
      as(db.client, alice, (q) => q("select public.reverse_purchase($1, 'nope')", [used.rows[0].purchase_id])),
    ).rejects.toThrow(/purchase_already_used/);
  });

  it("keeps stock equal to the sum of movements and of lots", async () => {
    const { rows } = await db.client.query(
      "select coalesce(sum(quantity), 0)::int as n from public.inventory_movements where item_id = $1",
      [balls],
    );
    expect(await onHand()).toBe(rows[0].n);
    expect(await lotsRemaining()).toBe(rows[0].n);
  });

  it("never lets anyone edit stock or the ledger directly", async () => {
    await expect(
      as(db.client, alice, (q) => q("update public.inventory_lots set remaining_quantity = 99")),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(db.client, alice, (q) =>
        q("insert into public.purchases (group_id, item_id, purchaser_id, quantity, total_minor, purchased_on, recorded_by) values ($1, $2, $3, 1, 1, current_date, $3)", [groupId, balls, alice]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(db.client.query("delete from public.inventory_movements")).rejects.toThrow(
      /inventory_ledger_append_only/,
    );
  });
});

describe("outsiders", () => {
  it("cannot see items, stock, purchases, lots or the ledger", async () => {
    for (const table of ["items", "item_stock", "purchases", "inventory_lots", "inventory_movements"]) {
      const { rows } = await as(db.client, carol, (q) => q(`select * from public.${table}`));
      expect(rows).toHaveLength(0);
    }
    await expect(
      as(db.client, carol, (q) =>
        q("select public.record_purchase($1, $2, $3, 1, 100, current_date, null, null, $4)", [groupId, balls, carol, key()]),
      ),
    ).rejects.toThrow(/forbidden/);
  });

  it("cannot read or upload receipts, while members can", async () => {
    const path = `${groupId}/receipt-1.jpg`;
    await as(db.client, bob, (q) =>
      q("insert into storage.objects (bucket_id, name, owner) values ('receipts', $1, $2)", [path, bob]),
    );
    const seen = await as(db.client, alice, (q) => q("select name from storage.objects where bucket_id = 'receipts'"));
    expect(seen.rows).toEqual([{ name: path }]);

    const hidden = await as(db.client, carol, (q) => q("select name from storage.objects"));
    expect(hidden.rows).toHaveLength(0);
    await expect(
      as(db.client, carol, (q) =>
        q("insert into storage.objects (bucket_id, name, owner) values ('receipts', $1, $2)", [
          `${groupId}/sneaky.jpg`,
          carol,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      as(db.client, bob, (q) =>
        q("insert into storage.objects (bucket_id, name, owner) values ('receipts', 'not-a-group/x.jpg', $1)", [bob]),
      ),
    ).rejects.toThrow(/row-level security/);

    const bucket = await db.client.query("select public from storage.buckets where id = 'receipts'");
    expect(bucket.rows[0].public).toBe(false);
  });
});
