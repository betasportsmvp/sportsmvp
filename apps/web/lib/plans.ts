// The Free/Pro feature matrix and the price list, shared by server and client. Mirrors
// public.plan_features() and the public.plans rows; an integration test keeps them in step.

export type Tier = "free" | "pro";

export type Feature =
  | "attendance"
  | "inventory"
  | "settlement"
  | "financial_history"
  | "motivation"
  | "settlement_periods"
  | "unlimited_members";

export const FREE_MEMBER_LIMIT = 12;

export const FEATURES: { key: Feature; label: string; free: boolean }[] = [
  { key: "attendance", label: "Attendance and calendar", free: true },
  { key: "inventory", label: "Ball stock, purchases and fair cost split", free: true },
  { key: "settlement", label: "Balances and settle-up suggestions", free: true },
  { key: "financial_history", label: "Full payment and cost history, always", free: true },
  { key: "motivation", label: "Weekly goals and group progress", free: true },
  { key: "settlement_periods", label: "Balances for any date range", free: false },
  { key: "unlimited_members", label: `More than ${FREE_MEMBER_LIMIT} active members`, free: false },
];

export function featuresFor(tier: Tier): Feature[] {
  return FEATURES.filter((f) => tier === "pro" || f.free).map((f) => f.key);
}

export type PlanCode = "free" | "pro_monthly" | "pro_annual" | "founding_pass";

export const PLANS: { code: PlanCode; name: string; tier: Tier; priceMinor: number; per: string; note: string }[] = [
  { code: "free", name: "Free", tier: "free", priceMinor: 0, per: "", note: `1 group, up to ${FREE_MEMBER_LIMIT} active members` },
  { code: "pro_monthly", name: "Group Pro Monthly", tier: "pro", priceMinor: 29900, per: "a month", note: "For the whole group" },
  { code: "pro_annual", name: "Group Pro Annual", tier: "pro", priceMinor: 249900, per: "a year", note: "Two months free compared with monthly" },
  { code: "founding_pass", name: "Founding Club Pass", tier: "pro", priceMinor: 499900, per: "once", note: "Limited to the first 100 clubs" },
];
