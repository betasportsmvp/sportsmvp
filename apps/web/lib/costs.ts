import "server-only";
import { createClient } from "@/lib/supabase/server";

export type Allocation = {
  id: string;
  consumption_id: string;
  user_id: string;
  amount_minor: number;
  rounding_minor: number;
  status: "active" | "reversed";
  created_by: string;
  created_at: string;
  reversed_by: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
};

/** The part of one lot a consumption used, and the purchase that lot came from. */
export type SourceSlice = {
  lot_id: string;
  quantity: number;
  cost_minor: number;
  received_on: string;
  lot_quantity: number;
  lot_cost_minor: number;
  purchaser_id: string | null;
  purchased_on: string | null;
};

export type Consumption = {
  id: string;
  local_date: string;
  item_id: string;
  quantity: number;
  total_cost_minor: number;
  note: string | null;
  status: "posted" | "reversed";
  recorded_by: string;
  created_at: string;
  reversed_by: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
  /** Who pays now (empty once reversed). */
  allocations: Allocation[];
  /** Earlier splits replaced by a reallocation or cancelled by a reversal, newest first. */
  previous: Allocation[];
  sources: SourceSlice[];
};

const allocationColumns =
  "id, consumption_id, user_id, amount_minor, rounding_minor, status, created_by, created_at, reversed_by, reversed_at, reversal_reason";

async function hydrate(rows: Omit<Consumption, "allocations" | "previous" | "sources">[]): Promise<Consumption[]> {
  if (rows.length === 0) return [];
  const supabase = await createClient();
  const ids = rows.map((r) => r.id);
  const [allocRes, moveRes] = await Promise.all([
    supabase.from("cost_allocations").select(allocationColumns).in("consumption_id", ids).order("user_id"),
    supabase
      .from("inventory_movements")
      .select("consumption_id, lot_id, quantity, cost_minor, inventory_lots(received_on, received_quantity, total_cost_minor, purchases(purchaser_id, purchased_on))")
      .in("consumption_id", ids)
      .eq("kind", "consumption"),
  ]);
  if (allocRes.error) throw allocRes.error;
  if (moveRes.error) throw moveRes.error;

  const allocations = allocRes.data as Allocation[];
  type MoveRow = {
    consumption_id: string;
    lot_id: string;
    quantity: number;
    cost_minor: number;
    inventory_lots: {
      received_on: string;
      received_quantity: number;
      total_cost_minor: number;
      purchases: { purchaser_id: string; purchased_on: string } | null;
    } | null;
  };
  const moves = moveRes.data as unknown as MoveRow[];

  return rows.map((r) => ({
    ...r,
    allocations: allocations.filter((a) => a.consumption_id === r.id && a.status === "active"),
    previous: allocations
      .filter((a) => a.consumption_id === r.id && a.status === "reversed")
      .sort((a, b) => (b.reversed_at ?? "").localeCompare(a.reversed_at ?? "")),
    sources: moves
      .filter((m) => m.consumption_id === r.id)
      .map((m) => ({
        lot_id: m.lot_id,
        quantity: -m.quantity,
        cost_minor: m.cost_minor,
        received_on: m.inventory_lots?.received_on ?? "",
        lot_quantity: m.inventory_lots?.received_quantity ?? 0,
        lot_cost_minor: m.inventory_lots?.total_cost_minor ?? 0,
        purchaser_id: m.inventory_lots?.purchases?.purchaser_id ?? null,
        purchased_on: m.inventory_lots?.purchases?.purchased_on ?? null,
      }))
      .sort((a, b) => a.received_on.localeCompare(b.received_on)),
  }));
}

const consumptionColumns =
  "id, item_id, quantity, total_cost_minor, note, status, recorded_by, created_at, reversed_by, reversed_at, reversal_reason, sessions!inner(local_date)";

type ConsumptionRow = Omit<Consumption, "local_date" | "allocations" | "previous" | "sources"> & {
  sessions: { local_date: string };
};

function flatten(rows: ConsumptionRow[]) {
  return rows.map(({ sessions, ...rest }) => ({ ...rest, local_date: sessions.local_date }));
}

/** Balls used on one group-local date, oldest entry first. */
export async function loadSessionConsumptions(groupId: string, date: string): Promise<Consumption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("consumptions")
    .select(consumptionColumns)
    .eq("group_id", groupId)
    .eq("sessions.local_date", date)
    .order("created_at");
  if (error) throw error;
  return hydrate(flatten(data as unknown as ConsumptionRow[]));
}

export type MemberCost = { allocation: Allocation; consumption: Consumption };

/** One member's current share of every session's ball costs, newest session first. */
export async function loadMemberCosts(groupId: string, userId: string): Promise<{ total: number; rows: MemberCost[] }> {
  const supabase = await createClient();
  const { data: mine, error } = await supabase
    .from("cost_allocations")
    .select("consumption_id")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw error;
  const ids = [...new Set((mine ?? []).map((a) => a.consumption_id as string))];
  if (ids.length === 0) return { total: 0, rows: [] };

  const { data, error: cError } = await supabase.from("consumptions").select(consumptionColumns).in("id", ids);
  if (cError) throw cError;
  const consumptions = await hydrate(flatten(data as unknown as ConsumptionRow[]));

  const rows = consumptions
    .flatMap((c) => c.allocations.filter((a) => a.user_id === userId).map((allocation) => ({ allocation, consumption: c })))
    .sort((a, b) => b.consumption.local_date.localeCompare(a.consumption.local_date) || b.consumption.created_at.localeCompare(a.consumption.created_at));
  return { total: rows.reduce((sum, r) => sum + r.allocation.amount_minor, 0), rows };
}
