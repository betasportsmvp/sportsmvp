import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createTestDatabase, type TestDb } from "./db";

// Phase 4: balances, the collection-hub plan and payment records, run on the seeded demo
// group (Asha, Vikram, Neha and Rohan).

let db: TestDb;

const group = "00000000-0000-4000-8000-0000000000d1";
const asha = "00000000-0000-4000-8000-00000000a5a0";
const vikram = "00000000-0000-4000-8000-00000000b1c0";
const neha = "00000000-0000-4000-8000-00000000e0a0";
const rohan = "00000000-0000-4000-8000-00000000f0a0";
const carol = "00000000-0000-4000-8000-00000000ca01";
const name: Record<string, string> = { [asha]: "Asha", [vikram]: "Vikram", [neha]: "Neha", [rohan]: "Rohan" };

const key = () => `key-${crypto.randomUUID()}`;

async function daysAgo(n: number) {
  const { rows } = await db.client.query(
    "select ((now() at time zone 'Asia/Kolkata')::date - $1::int)::text as d",
    [n],
  );
  return rows[0].d as string;
}

/** Net balances in rupees, by name. */
async function balances(viewer = vikram, from: string | null = null, to: string | null = null) {
  const { rows } = await as(db.client, viewer, (q) =>
    q("select user_id, net_minor::int as net from public.group_balances($1, $2, $3)", [group, from, to]),
  );
  return Object.fromEntries(rows.map((r) => [name[r.user_id], r.net / 100]));
}

/** The plan as "Payer -> Payee amount" lines, in rupees. */
async function plan(viewer = vikram, opts: { from?: string; lead?: string } = {}) {
  const { rows } = await as(db.client, viewer, (q) =>
    q("select payer_id, payee_id, amount_minor::int as amount from public.calculate_settlement($1, $2, null, $3)", [
      group,
      opts.from ?? null,
      opts.lead ?? null,
    ]),
  );
  return rows.map((r) => `${name[r.payer_id]} -> ${name[r.payee_id]} ${r.amount / 100}`);
}

function pay(actor: string, payer: string, payee: string, rupees: number, opts: { confirmed?: boolean; idem?: string; on?: string } = {}) {
  return as(db.client, actor, async (q) => {
    const { rows } = await q("select public.record_payment($1, $2, $3, $4, $5, 'UPI', $6, $7) as id", [
      group,
      payer,
      payee,
      rupees * 100,
      opts.on ?? (await daysAgo(0)),
      opts.confirmed ?? true,
      opts.idem ?? key(),
    ]);
    return rows[0].id as string;
  });
}

function reversePayment(actor: string, id: string, reason = "Entered the wrong amount") {
  return as(db.client, actor, (q) => q("select public.reverse_payment($1, $2)", [id, reason]));
}

beforeAll(async () => {
  db = await createTestDatabase({ seed: true });
});

afterAll(async () => {
  await db?.drop();
});

describe("seeded demo scenario", () => {
  it("reconciles to the expected balances", async () => {
    expect(await balances()).toEqual({ Asha: 800, Vikram: -100, Neha: -400, Rohan: 200 });
  });

  it("suggests every debtor pays the largest creditor, who pays the other creditors", async () => {
    expect(await plan()).toEqual(["Neha -> Asha 400", "Vikram -> Asha 100", "Asha -> Rohan 200"]);
  });

  it("shows each balance's inputs", async () => {
    const { rows } = await as(db.client, neha, (q) =>
      q(
        `select purchases_minor::int as bought, allocations_minor::int as used,
                payments_sent_minor::int as sent, payments_received_minor::int as received
         from public.group_balances($1) where user_id = $2`,
        [group, asha],
      ),
    );
    expect(rows[0]).toEqual({ bought: 120000, used: 40000, sent: 0, received: 0 });
  });
});

describe("payments", () => {
  it("counts a partial payment and leaves the rest suggested", async () => {
    const id = await pay(vikram, vikram, asha, 50);
    expect(await balances()).toEqual({ Asha: 750, Vikram: -50, Neha: -400, Rohan: 200 });
    expect(await plan()).toEqual(["Neha -> Asha 400", "Vikram -> Asha 50", "Asha -> Rohan 200"]);
    await reversePayment(vikram, id);
  });

  it("recalculates after a payment is reversed, keeping the original on record", async () => {
    const id = await pay(asha, neha, asha, 400);
    expect((await balances()).Neha).toBe(0);

    await expect(reversePayment(rohan, id)).rejects.toThrow("forbidden");
    await expect(reversePayment(asha, id, " ")).rejects.toThrow("reason_required");
    await reversePayment(asha, id);
    expect(await balances()).toEqual({ Asha: 800, Vikram: -100, Neha: -400, Rohan: 200 });

    const { rows } = await db.client.query("select status, reversal_reason from public.payments where id = $1", [id]);
    expect(rows[0]).toEqual({ status: "reversed", reversal_reason: "Entered the wrong amount" });
    const audit = await db.client.query(
      "select action from public.audit_events where entity_id = $1 order by created_at",
      [id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(["payment.recorded", "payment.reversed"]);
  });

  it("settles everyone to zero once the suggested payments are recorded", async () => {
    const ids = [await pay(vikram, vikram, asha, 100), await pay(neha, neha, asha, 400), await pay(asha, asha, rohan, 200)];
    expect(await balances()).toEqual({ Asha: 500, Vikram: 0, Neha: 0, Rohan: 0 });
    // Asha keeps the remaining credit: balls bought but not used yet.
    expect(await plan()).toEqual([]);
    for (const id of ids) await reversePayment(asha, id, "Undo for the next test");
  });

  it("requires explicit confirmation and valid details, and is safe to retry", async () => {
    await expect(pay(vikram, vikram, asha, 10, { confirmed: false })).rejects.toThrow("confirmation_required");
    await expect(pay(vikram, vikram, vikram, 10)).rejects.toThrow("invalid_payment");
    await expect(pay(vikram, vikram, asha, 0)).rejects.toThrow("invalid_payment");
    await expect(pay(vikram, vikram, asha, 10, { on: await daysAgo(-1) })).rejects.toThrow("future_date");

    const idem = key();
    const first = await pay(vikram, vikram, asha, 10, { idem });
    expect(await pay(vikram, vikram, asha, 10, { idem })).toBe(first);
    expect((await balances()).Vikram).toBe(-90);
    await reversePayment(vikram, first);
  });

  it("never lets a payment be edited or deleted", async () => {
    const id = await pay(vikram, vikram, asha, 10);
    await expect(db.client.query("update public.payments set amount_minor = 1 where id = $1", [id])).rejects.toThrow(
      "payments_append_only",
    );
    await expect(db.client.query("delete from public.payments where id = $1", [id])).rejects.toThrow(
      "payments_append_only",
    );
    await reversePayment(vikram, id);
    await expect(
      db.client.query("update public.payments set status = 'confirmed' where id = $1", [id]),
    ).rejects.toThrow("payments_append_only");
  });
});

describe("access", () => {
  it("keeps non-members out", async () => {
    await expect(balances(carol)).rejects.toThrow("forbidden");
    await expect(plan(carol)).rejects.toThrow("forbidden");
    await expect(pay(carol, carol, asha, 10)).rejects.toThrow("forbidden");
    await expect(pay(asha, carol, asha, 10)).rejects.toThrow("member_not_found");
    const { rows } = await as(db.client, carol, (q) => q("select count(*)::int as n from public.payments"));
    expect(rows[0].n).toBe(0);
  });

  it("lets members record only payments they sent or received", async () => {
    await expect(pay(rohan, vikram, asha, 10)).rejects.toThrow("forbidden");
    const id = await pay(asha, vikram, neha, 10);
    await reversePayment(asha, id);
  });

  it("allows no direct writes", async () => {
    await expect(
      as(db.client, asha, (q) =>
        q("insert into public.payments (group_id, payer_id, payee_id, amount_minor, paid_on, recorded_by) values ($1, $2, $3, 1, now(), $2)", [
          group,
          asha,
          rohan,
        ]),
      ),
    ).rejects.toThrow("permission denied");
    await expect(
      as(db.client, null, (q) => q("select * from public.group_balances($1)", [group])),
    ).rejects.toThrow("permission denied");
  });
});

describe("settlement lead and periods", () => {
  it("lets an admin nominate a different lead, who then pays the top creditor", async () => {
    await expect(
      as(db.client, vikram, (q) => q("select public.set_settlement_lead($1, $2)", [group, rohan])),
    ).rejects.toThrow("forbidden");
    await as(db.client, asha, (q) => q("select public.set_settlement_lead($1, $2)", [group, rohan]));
    expect(await plan()).toEqual(["Neha -> Rohan 400", "Vikram -> Rohan 100", "Rohan -> Asha 800"]);

    // A what-if lead for one view, without changing the group's choice.
    expect(await plan(vikram, { lead: neha })).toEqual(["Vikram -> Neha 100", "Neha -> Asha 800", "Neha -> Rohan 200"]);

    await as(db.client, asha, (q) => q("select public.set_settlement_lead($1, null)", [group]));
    expect((await plan())[0]).toBe("Neha -> Asha 400");
  });

  it("filters by period and suggests nothing when nobody is owed", async () => {
    // From four days ago only the second session's costs count; the purchases are earlier.
    const from = await daysAgo(4);
    expect(await balances(vikram, from)).toEqual({ Asha: -300, Vikram: 0, Neha: -300, Rohan: -300 });
    expect(await plan(vikram, { from })).toEqual([]);
  });

  it("follows corrections to ball use", async () => {
    const { rows } = await db.client.query(
      `select c.id from public.consumptions c join public.sessions s on s.id = c.session_id
       where c.group_id = $1 order by s.local_date limit 1`,
      [group],
    );
    await as(db.client, asha, (q) => q("select public.reverse_consumption($1, 'Wrong day')", [rows[0].id]));
    // The first session's 400 is no longer charged; Asha's and Rohan's purchases still count.
    expect(await balances()).toEqual({ Asha: 900, Vikram: 0, Neha: -300, Rohan: 300 });
    expect(await plan()).toEqual(["Neha -> Asha 300", "Asha -> Rohan 300"]);
  });
});
