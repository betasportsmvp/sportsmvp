import "server-only";
import { createClient } from "@/lib/supabase/server";

export type Balance = {
  user_id: string;
  purchases_minor: number;
  allocations_minor: number;
  payments_sent_minor: number;
  payments_received_minor: number;
  net_minor: number;
};

export type PlanRow = { payer_id: string; payee_id: string; amount_minor: number; lead_id: string };

export type Payment = {
  id: string;
  payer_id: string;
  payee_id: string;
  amount_minor: number;
  paid_on: string;
  note: string | null;
  status: "confirmed" | "reversed";
  recorded_by: string;
  created_at: string;
  reversed_by: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
};

export type Period = { from: string | null; to: string | null };

/** Balances, the suggested plan, the group's chosen lead and the payments, for one period. */
export async function loadSettlement(groupId: string, { from, to }: Period) {
  const supabase = await createClient();
  const range = { p_group_id: groupId, p_from: from, p_to: to };
  let payments = supabase
    .from("payments")
    .select("id, payer_id, payee_id, amount_minor, paid_on, note, status, recorded_by, created_at, reversed_by, reversed_at, reversal_reason")
    .eq("group_id", groupId)
    .order("paid_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (from) payments = payments.gte("paid_on", from);
  if (to) payments = payments.lte("paid_on", to);

  const [balancesRes, planRes, groupRes, paymentsRes] = await Promise.all([
    supabase.rpc("group_balances", range),
    supabase.rpc("calculate_settlement", { ...range, p_lead: null }),
    supabase.from("groups").select("settlement_lead_id").eq("id", groupId).single(),
    payments,
  ]);
  for (const res of [balancesRes, planRes, groupRes, paymentsRes]) if (res.error) throw res.error;

  return {
    balances: balancesRes.data as Balance[],
    plan: planRes.data as PlanRow[],
    chosenLead: (groupRes.data?.settlement_lead_id as string | null) ?? null,
    payments: paymentsRes.data as Payment[],
  };
}

/** One member's all-time net balance, or null if it couldn't be loaded. */
export async function loadMyBalance(groupId: string, userId: string): Promise<number | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("group_balances", { p_group_id: groupId, p_from: null, p_to: null });
  if (error) return null;
  return (data as Balance[]).find((b) => b.user_id === userId)?.net_minor ?? 0;
}
