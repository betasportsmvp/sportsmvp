import "server-only";
import { createClient } from "@/lib/supabase/server";

export type Role = "owner" | "admin" | "member";

export type GroupSummary = { id: string; name: string; sport: string; role: Role };

export async function listMyGroups(userId: string): Promise<GroupSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("memberships")
    .select("role, groups(id, name, sport)")
    .eq("user_id", userId)
    .is("left_at", null)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).flatMap((row) => {
    const g = row.groups as unknown as { id: string; name: string; sport: string } | null;
    return g ? [{ ...g, role: row.role as Role }] : [];
  });
}
