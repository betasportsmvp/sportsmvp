import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getGroupPlan } from "@/lib/entitlements";
import { getGroupContext } from "@/lib/groups";
import { createClient, getUser } from "@/lib/supabase/server";
import { removeMember, revokeInvite, setMemberRole } from "../../actions";
import { InviteForm } from "./invite-form";

export const metadata: Metadata = { title: "Group" };

export default async function MembersPage({ params }: PageProps<"/groups/[groupId]/members">) {
  const { groupId } = await params;
  const user = (await getUser())!;
  const ctx = await getGroupContext(groupId, user.id);
  if (!ctx) notFound();
  const { group, members, myRole, isAdmin: canManage } = ctx;

  const plan = await getGroupPlan(groupId).catch(() => null);
  const supabase = await createClient();
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
    <>
      <p className="muted">
        {group.sport} · {group.timezone} · {group.currency} · members can backdate {group.backdate_days} days
      </p>

      <p className="row actions">
        <Link href={`/groups/${groupId}/progress`}>Progress and goals</Link>
        <Link href={`/groups/${groupId}/plan`}>
          Plan: {plan ? plan.label : "unavailable"}
        </Link>
      </p>

      <h2>Members ({members.length}{plan?.member_limit ? ` of ${plan.member_limit}` : ""})</h2>
      <ul className="list card">
        {members.map((m) => (
          <li key={m.user_id} className="row">
            <span>
              {m.name}
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
                  <button type="submit" className="quiet" aria-label={`Remove ${m.name} from group`}>
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
    </>
  );
}
