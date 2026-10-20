import "server-only";
import { cache } from "react";
import type { Feature, PlanCode, Tier } from "@/lib/plans";
import { createClient } from "@/lib/supabase/server";

export type GroupPlan = {
  tier: Tier;
  /** "override" (beta access), "subscription" or "free". */
  source: "override" | "subscription" | "free";
  label: string;
  plan_code: PlanCode | null;
  status: "active" | "past_due" | "canceled" | "expired" | "revoked" | null;
  current_period_end: string | null;
  features: Feature[];
  member_limit: number | null;
};

/** The group's plan as the database resolves it. Cached per request. */
export const getGroupPlan = cache(async (groupId: string): Promise<GroupPlan> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("group_plan", { p_group_id: groupId }).single();
  if (error) throw error;
  return data as GroupPlan;
});

/**
 * Server-side feature gate. Fails closed: an error means no access, and Free features
 * (financial history included) never depend on this check.
 */
export async function hasEntitlement(groupId: string, feature: Feature): Promise<boolean> {
  try {
    return (await getGroupPlan(groupId)).features.includes(feature);
  } catch {
    return false;
  }
}
