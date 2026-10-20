"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { recordPayment, reversePayment, setSettlementLead } from "./actions";

type MemberOption = { user_id: string; name: string };

function Feedback({ state }: { state: { error?: string; message?: string } | undefined }) {
  if (state?.error) return <p className="alert" role="alert">{state.error}</p>;
  if (state?.message) return <p className="notice" role="status">{state.message}</p>;
  return null;
}

function MemberSelect(props: { name: string; members: MemberOption[]; viewerId: string; defaultValue?: string }) {
  return (
    <select name={props.name} defaultValue={props.defaultValue ?? ""} required>
      <option value="" disabled>Choose a member</option>
      {props.members.map((m) => (
        <option key={m.user_id} value={m.user_id}>{m.user_id === props.viewerId ? `${m.name} (you)` : m.name}</option>
      ))}
    </select>
  );
}

export function PaymentForm(props: {
  groupId: string;
  currency: string;
  members: MemberOption[];
  viewerId: string;
  isAdmin: boolean;
  payer?: string;
  payee?: string;
  amount?: string;
  today: string;
  idempotencyKey: string;
}) {
  const [state, action] = useActionState(recordPayment, undefined);
  return (
    <form action={action} className="card stack">
      <input type="hidden" name="group_id" value={props.groupId} />
      <input type="hidden" name="currency" value={props.currency} />
      <input type="hidden" name="idempotency_key" value={props.idempotencyKey} />
      <label>
        Paid by
        <MemberSelect name="payer_id" members={props.members} viewerId={props.viewerId} defaultValue={props.payer ?? props.viewerId} />
      </label>
      <label>
        Paid to
        <MemberSelect name="payee_id" members={props.members} viewerId={props.viewerId} defaultValue={props.payee} />
      </label>
      {!props.isAdmin && <p className="muted small flush">You can record payments you made or received.</p>}
      <label>
        Amount ({props.currency})
        <input name="amount" inputMode="decimal" required defaultValue={props.amount} placeholder="400" autoComplete="off" />
      </label>
      <label>
        Date paid
        <input name="paid_on" type="date" max={props.today} defaultValue={props.today} required />
      </label>
      <label>
        Reference or note <span className="muted">(optional)</span>
        <input name="note" maxLength={500} placeholder="UPI ref 4821" />
      </label>
      <label className="inline">
        <input type="checkbox" name="confirmed" required /> I confirm this money was actually paid
      </label>
      <Feedback state={state} />
      <SubmitButton pendingText="Saving…">Record payment</SubmitButton>
    </form>
  );
}

export function ReversePaymentForm({ groupId, paymentId }: { groupId: string; paymentId: string }) {
  const [state, action] = useActionState(reversePayment, undefined);
  return (
    <details>
      <summary className="small">Reverse this payment</summary>
      <form action={action} className="stack">
        <input type="hidden" name="group_id" value={groupId} />
        <input type="hidden" name="payment_id" value={paymentId} />
        <label>
          Reason
          <input name="reason" required maxLength={500} placeholder="Wrong amount entered" />
        </label>
        <Feedback state={state} />
        <SubmitButton className="secondary" pendingText="Reversing…">Reverse payment</SubmitButton>
      </form>
    </details>
  );
}

export function LeadForm(props: { groupId: string; members: MemberOption[]; viewerId: string; chosenLead: string | null }) {
  const [state, action] = useActionState(setSettlementLead, undefined);
  return (
    <form action={action} className="stack">
      <input type="hidden" name="group_id" value={props.groupId} />
      <label>
        Settlement lead
        <select name="lead_id" defaultValue={props.chosenLead ?? ""}>
          <option value="">Automatic: whoever is owed the most</option>
          {props.members.map((m) => (
            <option key={m.user_id} value={m.user_id}>{m.user_id === props.viewerId ? `${m.name} (you)` : m.name}</option>
          ))}
        </select>
      </label>
      <Feedback state={state} />
      <SubmitButton className="secondary" pendingText="Saving…">Save lead</SubmitButton>
    </form>
  );
}
