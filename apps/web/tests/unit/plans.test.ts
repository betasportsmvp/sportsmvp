import { describe, expect, it } from "vitest";
import { FakeBillingProvider } from "@/lib/billing/fake-provider";
import { handleBillingWebhook } from "@/lib/billing/provider";
import { groupMessage, streakMessage, weeklyMessage } from "@/lib/motivation";
import { featuresFor } from "@/lib/plans";

describe("feature matrix", () => {
  it("keeps every Free feature, financial history included, on Pro", () => {
    expect(featuresFor("free")).toContain("financial_history");
    for (const f of featuresFor("free")) expect(featuresFor("pro")).toContain(f);
    expect(featuresFor("free")).not.toContain("settlement_periods");
  });
});

describe("fake billing provider", () => {
  const provider = new FakeBillingProvider("test-secret");
  const body = JSON.stringify({ id: "evt_1", type: "subscription.renewed", data: { subscription_id: "sub_1" } });

  it("accepts a correctly signed event", () => {
    expect(provider.parseWebhook(body, provider.sign(body))).toEqual({
      provider: "fake",
      eventId: "evt_1",
      type: "subscription.renewed",
      payload: { subscription_id: "sub_1" },
    });
  });

  it("rejects a bad signature or an unknown event", async () => {
    expect(() => provider.parseWebhook(body, "nope")).toThrow("invalid_signature");
    expect(() => provider.parseWebhook(body, null)).toThrow("invalid_signature");
    const odd = JSON.stringify({ id: "evt_2", type: "charge.created", data: { subscription_id: "x" } });
    expect(() => provider.parseWebhook(odd, provider.sign(odd))).toThrow("invalid_event");
    await expect(provider.createCheckout()).rejects.toThrow("checkout_unavailable");
  });

  it("passes each delivery to the database, which reports repeats", async () => {
    const seen = new Set<string>();
    const apply = async (e: { eventId: string }) => (seen.has(e.eventId) ? "duplicate" : (seen.add(e.eventId), "processed")) as
      | "processed"
      | "duplicate";
    expect(await handleBillingWebhook(provider, body, provider.sign(body), apply)).toEqual({ status: 200, outcome: "processed" });
    expect(await handleBillingWebhook(provider, body, provider.sign(body), apply)).toEqual({ status: 200, outcome: "duplicate" });
    expect(await handleBillingWebhook(provider, body, "bad", apply)).toEqual({ status: 400 });
  });
});

describe("motivation copy", () => {
  it("encourages without pressure", () => {
    expect(weeklyMessage(2, 2)).toBe("You played twice this week. Goal reached!");
    expect(weeklyMessage(1, 3)).toBe("You played once this week. 2 more to reach your goal.");
    expect(weeklyMessage(0, 2)).toBe("No games yet this week. Your goal is twice.");
    expect(groupMessage(8, 12)).toBe("Your group is 4 sessions from its goal of 12 this month.");
    expect(groupMessage(11, 12)).toBe("Your group is 1 session from its goal of 12 this month.");
    expect(groupMessage(13, 12)).toBe("Your group reached its goal of 12 sessions this month.");
    expect(streakMessage(1)).toBeNull();
    expect(streakMessage(3)).toBe("3 weeks in a row at your goal.");
  });
});
