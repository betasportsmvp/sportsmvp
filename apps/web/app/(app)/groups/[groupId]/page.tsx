import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AttendanceRoster, recordedNote } from "@/components/attendance-roster";
import { AttendanceToggle } from "@/components/attendance-toggle";
import { loadAttendance } from "@/lib/attendance";
import { statusLabel, statusMark } from "@/lib/attendance-status";
import { loadMemberCosts } from "@/lib/costs";
import { formatDate, localDate } from "@/lib/dates";
import { getGroupContext } from "@/lib/groups";
import { loadItems } from "@/lib/inventory";
import { formatMoney } from "@/lib/money";
import { quantityLabel } from "@/lib/units";
import { getUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Today" };

export default async function TodayPage({ params }: PageProps<"/groups/[groupId]">) {
  const { groupId } = await params;
  const user = (await getUser())!;
  const ctx = await getGroupContext(groupId, user.id);
  if (!ctx) notFound();
  const { group, members, isAdmin } = ctx;

  const today = localDate(group.timezone);
  let records;
  try {
    records = await loadAttendance(groupId, today, today);
  } catch {
    return <p className="alert" role="alert">We couldn&apos;t load today&apos;s attendance. Please refresh the page.</p>;
  }

  const [lowStock, costs] = await Promise.all([
    isAdmin ? loadItems(groupId).then((items) => items.filter((i) => i.low)).catch(() => []) : [],
    loadMemberCosts(groupId, user.id).catch(() => null),
  ]);
  const mine = records.find((r) => r.user_id === user.id);
  const myStatus = mine?.status ?? "none";
  const names = new Map(members.map((m) => [m.user_id, m.name]));
  const note = recordedNote(mine, names, group.timezone, user.id);
  const active = records.filter((r) => names.has(r.user_id));
  const playing = active.filter((r) => r.status === "present").length;
  const notPlaying = active.filter((r) => r.status === "absent").length;
  const unrecorded = members.length - playing - notPlaying;

  return (
    <>
      <p className="muted">{formatDate(today, { weekday: "long", day: "numeric", month: "long" })}</p>

      <section className="card stack" aria-labelledby="my-status">
        <h2 id="my-status" className="flush">Are you playing today?</h2>
        <p className={`status-pill large ${myStatus}`}>
          <span aria-hidden="true">{statusMark[myStatus]}</span> {statusLabel[myStatus]}
        </p>
        {note && <p className="muted small">{note}</p>}
        <AttendanceToggle groupId={groupId} date={today} userId={user.id} status={mine?.status ?? null} subject="your" />
      </section>

      {lowStock.map((i) => (
        <p key={i.id} className="notice">
          <span aria-hidden="true">⚠</span> {i.name} running low: {quantityLabel(i.on_hand, i.unit)} left.{" "}
          <Link href={`/groups/${groupId}/balls/purchase`}>Add purchase</Link>
        </p>
      ))}

      <p className="summary" aria-label="Today's summary">
        <strong>{playing}</strong> playing · <strong>{notPlaying}</strong> not playing · <strong>{unrecorded}</strong> not recorded
      </p>

      <p className="row actions">
        {costs && (
          <span>
            Your ball costs so far: <strong>{formatMoney(costs.total, group.currency)}</strong>{" "}
            <Link href={`/groups/${groupId}/costs`}>Why this cost?</Link>
          </span>
        )}
        {isAdmin && playing > 0 && (
          <Link href={`/groups/${groupId}/balls/use?date=${today}`} className="button secondary">Record ball use</Link>
        )}
      </p>

      <h2>{isAdmin ? "Mark the group" : "Who's playing"}</h2>
      {isAdmin ? (
        <AttendanceRoster
          groupId={groupId}
          date={today}
          members={members}
          records={records}
          timeZone={group.timezone}
          viewerId={user.id}
          editable
        />
      ) : playing === 0 ? (
        <p className="muted">Nobody has marked themselves as playing yet.</p>
      ) : (
        <ul className="list card">
          {records
            .filter((r) => r.status === "present")
            .map((r) => (
              <li key={r.user_id}>{names.get(r.user_id) ?? "Member"}</li>
            ))}
        </ul>
      )}
    </>
  );
}
