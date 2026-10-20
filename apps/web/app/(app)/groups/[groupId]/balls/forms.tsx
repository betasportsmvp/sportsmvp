"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { units, type Unit } from "@/lib/units";
import {
  adjustInventory,
  reallocateConsumption,
  recordConsumption,
  recordPurchase,
  reverseConsumption,
  reversePurchase,
  saveItem,
} from "./actions";

type ItemOption = { id: string; name: string; unit: Unit };
type MemberOption = { user_id: string; name: string };

function Feedback({ state }: { state: { error?: string; message?: string } | undefined }) {
  if (state?.error) return <p className="alert" role="alert">{state.error}</p>;
  if (state?.message) return <p className="notice" role="status">{state.message}</p>;
  return null;
}

export function PurchaseForm(props: {
  groupId: string;
  currency: string;
  items: ItemOption[];
  members: MemberOption[];
  viewerId: string;
  isAdmin: boolean;
  today: string;
  idempotencyKey: string;
}) {
  const [state, action] = useActionState(recordPurchase, undefined);
  return (
    <form action={action} className="card stack">
      <input type="hidden" name="group_id" value={props.groupId} />
      <input type="hidden" name="currency" value={props.currency} />
      <input type="hidden" name="idempotency_key" value={props.idempotencyKey} />
      <label>
        Item
        <select name="item_id" required>
          {props.items.map((i) => (
            <option key={i.id} value={i.id}>{i.name} (per {i.unit})</option>
          ))}
        </select>
      </label>
      <label>
        How many
        <input name="quantity" type="number" inputMode="numeric" min={1} max={100000} step={1} required />
      </label>
      <label>
        Total price ({props.currency})
        <input name="total" inputMode="decimal" required placeholder="1200" autoComplete="off" />
      </label>
      {props.isAdmin ? (
        <label>
          Paid by
          <select name="purchaser_id" defaultValue={props.viewerId}>
            {props.members.map((m) => (
              <option key={m.user_id} value={m.user_id}>{m.user_id === props.viewerId ? `${m.name} (you)` : m.name}</option>
            ))}
          </select>
        </label>
      ) : (
        <input type="hidden" name="purchaser_id" value={props.viewerId} />
      )}
      <label>
        Date bought
        <input name="purchased_on" type="date" max={props.today} defaultValue={props.today} required />
      </label>
      <label>
        Note <span className="muted">(optional)</span>
        <input name="note" maxLength={500} placeholder="Head Championship, 4 cans" />
      </label>
      <label>
        Receipt photo or PDF <span className="muted">(optional, up to 5 MB)</span>
        <input name="receipt" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf" />
      </label>
      <Feedback state={state} />
      <SubmitButton pendingText="Saving…">Add purchase</SubmitButton>
    </form>
  );
}

export function AdjustForm(props: { groupId: string; items: (ItemOption & { on_hand: number })[]; idempotencyKey: string }) {
  const [state, action] = useActionState(adjustInventory, undefined);
  return (
    <form action={action} className="card stack">
      <input type="hidden" name="group_id" value={props.groupId} />
      <input type="hidden" name="idempotency_key" value={props.idempotencyKey} />
      <label>
        Item
        <select name="item_id" required>
          {props.items.map((i) => (
            <option key={i.id} value={i.id}>{i.name} ({i.on_hand} {i.unit}s on hand)</option>
          ))}
        </select>
      </label>
      <fieldset className="stack plain">
        <legend>What happened?</legend>
        <label className="inline">
          <input type="radio" name="direction" value="remove" defaultChecked /> Remove from stock (lost or damaged)
        </label>
        <label className="inline">
          <input type="radio" name="direction" value="add" /> Add to stock (found, donated)
        </label>
      </fieldset>
      <label>
        How many
        <input name="quantity" type="number" inputMode="numeric" min={1} max={100000} step={1} required />
      </label>
      <label>
        Reason
        <input name="reason" required maxLength={500} placeholder="Two cans went flat" />
      </label>
      <Feedback state={state} />
      <SubmitButton pendingText="Saving…">Save correction</SubmitButton>
    </form>
  );
}

export function ReverseForm({ groupId, purchaseId }: { groupId: string; purchaseId: string }) {
  const [state, action] = useActionState(reversePurchase, undefined);
  return (
    <details>
      <summary className="small">Reverse this purchase</summary>
      <form action={action} className="stack">
        <input type="hidden" name="group_id" value={groupId} />
        <input type="hidden" name="purchase_id" value={purchaseId} />
        <label>
          Reason
          <input name="reason" required maxLength={500} placeholder="Entered twice" />
        </label>
        <Feedback state={state} />
        <SubmitButton className="secondary" pendingText="Reversing…">Reverse purchase</SubmitButton>
      </form>
    </details>
  );
}

export function ItemForm({ groupId, item }: { groupId: string; item?: ItemOption & { reorder_threshold: number | null } }) {
  const [state, action] = useActionState(saveItem, undefined);
  return (
    <form action={action} className="stack">
      <input type="hidden" name="group_id" value={groupId} />
      {item && <input type="hidden" name="item_id" value={item.id} />}
      <label>
        Name
        <input name="name" required maxLength={60} defaultValue={item?.name} placeholder="Grips" />
      </label>
      {!item && (
        <label>
          Counted in
          <select name="unit" defaultValue="can">
            {units.map((u) => <option key={u} value={u}>{u}s</option>)}
          </select>
        </label>
      )}
      <label>
        Warn when stock is at or below <span className="muted">(optional)</span>
        <input name="reorder_threshold" type="number" min={0} max={100000} defaultValue={item?.reorder_threshold ?? ""} />
      </label>
      <Feedback state={state} />
      <SubmitButton className="secondary" pendingText="Saving…">{item ? "Save" : "Add item"}</SubmitButton>
    </form>
  );
}

export function UseForm(props: {
  groupId: string;
  items: (ItemOption & { on_hand: number })[];
  date: string;
  today: string;
  idempotencyKey: string;
}) {
  const [state, action] = useActionState(recordConsumption, undefined);
  return (
    <form action={action} className="card stack">
      <input type="hidden" name="group_id" value={props.groupId} />
      <input type="hidden" name="idempotency_key" value={props.idempotencyKey} />
      <label>
        Day played
        <input name="local_date" type="date" max={props.today} defaultValue={props.date} required />
      </label>
      <label>
        Item
        <select name="item_id" required>
          {props.items.map((i) => (
            <option key={i.id} value={i.id}>{i.name} ({i.on_hand} {i.unit}s on hand)</option>
          ))}
        </select>
      </label>
      <label>
        How many were used
        <input name="quantity" type="number" inputMode="numeric" min={1} max={100000} step={1} required />
      </label>
      <label>
        Note <span className="muted">(optional)</span>
        <input name="note" maxLength={500} placeholder="Opened 2 new cans" />
      </label>
      <Feedback state={state} />
      <SubmitButton pendingText="Saving…">Record ball use</SubmitButton>
    </form>
  );
}

export function ReverseConsumptionForm({ groupId, consumptionId }: { groupId: string; consumptionId: string }) {
  const [state, action] = useActionState(reverseConsumption, undefined);
  return (
    <details>
      <summary className="small">Reverse this ball use</summary>
      <form action={action} className="stack">
        <input type="hidden" name="group_id" value={groupId} />
        <input type="hidden" name="consumption_id" value={consumptionId} />
        <label>
          Reason
          <input name="reason" required maxLength={500} placeholder="Recorded on the wrong day" />
        </label>
        <Feedback state={state} />
        <SubmitButton className="secondary" pendingText="Reversing…">Reverse ball use</SubmitButton>
      </form>
    </details>
  );
}

export function ReallocateForm({ groupId, consumptionId }: { groupId: string; consumptionId: string }) {
  const [state, action] = useActionState(reallocateConsumption, undefined);
  return (
    <form action={action} className="stack">
      <input type="hidden" name="group_id" value={groupId} />
      <input type="hidden" name="consumption_id" value={consumptionId} />
      <label>
        Reason
        <input name="reason" required maxLength={500} defaultValue="Attendance was corrected" />
      </label>
      <Feedback state={state} />
      <SubmitButton pendingText="Re-splitting…">Re-split the cost</SubmitButton>
    </form>
  );
}
