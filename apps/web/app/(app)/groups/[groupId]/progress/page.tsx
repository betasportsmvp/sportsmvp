import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getGroupContext } from "@/lib/groups";
import { groupMessage, streakMessage, timesLabel, weeklyMessage } from "@/lib/motivation";
import { loadMyPreferences, loadProgress } from "@/lib/progress";
import { getUser } from "@/lib/supabase/server";
import { MonthlyTargetForm, PreferencesForm } from "./forms";

export const metadata: Metadata = { title: "Progress" };

export default async function ProgressPage({ params }: PageProps<"/groups/[groupId]/progress">) {
  const { groupId } = await params;
  const user = (await getUser())!;
  const ctx = await getGroupContext(groupId, user.id);
  if (!ctx) notFound();
  const { members, isAdmin } = ctx;

  let progress;
  try {
    progress = await loadProgress(groupId);
  } catch {
    return <p className="alert" role="alert">We couldn&apos;t load progress. Please refresh the page.</p>;
  }
  const prefs = await loadMyPreferences(groupId, user.id);
  const { group } = progress;
  const me = progress.members.find((m) => m.user_id === user.id);
  const names = new Map(members.map((m) => [m.user_id, m.name]));
  const others = progress.members.filter((m) => m.user_id !== user.id && names.has(m.user_id));
  const hiddenCount = members.length - progress.members.length;
  const streak = me ? streakMessage(me.week_streak) : null;

  return (
    <>
      <p><Link href={`/groups/${groupId}/members`}>← Group</Link></p>

      <section className="card stack" aria-labelledby="group-goal">
        <h2 id="group-goal" className="flush">{groupMessage(group.sessions_played, group.monthly_target)}</h2>
        <progress max={group.monthly_target} value={Math.min(group.sessions_played, group.monthly_target)}>
          {group.sessions_played} of {group.monthly_target}
        </progress>
        <p className="muted small flush">
          {group.sessions_played} of {group.monthly_target} sessions played this month · {group.players_this_week}{" "}
          {group.players_this_week === 1 ? "person has" : "people have"} played this week
        </p>
        {isAdmin && <MonthlyTargetForm groupId={groupId} target={group.monthly_target} />}
      </section>

      {me && (
        <section className="card stack" aria-labelledby="my-week">
          <h2 id="my-week" className="flush">{weeklyMessage(me.sessions_this_week, me.weekly_target)}</h2>
          <p className="muted small flush">
            {streak ? `${streak} ` : ""}You&apos;ve played {timesLabel(me.sessions_this_month)} this month.
          </p>
        </section>
      )}

      <h2>This week</h2>
      {others.length === 0 ? (
        <p className="muted">Nobody else is sharing their weekly games.</p>
      ) : (
        <ul className="list card">
          {others.map((m) => (
            <li key={m.user_id} className="row">
              <span>
                {names.get(m.user_id)}
                {m.hidden && <span className="muted small"> (only shown to admins)</span>}
              </span>
              <span className="muted">played {timesLabel(m.sessions_this_week)}{m.sessions_this_week >= m.weekly_target ? " · goal reached" : ""}</span>
            </li>
          ))}
        </ul>
      )}
      {hiddenCount > 0 && (
        <p className="muted small">{hiddenCount} {hiddenCount === 1 ? "member keeps" : "members keep"} this private.</p>
      )}
      <p className="muted small">Played counts days marked as playing. No prizes or rankings, just a nudge to get out on court.</p>

      <h2>My settings</h2>
      <PreferencesForm groupId={groupId} prefs={prefs} />
    </>
  );
}
