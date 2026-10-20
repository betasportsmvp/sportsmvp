import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate } from "@/lib/dates";
import { getGroupPlan } from "@/lib/entitlements";
import { getGroupContext } from "@/lib/groups";
import { formatMoney } from "@/lib/money";
import { FEATURES, FREE_MEMBER_LIMIT, PLANS } from "@/lib/plans";
import { getUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Plan" };

export default async function PlanPage({ params }: PageProps<"/groups/[groupId]/plan">) {
  const { groupId } = await params;
  const user = (await getUser())!;
  const ctx = await getGroupContext(groupId, user.id);
  if (!ctx) notFound();

  let plan;
  try {
    plan = await getGroupPlan(groupId);
  } catch {
    return <p className="alert" role="alert">We couldn&apos;t load your group&apos;s plan. Please refresh the page.</p>;
  }
  const until = plan.current_period_end
    ? formatDate(plan.current_period_end.slice(0, 10), { day: "numeric", month: "long", year: "numeric" })
    : null;

  return (
    <>
      <p><Link href={`/groups/${groupId}/members`}>← Group</Link></p>

      <section className="card stack" aria-labelledby="current-plan">
        <h2 id="current-plan" className="flush">
          {plan.label}
          {" "}<span className="badge">{plan.tier === "pro" ? "Pro" : "Free"}</span>
        </h2>
        {plan.source === "override" && (
          <p className="flush">Every Pro feature is on for your group during the private beta. There&apos;s nothing to pay.</p>
        )}
        {plan.source === "subscription" && (
          <p className="flush">
            {plan.status === "canceled" ? "Cancelled; Pro stays on" : "Pro is on"}
            {until ? ` until ${until}` : " for good"}.
          </p>
        )}
        {plan.source === "free" && (
          <p className="flush">Your group is on the Free plan, up to {FREE_MEMBER_LIMIT} active members.</p>
        )}
        <p className="muted small flush">
          Whatever the plan, your group&apos;s balances, payments and cost history stay visible to everyone in it.
        </p>
      </section>

      <h2>What&apos;s included</h2>
      <div className="table-scroll card">
        <table className="balances">
          <thead>
            <tr><th scope="col">Feature</th><th scope="col">Free</th><th scope="col">Pro</th></tr>
          </thead>
          <tbody>
            {FEATURES.map((f) => (
              <tr key={f.key}>
                <th scope="row">{f.label}</th>
                <td>{f.free ? "✓" : <span className="muted">–</span>}</td>
                <td>✓</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Prices after the beta</h2>
      <ul className="list card">
        {PLANS.map((p) => (
          <li key={p.code} className="row">
            <span>
              <strong>{p.name}</strong>
              <br />
              <span className="muted small">{p.note}</span>
            </span>
            <span>{p.priceMinor === 0 ? "Free" : `${formatMoney(p.priceMinor, "INR")} ${p.per}`}</span>
          </li>
        ))}
      </ul>
      <p className="muted small">Not on sale yet. Nothing is charged during the beta, and we&apos;ll tell you well before that changes.</p>
    </>
  );
}
