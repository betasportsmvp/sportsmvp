import "server-only";
import { createClient } from "@/lib/supabase/server";

export type MemberProgress = {
  user_id: string;
  weekly_target: number;
  sessions_this_week: number;
  sessions_this_month: number;
  week_streak: number;
  hidden: boolean;
};

export type GroupProgress = {
  month_start: string;
  sessions_played: number;
  monthly_target: number;
  players_this_week: number;
};

export type Preferences = {
  weekly_target: number;
  hide_consistency: boolean;
  reminders_enabled: boolean;
  reminder_days: number[];
  reminder_time: string;
};

export const defaultPreferences: Preferences = {
  weekly_target: 2,
  hide_consistency: false,
  reminders_enabled: false,
  reminder_days: [],
  reminder_time: "07:00",
};

export async function loadProgress(groupId: string) {
  const supabase = await createClient();
  const [members, group] = await Promise.all([
    supabase.rpc("member_progress", { p_group_id: groupId }),
    supabase.rpc("group_progress", { p_group_id: groupId }).single(),
  ]);
  if (members.error) throw members.error;
  if (group.error) throw group.error;
  return { members: members.data as MemberProgress[], group: group.data as GroupProgress };
}

export async function loadMyPreferences(groupId: string, userId: string): Promise<Preferences> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("member_preferences")
    .select("weekly_target, hide_consistency, reminders_enabled, reminder_days, reminder_time")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle<Preferences>();
  return data ? { ...data, reminder_time: data.reminder_time.slice(0, 5) } : defaultPreferences;
}
