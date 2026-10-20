import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { balanceStanding, defaultLead, leadCashflow } from "@/lib/balance";
import { formatDate, formatTimestamp, isIsoDate } from "@/lib/dates";
import { hasEntitlement } from "@/lib/entitlements";
import { getGroupContext } from "@/lib/groups";
import { formatMoney } from "@/lib/money";
import { loadSettlement } from "@/lib/settlement";
import { getUser } from "@/lib/supabase/server";
import { LeadForm, ReversePaymentForm } from "./forms";

export const metadata: Metadata = { title: "Settle up" };

export default async function SettlePage({ params, searchParams }: PageProps<"/groups/[groupId]/settle">) {
  const { groupId } = await params;
  const query = await searchParams;
  const user = (await getUser())!;
  const ctx = await getGroupContext(groupId, user.id);
  if (!ctx) notFound();
  const { group, members, isAdmin } = ctx;

  // Date ranges are a Pro feature; all-time balances and every payment stay visible on Free.
  const periods = await hasEntitlement(groupId, "settlement_periods");
  const from = periods && isIsoDate(query.from) ? query.from : null;
  const to = periods && isIsoDate(query.to) ? query.to : null;

  let data;
  try {
    data = await loadSettlement(groupId, { from, to });
  } catch {
    return <p className="alert" role="alert">We couldn&apos;t load the balances. Please refresh the page.</p>;
  }
  const { balances, plan, chosenLead, payments } = data;

  const names = new Map(members.map((m) => [m.user_id, m.name]));
  const nameOf = (id: string | null) => (id === user.id ? "You" : (id && names.get(id)) || "A former member");
  const money = (minor: number) => formatMoney(minor, group.currency);
  const shortDate = (d: string) => formatDate(d, { day: "numeric", month: "short", year: "numeric" });

  const mine = balances.find((b) => b.user_id === user.id);
  const standing = balanceStanding(mine?.net_minor ?? 0);
  const lead = plan[0]?.lead_id ?? null;
  const topCreditor = defaultLead(balances);
  const flow = lead ? leadCashflow(plan, lead) : null;
  const owedTotal = balances.filter((b) => b.net_minor > 0).reduce((s, b) => s + b.net_minor, 0);
  const owingTotal = balances.filter((b) => b.net_minor < 0).reduce((s, b) => s - b.net_minor, 0);
  const payHref = (r: { payer_id: string; payee_id: string; amount_minor: number }) =>
    `/groups/${groupId}/settle/pay?payer=${r.payer_id}&payee=${r.payee_id}&amount=${r.amount_minor}`;
  const periodLabel = from || to
    ? `${from ? shortDate(from) : "the start"} to ${to ? shortDate(to) : "today"}`
    : "all time";

  return (
    <>
      <section className="card stack" aria-labelledby="my-balance">
        <h2 id="my-balance" className="flush">
          {standing.kind === "owed" && <>You are owed {money(standing.amount)}</>}
          {standing.kind === "owes" && <>You owe {money(standing.amount)}</>}
          {standing.kind === "square" && <>You&apos;re all square</>}
        </h2>
        {mine && (
          <ul className="plain-list small">
            <li className="row"><span>Balls you paid for</span><span>+ {money(mine.purchases_minor)}</span></li>
            <li className="row"><span>Your share of balls used</span><span>− {money(mine.allocations_minor)}</span></li>
            <li className="row"><span>Payments you made</span><span>+ {money(mine.payments_sent_minor)}</span></li>
            <li className="row"><span>Payments you received</span><span>− {money(mine.payments_received_minor)}</span></li>
          </ul>
        )}
        <p className="muted small flush">
          {periodLabel === "all time" ? "All time." : `From ${periodLabel}.`}{" "}
          <Link href={`/groups/${groupId}/costs`}>How this was calculated, session by session</Link>
        </p>
      </section>

      {periods ? (
        <details className="card">
          <summary>Choose a period</summary>
          <form method="get" className="stack">
            <label>
              From
              <input type="date" name="from" defaultValue={from ?? ""} />
            </label>
            <label>
              To
              <input type="date" name="to" defaultValue={to ?? ""} />
            </label>
            <div className="row actions">
              <button type="submit" className="secondary">Show</button>
              {(from || to) && <Link href={`/groups/${groupId}/settle`}>All time</Link>}
            </div>
          </form>
        </details>
      ) : (
        <p className="muted small">
          Balances for a chosen date range come with <Link href={`/groups/${groupId}/plan`}>Group Pro</Link>.
        </p>
      )}

      <h2>Suggested payments</h2>
      {plan.length === 0 ? (
        <p className="muted">
          {owedTotal === 0 ? "Nobody is owed anything, so there's nothing to settle." : "Everyone who owes has paid. Nothing to settle."}
        </p>
      ) : (
        <>
          <p className="muted small">
            Everyone who owes pays {lead === user.id ? "you" : names.get(lead!) ?? "the lead"}, the settlement lead, who then pays
            everyone else who is owed. Nothing is paid automatically: record each payment once it&apos;s made.
          </p>
          <ul className="list card">
            {plan.map((r) => (
              <li key={`${r.payer_id}-${r.payee_id}`} className="stack roster-row">
                <div className="row">
                  <span>
                    <strong>{nameOf(r.payer_id)}</strong> pay{r.payer_id === user.id ? "" : "s"} <strong>{r.payee_id === user.id ? "you" : nameOf(r.payee_id)}</strong>
                  </span>
                  <strong>{money(r.amount_minor)}</strong>
                </div>
                <div className="row">
                  <span className="badge">Suggested</span>
                  {(isAdmin || r.payer_id === user.id || r.payee_id === user.id) && (
                    <Link href={payHref(r)} className="small">Record this payment</Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {lead && flow && (
            <p className="muted small">
              {nameOf(lead)} collect{lead === user.id ? "" : "s"} {money(flow.collects)} and pay{lead === user.id ? "" : "s"} out {money(flow.paysOut)}.
              {flow.fronts > 0 && <> That means paying {money(flow.fronts)} more than {lead === user.id ? "you collect" : "they collect"}.</>}
              {topCreditor && lead !== topCreditor && (
                <> The default lead would be {nameOf(topCreditor)}, who is owed the most.</>
              )}
            </p>
          )}
        </>
      )}
      {owedTotal !== owingTotal && owedTotal > 0 && (
        <p className="muted small">
          People are owed {money(owedTotal)} and owe {money(owingTotal)}. The difference is mostly balls bought but not used
          yet, so whoever bought them keeps that credit until the balls are used.
        </p>
      )}
      <p className="row actions">
        <Link href={`/groups/${groupId}/settle/pay`} className="button">Record a payment</Link>
      </p>

      {isAdmin && (
        <details className="card">
          <summary>Change the settlement lead</summary>
          <p className="muted small">
            By default the person owed the most collects from everyone. If someone else collects, they also have to pay the
            person owed the most, which can mean paying out more than they collect.
          </p>
          <LeadForm groupId={groupId} members={members} viewerId={user.id} chosenLead={chosenLead} />
        </details>
      )}

      <h2>Everyone&apos;s balance</h2>
      <div className="table-scroll card">
        <table className="balances">
          <thead>
            <tr>
              <th scope="col">Member</th>
              <th scope="col">Paid for balls</th>
              <th scope="col">Share used</th>
              <th scope="col">Paid</th>
              <th scope="col">Received</th>
              <th scope="col">Balance</th>
            </tr>
          </thead>
          <tbody>
            {balances.map((b) => {
              const s = balanceStanding(b.net_minor);
              return (
                <tr key={b.user_id}>
                  <th scope="row">
                    {isAdmin || b.user_id === user.id ? (
                      <Link href={`/groups/${groupId}/costs?member=${b.user_id}`}>{nameOf(b.user_id)}</Link>
                    ) : nameOf(b.user_id)}
                  </th>
                  <td>{money(b.purchases_minor)}</td>
                  <td>{money(b.allocations_minor)}</td>
                  <td>{money(b.payments_sent_minor)}</td>
                  <td>{money(b.payments_received_minor)}</td>
                  <td>
                    {s.kind === "owed" && <>is owed {money(s.amount)}</>}
                    {s.kind === "owes" && <>owes {money(s.amount)}</>}
                    {s.kind === "square" && <>square</>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">Balance = paid for balls − share used + payments made − payments received.</p>

      <h2>Recorded payments</h2>
      {payments.length === 0 ? (
        <p className="muted">No payments recorded {from || to ? "in this period" : "yet"}.</p>
      ) : (
        <ol className="list card">
          {payments.map((p) => (
            <li key={p.id} className="stack roster-row">
              <div className="row">
                <span>
                  <strong>{nameOf(p.payer_id)}</strong> paid <strong>{p.payee_id === user.id ? "you" : nameOf(p.payee_id)}</strong>
                </span>
                <strong>{money(p.amount_minor)}</strong>
              </div>
              <div className="row">
                <span className="badge">{p.status === "confirmed" ? "Confirmed" : "Reversed"}</span>
                <span className="muted small">
                  {shortDate(p.paid_on)}{p.note && <> · {p.note}</>}
                </span>
              </div>
              <span className="muted small">
                Recorded by {p.recorded_by === user.id ? "you" : nameOf(p.recorded_by)} · {formatTimestamp(p.created_at, group.timezone)}
              </span>
              {p.status === "reversed" && (
                <span className="muted small">
                  Reversed by {nameOf(p.reversed_by)}
                  {p.reversal_reason && <> · “{p.reversal_reason}”</>}
                </span>
              )}
              {p.status === "confirmed" && (isAdmin || p.recorded_by === user.id) && (
                <ReversePaymentForm groupId={groupId} paymentId={p.id} />
              )}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
