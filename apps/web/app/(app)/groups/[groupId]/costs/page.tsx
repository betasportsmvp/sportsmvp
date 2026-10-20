import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadMemberCosts } from "@/lib/costs";
import { formatDate } from "@/lib/dates";
import { getGroupContext } from "@/lib/groups";
import { loadItems } from "@/lib/inventory";
import { formatMoney } from "@/lib/money";
import { getUser } from "@/lib/supabase/server";
import { quantityLabel } from "@/lib/units";

export const metadata: Metadata = { title: "Ball costs" };

export default async function CostsPage({ params, searchParams }: PageProps<"/groups/[groupId]/costs">) {
  const { groupId } = await params;
  const query = await searchParams;
  const user = (await getUser())!;
  const ctx = await getGroupContext(groupId, user.id);
  if (!ctx) notFound();
  const { group, members, isAdmin } = ctx;

  const requested = typeof query.member === "string" ? query.member : user.id;
  const subject = isAdmin && members.some((m) => m.user_id === requested) ? requested : user.id;

  let costs, items;
  try {
    [costs, items] = await Promise.all([loadMemberCosts(groupId, subject), loadItems(groupId)]);
  } catch {
    return <p className="alert" role="alert">We couldn&apos;t load the costs. Please refresh the page.</p>;
  }

  const names = new Map(members.map((m) => [m.user_id, m.name]));
  const nameOf = (id: string | null) => (id === user.id ? "you" : (id && names.get(id)) || "a former member");
  const itemById = new Map(items.map((i) => [i.id, i]));
  const money = (minor: number) => formatMoney(minor, group.currency);
  const shortDate = (d: string) => formatDate(d, { day: "numeric", month: "short", year: "numeric" });
  const whose = subject === user.id ? "Your" : `${names.get(subject)}'s`;

  return (
    <>
      <p><Link href={`/groups/${groupId}/settle`}>← Settle</Link></p>
      <h2>{whose} ball costs</h2>

      {isAdmin && (
        <form className="row" method="get">
          <label className="inline">
            Member{" "}
            <select name="member" defaultValue={subject}>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>{m.user_id === user.id ? `${m.name} (you)` : m.name}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="secondary">Show</button>
        </form>
      )}

      <section className="card stack" aria-label="Total">
        <p className="flush">
          Share of balls used so far: <strong className="stock">{money(costs.total)}</strong>
        </p>
        <p className="muted small flush">
          This is only {subject === user.id ? "your" : "their"} share of balls used. The full balance, including balls paid
          for and payments, is on <Link href={`/groups/${groupId}/settle`}>Settle</Link>.
        </p>
      </section>

      <h2>Why this cost?</h2>
      {costs.rows.length === 0 ? (
        <p className="muted">No ball costs yet. Costs appear here once an admin records balls used on a day {subject === user.id ? "you" : "they"} played.</p>
      ) : (
        <ol className="list card">
          {costs.rows.map(({ allocation, consumption: c }) => {
            const item = itemById.get(c.item_id);
            const unit = item?.unit ?? "can";
            return (
              <li key={allocation.id} className="stack roster-row">
                <div className="row">
                  <Link href={`/groups/${groupId}/calendar?date=${c.local_date}#balls-used`}>
                    {formatDate(c.local_date, { weekday: "short", day: "numeric", month: "short" })}
                  </Link>
                  <strong>{money(allocation.amount_minor)}</strong>
                </div>
                <span className="small">
                  {quantityLabel(c.quantity, unit)}{item && items.length > 1 && ` of ${item.name}`} cost {money(c.total_cost_minor)},
                  split between {c.allocations.length} {c.allocations.length === 1 ? "person" : "people"}
                  {allocation.rounding_minor > 0 && <> (plus {money(allocation.rounding_minor)} rounding)</>}.
                </span>
                <details>
                  <summary className="small">Where the {money(c.total_cost_minor)} came from</summary>
                  <ul className="plain-list small">
                    {c.sources.map((s) => (
                      <li key={s.lot_id}>
                        {quantityLabel(s.quantity, unit)} from{" "}
                        {s.purchased_on
                          ? <>{nameOf(s.purchaser_id)}&apos;s purchase on {shortDate(s.purchased_on)} ({quantityLabel(s.lot_quantity, unit)} for {money(s.lot_cost_minor)})</>
                          : <>stock added by a correction on {shortDate(s.received_on)} (no cost)</>}
                        {" "}= <strong>{money(s.cost_minor)}</strong>
                      </li>
                    ))}
                  </ul>
                  <p className="muted small flush">
                    Balls are taken from the oldest purchase first, at the price actually paid for them.
                  </p>
                </details>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
