import "server-only";
import type { AttendanceStatus } from "@/lib/attendance-status";
import { createClient } from "@/lib/supabase/server";

export type AttendanceRecord = {
  local_date: string;
  user_id: string;
  status: AttendanceStatus;
  recorded_by: string;
  recorded_at: string;
};

export type AttendanceChange = {
  created_at: string;
  actor_id: string | null;
  user_id: string;
  from: AttendanceStatus | null;
  to: AttendanceStatus;
  late: boolean;
};

type SessionRow = {
  local_date: string;
  attendance: Omit<AttendanceRecord, "local_date">[];
};

/** Attendance between two dates (inclusive), optionally for one member only. */
export async function loadAttendance(
  groupId: string,
  from: string,
  to: string,
  userId?: string,
): Promise<AttendanceRecord[]> {
  const supabase = await createClient();
  let query = supabase
    .from("sessions")
    .select("local_date, attendance(user_id, status, recorded_by, recorded_at)")
    .eq("group_id", groupId)
    .gte("local_date", from)
    .lte("local_date", to);
  if (userId) query = query.eq("attendance.user_id", userId);
  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as SessionRow[]).flatMap((s) =>
    s.attendance.map((a) => ({ ...a, local_date: s.local_date })),
  );
}

/** The audit trail of attendance changes for one date, oldest first. */
export async function loadAttendanceHistory(groupId: string, date: string): Promise<AttendanceChange[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_events")
    .select("created_at, actor_id, before_json, after_json")
    .eq("group_id", groupId)
    .eq("action", "attendance.recorded")
    .eq("after_json->>local_date", date)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((e) => ({
    created_at: e.created_at,
    actor_id: e.actor_id,
    user_id: e.after_json.user_id,
    from: e.before_json?.status ?? null,
    to: e.after_json.status,
    late: Boolean(e.after_json.late),
  }));
}
