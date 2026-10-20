import { describe, expect, it } from "vitest";
import { balanceStanding, defaultLead, leadCashflow } from "@/lib/balance";

describe("balanceStanding", () => {
  it("reads positive as owed, negative as owes and zero as square", () => {
    expect(balanceStanding(80000)).toEqual({ kind: "owed", amount: 80000 });
    expect(balanceStanding(-10000)).toEqual({ kind: "owes", amount: 10000 });
    expect(balanceStanding(0)).toEqual({ kind: "square", amount: 0 });
  });
});

describe("defaultLead", () => {
  it("picks the largest net creditor, not the biggest spender", () => {
    expect(
      defaultLead([
        { user_id: "asha", net_minor: 80000 },
        { user_id: "rohan", net_minor: 20000 },
        { user_id: "neha", net_minor: -40000 },
      ]),
    ).toBe("asha");
    expect(defaultLead([{ user_id: "neha", net_minor: -1 }])).toBeNull();
  });
});

describe("leadCashflow", () => {
  it("shows what a nominated lead would have to front", () => {
    const plan = [
      { payer_id: "neha", payee_id: "rohan", amount_minor: 40000 },
      { payer_id: "vikram", payee_id: "rohan", amount_minor: 10000 },
      { payer_id: "rohan", payee_id: "asha", amount_minor: 80000 },
    ];
    expect(leadCashflow(plan, "rohan")).toEqual({ collects: 50000, paysOut: 80000, fronts: 30000 });
  });
});
