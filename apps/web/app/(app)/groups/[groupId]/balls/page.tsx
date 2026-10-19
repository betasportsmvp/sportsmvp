import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate, formatTimestamp } from "@/lib/dates";
import { getGroupContext } from "@/lib/groups";
import { loadItems, loadLedger, type LedgerEntry } from "@/lib/inventory";
import { formatMoney } from "@/lib/money";
import { getUser } from "@/lib/supabase/server";
import { quantityLabel, type Unit } from "@/lib/units";
import { ItemForm, ReverseForm } from "./forms";

export const metadata: Metadata = { title: "Balls" };

export default async function BallsPage({ params }: PageProps<"/groups/[groupId]/balls">) {
  const { groupId } = await params;
  const user = (await getUser())!;
  const ctx = await getGroupContext(groupId, user.id);
  if (!ctx) notFound();
  const { group, members, isAdmin } = ctx;

  let items, ledger;
  try {
    [items, ledger] = await Promise.all([loadItems(groupId), loadLedger(groupId)]);
  } catch {
    return <p className="alert" role="alert">We couldn&apos;t load the stock. Please refresh the page.</p>;
  }

  const names = new Map(members.map((m) => [m.user_id, m.name]));
  const nameOf = (id: string | null) => (id === user.id ? "you" : (id && names.get(id)) || "a former member");
  const itemById = new Map(items.map((i) => [i.id, i]));
  const money = (minor: number) => formatMoney(minor, group.currency);

  function describe(e: LedgerEntry) {
    const unit = itemById.get(e.item_id)?.unit ?? ("can" as Unit);
    const p = e.purchase;
    if (e.kind === "purchase" && p) {
      const each = Math.round(p.total_minor / p.quantity);
      return (
        <>
          <strong>Bought by {nameOf(p.purchaser_id)}</strong> for {money(p.total_minor)}{" "}
          <span className="muted">({money(each)} per {unit}{p.total_minor % p.quantity ? ", rounded" : ""})</span>
          {p.note && <span className="muted"> · {p.note}</span>}
          {p.recorded_by !== p.purchaser_id && <span className="muted"> · recorded by {nameOf(p.recorded_by)}</span>}
          {p.status === "reversed" && <span className="badge">Reversed</span>}
        </>
      );
    }
    if (e.kind === "purchase_reversal") {
      return (
        <>
          <strong>Purchase reversed by {nameOf(e.recorded_by)}</strong>
          {p && <span className="muted"> · {nameOf(p.purchaser_id)}&apos;s purchase of {formatDate(p.purchased_on, { day: "numeric", month: "short" })}</span>}
          {e.reason && <> · “{e.reason}”</>}
        </>
      );
    }
    return (
      <>
        <strong>Stock corrected by {nameOf(e.recorded_by)}</strong>
        {e.reason && <> · “{e.reason}”</>}
      </>
    );
  }

  return (
    <>
      <div className="row actions">
        <Link href={`/groups/${groupId}/balls/purchase`} className="button">Add purchase</Link>
        {isAdmin && <Link href={`/groups/${groupId}/balls/adjust`} className="button secondary">Correct stock</Link>}
      </div>

      <h2>On hand</h2>
      <ul className="list card">
        {items.map((i) => (
          <li key={i.id} className="stack roster-row">
            <div className="row">
              <span>{i.name}</span>
              <span className="row">
                <strong className="stock">{quantityLabel(i.on_hand, i.unit)}</strong>
                {i.low && <span className="badge warn"><span aria-hidden="true">⚠</span> Low stock</span>}
              </span>
            </div>
            {isAdmin && (
              <details>
                <summary className="small">Item settings</summary>
                <ItemForm groupId={groupId} item={i} />
              </details>
            )}
          </li>
        ))}
      </ul>
      {isAdmin && (
        <details className="card">
          <summary>Add another item</summary>
          <ItemForm groupId={groupId} />
        </details>
      )}

      <h2>History</h2>
      <p className="muted small">Purchases add stock. They don&apos;t mean anyone owes money yet; costs are shared later from the balls actually used.</p>
      {ledger.length === 0 ? (
        <p className="muted">Nothing recorded yet. Add the first purchase to start tracking stock.</p>
      ) : (
        <ol className="list card ledger">
          {ledger.map((e) => {
            const item = itemById.get(e.item_id);
            const unit = item?.unit ?? "can";
            return (
              <li key={e.entry_id} className="stack roster-row">
                <div className="row">
                  <span className={e.quantity > 0 ? "delta plus" : "delta minus"}>
                    {e.quantity > 0 ? "+" : "−"}{quantityLabel(Math.abs(e.quantity), unit)}
                    {items.length > 1 && <span className="muted"> {item?.name}</span>}
                  </span>
                  <span className="muted small">{quantityLabel(e.balance, unit)} after</span>
                </div>
                <span>{describe(e)}</span>
                <span className="muted small">
                  {formatDate(e.occurred_on, { day: "numeric", month: "short", year: "numeric" })}
                  {" · added "}{formatTimestamp(e.created_at, group.timezone)}
                  {e.purchase?.receipt_path && (
                    <> · <a href={`/groups/${groupId}/balls/receipt/${e.purchase.id}`} target="_blank" rel="noopener">View receipt</a></>
                  )}
                </span>
                {isAdmin && e.kind === "purchase" && e.purchase?.status === "posted" && e.untouched && (
                  <ReverseForm groupId={groupId} purchaseId={e.purchase.id} />
                )}
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
