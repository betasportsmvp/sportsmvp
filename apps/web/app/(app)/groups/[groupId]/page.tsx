import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Role } from "@/lib/groups";
import { createClient, getUser } from "@/lib/supabase/server";
import { removeMember, revokeInvite, setMemberRole } from "../actions";
import { InviteForm } from "./invite-form";

export const metadata: Metadata = { title: "Group" };

type Member = {
  user_id: string;
  role: Role;
  joined_at: string;
  profiles: { display_name: string; email: string } | null;
};

const roleOrder: Record<Role, number> = { owner: 0, admin: 1, member: 2 };

export default async function GroupPage({ params }: PageProps<"/groups/[groupId]">) {
  const { groupId } = await params;
  const user = (await getUser())!;
  const supabase = await createClient();

  const { data: group } = await supabase
    .from("groups")
    .select("id, name, sport, timezone, currency, backdate_days")
    .eq("id", groupId)
    .maybeSingle();
  if (!group) notFound();

  const { data: memberRows } = await supabase
    .from("memberships")
    .select("user_id, role, joined_at, profiles(display_name, email)")
    .eq("group_id", groupId)
    .is("left_at", null);
  const members = ((memberRows ?? []) as unknown as Member[]).sort(
    (a, b) => roleOrder[a.role] - roleOrder[b.role] || a.joined_at.localeCompare(b.joined_at),
  );

  const myRole = members.find((m) => m.user_id === user.id)?.role;
  const canManage = myRole === "owner" || myRole === "admin";

  const { data: invites } = canManage
    ? await supabase
        .from("group_invites")
        .select("id, expires_at, use_count, max_uses, revoked_at")
        .eq("group_id", groupId)
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
    : { data: [] };

  return (
    <main>
      <p><Link href="/groups">← All groups</Link></p>
      <h1>{group.name}</h1>
      <p className="muted">
        {group.sport} · {group.timezone} · {group.currency} · members can backdate {group.backdate_days} days
      </p>

      <h2>Members ({members.length})</h2>
      <ul className="list card">
        {members.map((m) => (
          <li key={m.user_id} className="row">
            <span>
              {m.profiles?.display_name || m.profiles?.email}
              {m.user_id === user.id && <span className="muted"> (you)</span>}
            </span>
            <span className="row">
              <span className="badge">{m.role}</span>
              {myRole === "owner" && m.role !== "owner" && (
                <form action={setMemberRole}>
                  <input type="hidden" name="group_id" value={groupId} />
                  <input type="hidden" name="user_id" value={m.user_id} />
                  <input type="hidden" name="role" value={m.role === "admin" ? "member" : "admin"} />
                  <button type="submit" className="quiet">{m.role === "admin" ? "Make member" : "Make admin"}</button>
                </form>
              )}
              {canManage && m.role !== "owner" && (myRole === "owner" || m.role === "member") && (
                <form action={removeMember}>
                  <input type="hidden" name="group_id" value={groupId} />
                  <input type="hidden" name="user_id" value={m.user_id} />
                  <button type="submit" className="quiet" aria-label={`Remove ${m.profiles?.display_name ?? "member"} from group`}>
                    Remove from group
                  </button>
                </form>
              )}
            </span>
          </li>
        ))}
      </ul>

      {canManage && (
        <>
          <h2>Invite people</h2>
          <div className="card stack">
            <InviteForm groupId={groupId} />
            {invites && invites.length > 0 && (
              <ul className="list">
                {invites.map((inv) => (
                  <li key={inv.id} className="row">
                    <span className="muted">
                      Active link · expires {new Date(inv.expires_at).toLocaleDateString()} · used {inv.use_count}
                      {inv.max_uses ? ` of ${inv.max_uses}` : ""}
                    </span>
                    <form action={revokeInvite}>
                      <input type="hidden" name="group_id" value={groupId} />
                      <input type="hidden" name="invite_id" value={inv.id} />
                      <button type="submit" className="quiet">Turn off link</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </main>
  );
}
