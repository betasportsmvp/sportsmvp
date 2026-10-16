"use client";

import { useActionState } from "react";
import { signInWithDevEmail } from "@/app/auth/actions";
import { SubmitButton } from "@/components/submit-button";

export function DevLoginForm({ next }: { next: string }) {
  const [state, action] = useActionState(signInWithDevEmail, undefined);
  return (
    <details className="card">
      <summary>Local test sign-in</summary>
      <form action={action} className="stack">
        <input type="hidden" name="next" value={next} />
        <label>
          Email
          <input name="email" type="email" placeholder="alice@example.test" required autoComplete="email" />
        </label>
        <SubmitButton className="secondary">Email me a sign-in link</SubmitButton>
        {state?.error && <p className="alert" role="alert">{state.error}</p>}
        {state?.message && <p className="notice" role="status">{state.message}</p>}
      </form>
    </details>
  );
}
