import Link from "next/link";
import { allocationIsStale } from "@/lib/allocation";
import type { Consumption } from "@/lib/costs";
import { formatTimestamp } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { quantityLabel, type Unit } from "@/lib/units";
import { ReallocateForm, ReverseConsumptionForm } from "./balls/forms";

/** The "Balls used" part of a day: what was used, what it cost and who pays what. */
export function SessionCosts(props: {
  groupId: string;
  date: string;
  currency: string;
  timeZone: string;
  consumptions: Consumption[];
  presentIds: string[];
  items: Map<string, { name: string; unit: Unit }>;
  nameOf: (id: string | null) => string;
  viewerId: string;
  isAdmin: boolean;
}) {
  const { groupId, consumptions, nameOf } = props;
  const money = (minor: number) => formatMoney(minor, props.currency);
  const posted = consumptions.filter((c) => c.status === "posted");
  const total = posted.reduce((sum, c) => sum + c.total_cost_minor, 0);
  const myShare = posted
    .flatMap((c) => c.allocations)
    .filter((a) => a.user_id === props.viewerId)
    .reduce((sum, a) => sum + a.amount_minor, 0);

  return (
    <section aria-labelledby="balls-used" className="stack">
      <h2 id="balls-used">Balls used</h2>
      {consumptions.length === 0 ? (
        <p className="muted">No ball use recorded for this day.</p>
      ) : (
        <>
          <p className="summary">
            <strong>{money(total)}</strong> in balls · your share <strong>{money(myShare)}</strong>
          </p>
          <ul className="list card">
            {consumptions.map((c) => {
              const item = props.items.get(c.item_id);
              const stale = c.status === "posted" && allocationIsStale(c.allocations.map((a) => a.user_id), props.presentIds);
              return (
                <li key={c.id} className="stack roster-row">
                  <div className="row">
                    <strong>{quantityLabel(c.quantity, item?.unit ?? "can")}{item && ` of ${item.name}`}</strong>
                    <span>
                      {money(c.total_cost_minor)}
                      {c.status === "reversed" && <span className="badge">Reversed</span>}
                    </span>
                  </div>
                  <span className="muted small">
                    Recorded by {nameOf(c.recorded_by)} · {formatTimestamp(c.created_at, props.timeZone)}
                    {c.note && <> · {c.note}</>}
                  </span>
                  {c.status === "reversed" ? (
                    <p className="muted small">
                      Reversed by {nameOf(c.reversed_by)}
                      {c.reversal_reason && <> · “{c.reversal_reason}”</>}. The balls went back into stock and nobody pays for them.
                    </p>
                  ) : (
                    <>
                      <ul className="plain-list">
                        {c.allocations.map((a) => (
                          <li key={a.id} className="row">
                            <span>{nameOf(a.user_id)}</span>
                            <span>
                              {money(a.amount_minor)}
                              {a.rounding_minor > 0 && <span className="muted small"> (includes {money(a.rounding_minor)} rounding)</span>}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <p className="muted small">
                        Split equally between the {c.allocations.length} {c.allocations.length === 1 ? "person" : "people"} playing.
                        {c.allocations.some((a) => a.rounding_minor > 0) && " Leftover paise go one each to the first people in a fixed order."}
                      </p>
                      {stale && (
                        <div className="notice stack">
                          <p className="flush">
                            <span aria-hidden="true">⚠</span> Attendance for this day changed after the cost was split, so
                            the split above no longer matches who played.
                          </p>
                          {props.isAdmin ? (
                            props.presentIds.length > 0 ? (
                              <ReallocateForm groupId={groupId} consumptionId={c.id} />
                            ) : (
                              <p className="flush small">Nobody is marked as playing now. Reverse this ball use if it was a mistake.</p>
                            )
                          ) : (
                            <p className="flush small">An admin needs to re-split it.</p>
                          )}
                        </div>
                      )}
                    </>
                  )}
                  {c.previous.length > 0 && (
                    <details>
                      <summary className="small">Earlier splits</summary>
                      <ul className="plain-list small">
                        {c.previous.map((a) => (
                          <li key={a.id}>
                            {nameOf(a.user_id)} {money(a.amount_minor)}
                            <span className="muted">
                              {" "}· replaced by {nameOf(a.reversed_by)}
                              {a.reversed_at && <> on {formatTimestamp(a.reversed_at, props.timeZone)}</>}
                              {a.reversal_reason && <> · “{a.reversal_reason}”</>}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {props.isAdmin && c.status === "posted" && <ReverseConsumptionForm groupId={groupId} consumptionId={c.id} />}
                </li>
              );
            })}
          </ul>
        </>
      )}
      <p className="row actions">
        {props.isAdmin && (
          <Link href={`/groups/${groupId}/balls/use?date=${props.date}`} className="button secondary">Record ball use</Link>
        )}
        <Link href={`/groups/${groupId}/costs`}>Your ball costs</Link>
      </p>
    </section>
  );
}
