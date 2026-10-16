import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type Role = "owner" | "admin" | "member";

export type GroupSummary = { id: string; name: string; sport: string; role: Role };

export type Group = {
  id: string;
  name: string;
  sport: string;
  timezone: string;
  currency: string;
  backdate_days: number;
};

export type Member = {
  user_id: string;
  role: Role;
  joined_at: string;
  name: string;
};

const roleOrder: Record<Role, number> = { owner: 0, admin: 1, member: 2 };

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

/**
 * The group, its active roster and the caller's role, or null when the caller can't see it.
 * Cached per request so the group layout and its pages share one lookup.
 */
export const getGroupContext = cache(async (groupId: string, userId: string) => {
  const supabase = await createClient();
  const { data: group } = await supabase
    .from("groups")
    .select("id, name, sport, timezone, currency, backdate_days")
    .eq("id", groupId)
    .maybeSingle<Group>();
  if (!group) return null;

  const { data: rows } = await supabase
    .from("memberships")
    .select("user_id, role, joined_at, profiles(display_name, email)")
    .eq("group_id", groupId)
    .is("left_at", null);

  const members: Member[] = (rows ?? [])
    .map((r) => {
      const p = r.profiles as unknown as { display_name: string; email: string } | null;
      return { user_id: r.user_id, role: r.role as Role, joined_at: r.joined_at, name: p?.display_name || p?.email || "Member" };
    })
    .sort((a, b) => roleOrder[a.role] - roleOrder[b.role] || a.joined_at.localeCompare(b.joined_at));

  const myRole = members.find((m) => m.user_id === userId)?.role;
  if (!myRole) return null;
  return { group, members, myRole, isAdmin: myRole === "owner" || myRole === "admin" };
});

export type GroupContext = NonNullable<Awaited<ReturnType<typeof getGroupContext>>>;
