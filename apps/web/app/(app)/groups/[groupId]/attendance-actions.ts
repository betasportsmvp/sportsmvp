"use server";

import { revalidatePath } from "next/cache";
import { isIsoDate } from "@/lib/dates";
import { friendlyError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export type AttendanceFormState = { error?: string; saved?: "present" | "absent" } | undefined;

export async function recordAttendance(
  _prev: AttendanceFormState,
  formData: FormData,
): Promise<AttendanceFormState> {
  const groupId = String(formData.get("group_id") ?? "");
  const date = formData.get("local_date");
  const status = formData.get("status");
  if (!isIsoDate(date) || (status !== "present" && status !== "absent")) {
    return { error: friendlyError({ message: "invalid_attendance" }) };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("upsert_attendance", {
    p_group_id: groupId,
    p_local_date: date,
    p_user_id: String(formData.get("user_id") ?? ""),
    p_status: status,
    p_idempotency_key: String(formData.get("idempotency_key") ?? ""),
  });
  if (error) return { error: friendlyError(error) };

  revalidatePath(`/groups/${groupId}`, "layout");
  return { saved: status };
}
