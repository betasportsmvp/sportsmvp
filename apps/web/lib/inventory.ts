import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Unit } from "@/lib/units";

export type Item = {
  id: string;
  name: string;
  unit: Unit;
  reorder_threshold: number | null;
  on_hand: number;
  low: boolean;
};

export type Purchase = {
  id: string;
  item_id: string;
  purchaser_id: string;
  quantity: number;
  total_minor: number;
  purchased_on: string;
  note: string | null;
  receipt_path: string | null;
  status: "posted" | "reversed";
  recorded_by: string;
  reversed_by: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
};

/** One ledger line: everything a single command wrote, summed across the lots it touched. */
export type LedgerEntry = {
  entry_id: string;
  item_id: string;
  kind: "purchase" | "purchase_reversal" | "adjustment" | "consumption" | "consumption_reversal";
  quantity: number;
  /** Cost taken from the lots, for ball use (negative when reversed). */
  cost_minor: number | null;
  /** The day balls were used, for ball use and its reversal. */
  session_date: string | null;
  occurred_on: string;
  created_at: string;
  recorded_by: string;
  reason: string | null;
  purchase: Purchase | null;
  /** On-hand quantity of the item right after this entry. */
  balance: number;
  /** For purchases still eligible for reversal (none of the lot used or adjusted). */
  untouched: boolean;
};

export async function loadItems(groupId: string): Promise<Item[]> {
  const supabase = await createClient();
  const [{ data: items, error }, { data: stock, error: stockError }] = await Promise.all([
    supabase.from("items").select("id, name, unit, reorder_threshold").eq("group_id", groupId).order("created_at"),
    supabase.from("item_stock").select("item_id, on_hand").eq("group_id", groupId),
  ]);
  if (error) throw error;
  if (stockError) throw stockError;
  const onHand = new Map((stock ?? []).map((s) => [s.item_id as string, s.on_hand as number]));
  return (items ?? []).map((i) => {
    const qty = onHand.get(i.id) ?? 0;
    return { ...(i as Omit<Item, "on_hand" | "low">), on_hand: qty, low: i.reorder_threshold !== null && qty <= i.reorder_threshold };
  });
}

export async function loadLedger(groupId: string): Promise<LedgerEntry[]> {
  const supabase = await createClient();
  const [movementsRes, purchasesRes, lotsRes] = await Promise.all([
    supabase
      .from("inventory_movements")
      .select("entry_id, item_id, kind, quantity, cost_minor, occurred_on, created_at, recorded_by, reason, purchase_id, sessions(local_date)")
      .eq("group_id", groupId)
      .order("created_at", { ascending: true }),
    supabase
      .from("purchases")
      .select(
        "id, item_id, purchaser_id, quantity, total_minor, purchased_on, note, receipt_path, status, recorded_by, reversed_by, reversed_at, reversal_reason",
      )
      .eq("group_id", groupId),
    supabase.from("inventory_lots").select("purchase_id, received_quantity, remaining_quantity").eq("group_id", groupId),
  ]);
  for (const res of [movementsRes, purchasesRes, lotsRes]) if (res.error) throw res.error;

  const purchases = new Map((purchasesRes.data as Purchase[]).map((p) => [p.id, p]));
  const untouched = new Set(
    (lotsRes.data ?? [])
      .filter((l) => l.purchase_id && l.remaining_quantity === l.received_quantity)
      .map((l) => l.purchase_id as string),
  );

  const entries = new Map<string, LedgerEntry>();
  for (const m of movementsRes.data ?? []) {
    const existing = entries.get(m.entry_id);
    if (existing) {
      existing.quantity += m.quantity;
      if (m.cost_minor !== null) existing.cost_minor = (existing.cost_minor ?? 0) + m.cost_minor;
      continue;
    }
    entries.set(m.entry_id, {
      entry_id: m.entry_id,
      item_id: m.item_id,
      kind: m.kind,
      quantity: m.quantity,
      cost_minor: m.cost_minor,
      session_date: (m.sessions as unknown as { local_date: string } | null)?.local_date ?? null,
      occurred_on: m.occurred_on,
      created_at: m.created_at,
      recorded_by: m.recorded_by,
      reason: m.reason,
      purchase: m.purchase_id ? (purchases.get(m.purchase_id) ?? null) : null,
      balance: 0,
      untouched: m.kind === "purchase" && !!m.purchase_id && untouched.has(m.purchase_id),
    });
  }

  const running = new Map<string, number>();
  const list = [...entries.values()];
  for (const e of list) {
    e.balance = (running.get(e.item_id) ?? 0) + e.quantity;
    running.set(e.item_id, e.balance);
  }
  return list.reverse();
}
