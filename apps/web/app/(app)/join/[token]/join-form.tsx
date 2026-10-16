"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { joinGroup } from "../../groups/actions";

export function JoinForm({ token, idempotencyKey }: { token: string; idempotencyKey: string }) {
  const [state, action] = useActionState(joinGroup, undefined);
  return (
    <form action={action} className="stack">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      {state?.error && <p className="alert" role="alert">{state.error}</p>}
      <SubmitButton className="block" pendingText="Joining…">Join group</SubmitButton>
    </form>
  );
}
