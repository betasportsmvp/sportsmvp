"use server";

import { revalidatePath } from "next/cache";
import { friendlyError } from "@/lib/errors";
import type { FormState } from "@/lib/form";
import { createClient } from "@/lib/supabase/server";

export async function savePreferences(_prev: FormState, formData: FormData): Promise<FormState> {
  const groupId = String(formData.get("group_id") ?? "");
  const target = Number(formData.get("weekly_target"));
  const remindersOn = formData.get("reminders_enabled") === "on";
  const days = formData.getAll("reminder_days").map(Number).filter((d) => d >= 1 && d <= 7);
  const time = String(formData.get("reminder_time") ?? "") || "07:00";
  if (!Number.isInteger(target) || target < 1 || target > 7) return { error: "Choose a weekly goal from 1 to 7." };
  if (remindersOn && days.length === 0) return { error: "Choose at least one day for reminders, or turn them off." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_my_preferences", {
    p_group_id: groupId,
    p_weekly_target: target,
    p_hide_consistency: formData.get("hide_consistency") === "on",
    p_reminders_enabled: remindersOn,
    p_reminder_days: days,
    p_reminder_time: time,
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath(`/groups/${groupId}`, "layout");
  return { message: "Saved." };
}

export async function saveMonthlyTarget(_prev: FormState, formData: FormData): Promise<FormState> {
  const groupId = String(formData.get("group_id") ?? "");
  const target = Number(formData.get("monthly_target"));
  if (!Number.isInteger(target) || target < 1 || target > 31) return { error: "Choose a monthly goal from 1 to 31 sessions." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_group_monthly_target", { p_group_id: groupId, p_target: target });
  if (error) return { error: friendlyError(error) };
  revalidatePath(`/groups/${groupId}`, "layout");
  return { message: "Group goal saved." };
}
