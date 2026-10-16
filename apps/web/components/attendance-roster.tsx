import { AttendanceToggle } from "@/components/attendance-toggle";
import type { AttendanceRecord } from "@/lib/attendance";
import { statusLabel, statusMark } from "@/lib/attendance-status";
import { formatTimestamp, localDate } from "@/lib/dates";
import type { Member } from "@/lib/groups";

/** "Marked by Dana on 17 Oct, 18:20 (late)" when someone else or a later day recorded it. */
export function recordedNote(
  record: AttendanceRecord | undefined,
  names: Map<string, string>,
  timeZone: string,
  viewerId: string,
): string | null {
  if (!record) return null;
  const late = localDate(timeZone, new Date(record.recorded_at)) > record.local_date;
  const bySomeoneElse = record.recorded_by !== record.user_id;
  if (!late && !bySomeoneElse) return null;
  const who =
    record.recorded_by === viewerId ? "you" : (names.get(record.recorded_by) ?? "a former member");
  return `Marked by ${who} on ${formatTimestamp(record.recorded_at, timeZone)}${late ? " (late)" : ""}`;
}

export function AttendanceRoster({
  groupId,
  date,
  members,
  records,
  timeZone,
  viewerId,
  editable,
}: {
  groupId: string;
  date: string;
  members: Member[];
  records: AttendanceRecord[];
  timeZone: string;
  viewerId: string;
  editable: boolean;
}) {
  const byUser = new Map(records.map((r) => [r.user_id, r]));
  const names = new Map(members.map((m) => [m.user_id, m.name]));
  return (
    <ul className="list card">
      {members.map((m) => {
        const record = byUser.get(m.user_id);
        const status = record?.status ?? "none";
        const note = recordedNote(record, names, timeZone, viewerId);
        return (
          <li key={m.user_id} className="stack roster-row">
            <div className="row">
              <span>
                {m.name}
                {m.user_id === viewerId && <span className="muted"> (you)</span>}
              </span>
              <span className={`status-pill ${status}`}>
                <span aria-hidden="true">{statusMark[status]}</span> {statusLabel[status]}
              </span>
            </div>
            {note && <span className="muted small">{note}</span>}
            {editable && (
              <AttendanceToggle
                groupId={groupId}
                date={date}
                userId={m.user_id}
                status={record?.status ?? null}
                subject={m.user_id === viewerId ? "your" : `${m.name}'s`}
                labels={{ present: "Present", absent: "Absent" }}
                compact
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
