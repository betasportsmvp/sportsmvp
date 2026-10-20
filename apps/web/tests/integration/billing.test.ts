import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { featuresFor } from "@/lib/plans";
import { as, createAuthUser, createTestDatabase, type TestDb } from "./db";

// Phase 5 plans: beta access, subscriptions from the fake provider's webhook events, feature
// gates, and the Free member limit. Nothing here takes a payment.

let db: TestDb;
let owner: string;
let other: string;
let groupA: string;
let groupB: string;

const key = () => `key-${crypto.randomUUID()}`;
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

async function plan(user: string, group: string) {
  const { rows } = await as(db.client, user, (q) =>
    q("select tier::text, source, plan_code, status::text from public.group_plan($1)", [group]),
  );
  return rows[0];
}

function entitled(user: string, group: string, feature: string) {
  return as(db.client, user, async (q) => {
    const { rows } = await q("select public.group_has_entitlement($1, $2) as ok", [group, feature]);
    return rows[0].ok as boolean;
  });
}

/** Delivers a normalised event as the webhook handler would, with the service role. */
async function deliver(eventId: string, type: string, data: Record<string, unknown>) {
  await db.client.query("begin");
  try {
    await db.client.query("set local role service_role");
    const { rows } = await db.client.query("select public.apply_billing_event('fake', $1, $2, $3) as outcome", [
      eventId,
      type,
      data,
    ]);
    await db.client.query("commit");
    return rows[0].outcome as string;
  } catch (error) {
    await db.client.query("rollback");
    throw error;
  }
}

async function endBeta() {
  await db.client.query("update public.entitlement_overrides set ends_at = now() where group_id is null");
}

beforeAll(async () => {
  db = await createTestDatabase();
  owner = await createAuthUser(db.client, "owner@example.test", "Olive Owner");
  other = await createAuthUser(db.client, "other@example.test", "Oscar Other");
  const create = (user: string, name: string) =>
    as(db.client, user, async (q) => {
      const { rows } = await q("select public.create_group($1, 'tennis', 'Asia/Kolkata', 'INR', $2) as id", [name, key()]);
      return rows[0].id as string;
    });
  groupA = await create(owner, "Group A");
  groupB = await create(other, "Group B");
});

afterAll(async () => {
  await db?.drop();
});

describe("feature matrix", () => {
  it("matches the app's copy", async () => {
    const { rows } = await db.client.query(
      "select public.plan_features('free') as free, public.plan_features('pro') as pro",
    );
    expect(rows[0].free).toEqual(featuresFor("free"));
    expect(rows[0].pro).toEqual(featuresFor("pro"));
  });

  it("lists the beta prices, none of them for sale", async () => {
    const { rows } = await as(db.client, owner, (q) =>
      q("select code, price_minor::int as price, purchasable from public.plans order by sort_order"),
    );
    expect(rows).toEqual([
      { code: "free", price: 0, purchasable: false },
      { code: "pro_monthly", price: 29900, purchasable: false },
      { code: "pro_annual", price: 249900, purchasable: false },
      { code: "founding_pass", price: 499900, purchasable: false },
    ]);
  });
});

describe("during the beta", () => {
  it("gives every group Pro through the beta override", async () => {
    expect(await plan(owner, groupA)).toEqual({ tier: "pro", source: "override", plan_code: null, status: null });
    expect(await entitled(other, groupB, "settlement_periods")).toBe(true);
  });

  it("keeps plans private to each group", async () => {
    await expect(plan(other, groupA)).rejects.toThrow("forbidden");
    await expect(entitled(other, groupA, "settlement")).rejects.toThrow("forbidden");
  });
});

describe("after the beta", () => {
  beforeAll(endBeta);

  it("falls back to Free, keeping financial history", async () => {
    expect(await plan(owner, groupA)).toEqual({ tier: "free", source: "free", plan_code: "free", status: null });
    expect(await entitled(owner, groupA, "settlement_periods")).toBe(false);
    expect(await entitled(owner, groupA, "financial_history")).toBe(true);
    await as(db.client, owner, (q) => q("select * from public.group_balances($1)", [groupA]));
  });

  it("turns Pro on for one group only when a subscription starts", async () => {
    const outcome = await deliver("evt_1", "subscription.activated", {
      group_id: groupA,
      plan_code: "pro_monthly",
      customer_id: "cus_1",
      subscription_id: "sub_1",
      current_period_end: inDays(30),
    });
    expect(outcome).toBe("processed");
    expect(await plan(owner, groupA)).toEqual({ tier: "pro", source: "subscription", plan_code: "pro_monthly", status: "active" });
    expect((await plan(other, groupB)).tier).toBe("free");

    const { rows } = await as(db.client, other, (q) => q("select count(*)::int as n from public.subscriptions"));
    expect(rows[0].n).toBe(0);
  });

  it("ignores a repeated webhook event", async () => {
    const again = await deliver("evt_1", "subscription.activated", {
      group_id: groupA,
      plan_code: "pro_monthly",
      customer_id: "cus_1",
      subscription_id: "sub_1",
      current_period_end: inDays(30),
    });
    expect(again).toBe("duplicate");
    const { rows } = await db.client.query(
      "select (select count(*)::int from public.subscriptions) as subs, (select count(*)::int from public.billing_events) as events",
    );
    expect(rows[0]).toEqual({ subs: 1, events: 1 });
  });

  it("keeps Pro until the end of a cancelled period, then expires", async () => {
    expect(await deliver("evt_2", "subscription.canceled", { subscription_id: "sub_1" })).toBe("processed");
    expect(await plan(owner, groupA)).toMatchObject({ tier: "pro", status: "canceled" });

    await db.client.query("update public.subscriptions set current_period_end = now() - interval '1 minute'");
    expect((await plan(owner, groupA)).tier).toBe("free");
    expect(await entitled(owner, groupA, "settlement_periods")).toBe(false);
  });

  it("renews, then drops to Free on expiry or refund", async () => {
    expect(await deliver("evt_3", "subscription.renewed", { subscription_id: "sub_1", current_period_end: inDays(30) })).toBe(
      "processed",
    );
    expect(await plan(owner, groupA)).toMatchObject({ tier: "pro", status: "active" });
    await deliver("evt_4", "subscription.expired", { subscription_id: "sub_1" });
    expect((await plan(owner, groupA)).tier).toBe("free");

    await deliver("evt_5", "subscription.activated", {
      group_id: groupA,
      plan_code: "founding_pass",
      customer_id: "cus_1",
      subscription_id: "pass_1",
    });
    expect(await plan(owner, groupA)).toMatchObject({ tier: "pro", plan_code: "founding_pass" });
    await deliver("evt_6", "subscription.revoked", { subscription_id: "pass_1" });
    expect((await plan(owner, groupA)).tier).toBe("free");
  });

  it("ignores events it can't place", async () => {
    expect(await deliver("evt_7", "subscription.renewed", { subscription_id: "sub_unknown" })).toBe("ignored");
    expect(
      await deliver("evt_8", "subscription.activated", {
        group_id: groupB,
        plan_code: "free",
        customer_id: "cus_2",
        subscription_id: "sub_2",
      }),
    ).toBe("ignored");
    expect((await plan(other, groupB)).tier).toBe("free");
  });

  it("only lets the server's service role apply events", async () => {
    await expect(
      as(db.client, owner, (q) => q("select public.apply_billing_event('fake', 'evt_x', 'subscription.renewed', '{}')")),
    ).rejects.toThrow("permission denied");
    await expect(
      as(db.client, owner, (q) =>
        q("insert into public.entitlement_overrides (group_id, label) values ($1, 'Mine')", [groupA]),
      ),
    ).rejects.toThrow("permission denied");
  });

  it("blocks new members once a Free group has 12, without removing anyone", async () => {
    const { rows } = await as(db.client, owner, (q) => q("select token from public.create_invite($1)", [groupA]));
    const token = rows[0].token as string;
    for (let i = 0; i < 11; i++) {
      const user = await createAuthUser(db.client, `player${i}@example.test`, `Player ${i}`);
      await as(db.client, user, (q) => q("select public.join_group_from_invite($1, $2)", [token, key()]));
    }
    const late = await createAuthUser(db.client, "late@example.test", "Lena Late");
    await expect(
      as(db.client, late, (q) => q("select public.join_group_from_invite($1, $2)", [token, key()])),
    ).rejects.toThrow("member_limit_reached");

    await deliver("evt_9", "subscription.activated", {
      group_id: groupA,
      plan_code: "pro_annual",
      customer_id: "cus_1",
      subscription_id: "sub_3",
      current_period_end: inDays(365),
    });
    await as(db.client, late, (q) => q("select public.join_group_from_invite($1, $2)", [token, key()]));

    // Back on Free with 13 members: everyone stays.
    await deliver("evt_10", "subscription.expired", { subscription_id: "sub_3" });
    const count = await db.client.query(
      "select count(*)::int as n from public.memberships where group_id = $1 and left_at is null",
      [groupA],
    );
    expect(count.rows[0].n).toBe(13);
  });
});
