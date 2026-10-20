import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AttendanceRoster, recordedNote } from "@/components/attendance-roster";
import { AttendanceToggle } from "@/components/attendance-toggle";
import { loadAttendance, loadAttendanceHistory } from "@/lib/attendance";
import { loadSessionConsumptions } from "@/lib/costs";
import { statusLabel, statusMark } from "@/lib/attendance-status";
import {
  addMonths,
  attendanceEditPolicy,
  formatDate,
  formatMonth,
  formatTimestamp,
  isIsoDate,
  isIsoMonth,
  localDate,
  monthGrid,
  monthOf,
  monthRange,
} from "@/lib/dates";
import { getGroupContext } from "@/lib/groups";
import { loadItems } from "@/lib/inventory";
import { getUser } from "@/lib/supabase/server";
import { SessionCosts } from "../session-costs";

export const metadata: Metadata = { title: "Calendar" };

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function CalendarPage({ params, searchParams }: PageProps<"/groups/[groupId]/calendar">) {
  const { groupId } = await params;
  const query = await searchParams;
  const user = (await getUser())!;
  const ctx = await getGroupContext(groupId, user.id);
  if (!ctx) notFound();
  const { group, members, isAdmin } = ctx;

  const today = localDate(group.timezone);
  const selected = isIsoDate(query.date) && query.date <= today ? query.date : today;
  const month = isIsoMonth(query.month) ? query.month : monthOf(selected);
  const { first, last } = monthRange(month);
  const href = (m: string, d?: string) =>
    `/groups/${groupId}/calendar?month=${m}${d ? `&date=${d}` : ""}`;

  let mine, dayRecords, history, consumptions, items;
  try {
    [mine, dayRecords, history, consumptions, items] = await Promise.all([
      loadAttendance(groupId, first, last, user.id),
      loadAttendance(groupId, selected, selected),
      loadAttendanceHistory(groupId, selected),
      loadSessionConsumptions(groupId, selected),
      loadItems(groupId),
    ]);
  } catch {
    return <p className="alert" role="alert">We couldn&apos;t load the calendar. Please refresh the page.</p>;
  }

  const myByDate = new Map(mine.map((r) => [r.local_date, r.status]));
  const names = new Map(members.map((m) => [m.user_id, m.name]));
  const myRecord = dayRecords.find((r) => r.user_id === user.id);
  const myStatus = myRecord?.status ?? "none";
  const myNote = recordedNote(myRecord, names, group.timezone, user.id);
  const policy = attendanceEditPolicy({ date: selected, today, backdateDays: group.backdate_days, isAdmin });
  const ownPolicy = attendanceEditPolicy({ date: selected, today, backdateDays: group.backdate_days, isAdmin: false });
  const nameOf = (id: string | null) =>
    id === user.id ? "You" : (id && names.get(id)) || "A former member";

  return (
    <>
      <nav className="row month-nav" aria-label="Month">
        <Link href={href(addMonths(month, -1))} aria-label="Previous month">‹ Prev</Link>
        <h2 className="flush">{formatMonth(month)}</h2>
        {month < monthOf(today) ? (
          <Link href={href(addMonths(month, 1))} aria-label="Next month">Next ›</Link>
        ) : (
          <span aria-hidden="true" />
        )}
      </nav>

      <table className="calendar" aria-label={`Your attendance in ${formatMonth(month)}`}>
        <thead>
          <tr>{weekdays.map((d) => <th key={d} scope="col">{d}</th>)}</tr>
        </thead>
        <tbody>
          {monthGrid(month).map((week, i) => (
            <tr key={i}>
              {week.map((day, j) => {
                if (!day) return <td key={j} />;
                const status = myByDate.get(day) ?? "none";
                const label = `${formatDate(day, { weekday: "long", day: "numeric", month: "long" })}: ${statusLabel[status]}`;
                const classes = ["day", status, day === selected && "selected", day === today && "today"]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <td key={j}>
                    {day > today ? (
                      <span className="day future" aria-label={`${label}, upcoming`}>
                        {Number(day.slice(8))}
                      </span>
                    ) : (
                      <Link
                        href={href(month, day)}
                        className={classes}
                        aria-label={label}
                        aria-current={day === selected ? "date" : undefined}
                      >
                        {Number(day.slice(8))}
                        <span className="mark" aria-hidden="true">{status === "none" ? "" : statusMark[status]}</span>
                      </Link>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">✓ Playing · ✕ Not playing · blank: not recorded</p>

      <section className="card stack" aria-labelledby="day-title">
        <h2 id="day-title" className="flush">
          {selected === today ? "Today" : formatDate(selected, { weekday: "long", day: "numeric", month: "long" })}
        </h2>
        <p className={`status-pill large ${myStatus}`}>
          <span aria-hidden="true">{statusMark[myStatus]}</span> {statusLabel[myStatus]}
        </p>
        {myNote && <p className="muted small">{myNote}</p>}
        {ownPolicy === "editable" ? (
          <AttendanceToggle
            key={selected}
            groupId={groupId}
            date={selected}
            userId={user.id}
            status={myRecord?.status ?? null}
            subject="your"
          />
        ) : isAdmin ? (
          <p className="muted">This date is outside the {group.backdate_days}-day window for members. As an admin you can still correct it below.</p>
        ) : (
          <p className="notice">
            Members can change their attendance up to {group.backdate_days} days back. Ask an admin to correct this date.
          </p>
        )}
      </section>

      <h2>{isAdmin ? "Everyone on this day" : "Who played"}</h2>
      {isAdmin ? (
        <AttendanceRoster
          key={selected}
          groupId={groupId}
          date={selected}
          members={members}
          records={dayRecords}
          timeZone={group.timezone}
          viewerId={user.id}
          editable={policy === "editable"}
        />
      ) : dayRecords.some((r) => r.status === "present") ? (
        <ul className="list card">
          {dayRecords
            .filter((r) => r.status === "present")
            .map((r) => (
              <li key={r.user_id}>{nameOf(r.user_id)}</li>
            ))}
        </ul>
      ) : (
        <p className="muted">Nobody was marked as playing on this day.</p>
      )}

      <SessionCosts
        groupId={groupId}
        date={selected}
        currency={group.currency}
        timeZone={group.timezone}
        consumptions={consumptions}
        presentIds={dayRecords.filter((r) => r.status === "present").map((r) => r.user_id)}
        items={new Map(items.map((i) => [i.id, i]))}
        nameOf={nameOf}
        viewerId={user.id}
        isAdmin={isAdmin}
      />

      <h2>Changes</h2>
      {history.length === 0 ? (
        <p className="muted">No attendance has been recorded for this day yet.</p>
      ) : (
        <ol className="list card history">
          {history.map((h, i) => (
            <li key={i}>
              <strong>{nameOf(h.actor_id)}</strong>{" "}
              marked{" "}
              {h.actor_id === h.user_id
                ? h.user_id === user.id ? "yourself" : "themselves"
                : h.user_id === user.id ? "you" : nameOf(h.user_id)}{" "}
              as {statusLabel[h.to]}
              {h.from && <span className="muted"> (was {statusLabel[h.from]})</span>}
              <br />
              <span className="muted small">
                {formatTimestamp(h.created_at, group.timezone)}
                {h.late && " · recorded after the day"}
              </span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
