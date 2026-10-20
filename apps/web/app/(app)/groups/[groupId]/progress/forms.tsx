"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import type { Preferences } from "@/lib/progress";
import { saveMonthlyTarget, savePreferences } from "./actions";

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function Feedback({ state }: { state: { error?: string; message?: string } | undefined }) {
  if (state?.error) return <p className="alert" role="alert">{state.error}</p>;
  if (state?.message) return <p className="notice" role="status">{state.message}</p>;
  return null;
}

export function PreferencesForm({ groupId, prefs }: { groupId: string; prefs: Preferences }) {
  const [state, action] = useActionState(savePreferences, undefined);
  return (
    <form action={action} className="card stack">
      <input type="hidden" name="group_id" value={groupId} />
      <label>
        Games a week I&apos;m aiming for
        <select name="weekly_target" defaultValue={String(prefs.weekly_target)}>
          {[1, 2, 3, 4, 5, 6, 7].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </label>
      <label className="inline">
        <input type="checkbox" name="hide_consistency" defaultChecked={prefs.hide_consistency} /> Only show my weekly
        games to me and the group admins
      </label>
      <fieldset className="plain stack">
        <legend>Reminders</legend>
        <label className="inline">
          <input type="checkbox" name="reminders_enabled" defaultChecked={prefs.reminders_enabled} /> Remind me to mark
          whether I&apos;m playing
        </label>
        <div className="row wrap">
          {weekdays.map((d, i) => (
            <label key={d} className="inline small">
              <input type="checkbox" name="reminder_days" value={i + 1} defaultChecked={prefs.reminder_days.includes(i + 1)} /> {d}
            </label>
          ))}
        </div>
        <label>
          At
          <input type="time" name="reminder_time" defaultValue={prefs.reminder_time} />
        </label>
        <p className="muted small flush">Reminders aren&apos;t sent yet. We&apos;re saving your choice for when they are.</p>
      </fieldset>
      <Feedback state={state} />
      <SubmitButton pendingText="Saving…">Save my settings</SubmitButton>
    </form>
  );
}

export function MonthlyTargetForm({ groupId, target }: { groupId: string; target: number }) {
  const [state, action] = useActionState(saveMonthlyTarget, undefined);
  return (
    <form action={action} className="stack">
      <input type="hidden" name="group_id" value={groupId} />
      <label>
        Group goal: sessions a month
        <input type="number" name="monthly_target" min={1} max={31} defaultValue={target} required />
      </label>
      <Feedback state={state} />
      <SubmitButton className="secondary" pendingText="Saving…">Save group goal</SubmitButton>
    </form>
  );
}
