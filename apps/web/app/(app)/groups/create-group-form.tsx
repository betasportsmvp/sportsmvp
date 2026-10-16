"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { groupDefaults } from "@/lib/config";
import { createGroup } from "./actions";

export function CreateGroupForm({ timezones, idempotencyKey }: { timezones: string[]; idempotencyKey: string }) {
  const [state, action] = useActionState(createGroup, undefined);
  return (
    <form action={action} className="card stack">
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      <label>
        Group name
        <input name="name" required maxLength={80} placeholder="Sunday Doubles" />
      </label>
      <label>
        Sport
        <input name="sport" required maxLength={40} defaultValue={groupDefaults.sport} />
      </label>
      <details>
        <summary>More settings</summary>
        <div className="stack">
          <label>
            Timezone
            <select name="timezone" defaultValue={groupDefaults.timezone}>
              {timezones.map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </label>
          <label>
            Currency
            <input name="currency" required pattern="[A-Za-z]{3}" maxLength={3} defaultValue={groupDefaults.currency} />
          </label>
          <label>
            Days members can backdate attendance
            <input name="backdate_days" type="number" min={0} max={365} defaultValue={groupDefaults.backdateDays} />
          </label>
        </div>
      </details>
      {state?.error && <p className="alert" role="alert">{state.error}</p>}
      <SubmitButton pendingText="Creating…">Create group</SubmitButton>
    </form>
  );
}
