"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { createInvite } from "../actions";

export function InviteForm({ groupId }: { groupId: string }) {
  const [state, action] = useActionState(createInvite, undefined);
  return (
    <form action={action} className="stack">
      <input type="hidden" name="group_id" value={groupId} />
      <label>
        Link expires after
        <select name="expires_in_hours" defaultValue="168">
          <option value="24">1 day</option>
          <option value="168">7 days</option>
          <option value="720">30 days</option>
        </select>
      </label>
      <SubmitButton className="secondary" pendingText="Creating link…">Create invite link</SubmitButton>
      {state?.error && <p className="alert" role="alert">{state.error}</p>}
      {state?.inviteUrl && (
        <div className="notice" role="status">
          <p>Share this link with your group. It is shown only once.</p>
          <code className="code">{state.inviteUrl}</code>
        </div>
      )}
    </form>
  );
}
