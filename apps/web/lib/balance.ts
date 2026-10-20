/** How a net balance reads to a person. Positive: the group owes them. */
export function balanceStanding(netMinor: number): { kind: "owed" | "owes" | "square"; amount: number } {
  if (netMinor > 0) return { kind: "owed", amount: netMinor };
  if (netMinor < 0) return { kind: "owes", amount: -netMinor };
  return { kind: "square", amount: 0 };
}

export type PlanRow = { payer_id: string; payee_id: string; amount_minor: number };

/** What the Settlement Lead collects and pays out under a plan, and any shortfall they front. */
export function leadCashflow(plan: PlanRow[], leadId: string) {
  const collects = plan.filter((r) => r.payee_id === leadId).reduce((sum, r) => sum + r.amount_minor, 0);
  const paysOut = plan.filter((r) => r.payer_id === leadId).reduce((sum, r) => sum + r.amount_minor, 0);
  return { collects, paysOut, fronts: Math.max(0, paysOut - collects) };
}

/** The default lead: the largest net creditor (ties go to the lowest id), or null if nobody is owed. */
export function defaultLead(balances: { user_id: string; net_minor: number }[]): string | null {
  const creditors = balances.filter((b) => b.net_minor > 0);
  if (creditors.length === 0) return null;
  return [...creditors].sort((a, b) => b.net_minor - a.net_minor || a.user_id.localeCompare(b.user_id))[0].user_id;
}
