"use client";

import { startTransition, useActionState, useEffect, useState, useSyncExternalStore } from "react";
import { recordAttendance } from "@/app/(app)/groups/[groupId]/attendance-actions";
import { statusLabel, type AttendanceStatus } from "@/lib/attendance-status";

type Props = {
  groupId: string;
  date: string;
  userId: string;
  status: AttendanceStatus | null;
  /** Whose attendance this is, for screen readers ("your", "Bob's"). */
  subject: string;
  labels?: { present: string; absent: string };
  compact?: boolean;
};

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/**
 * Two-button Present/Absent control. Each tap carries a fresh idempotency key; if the device
 * is offline the tap is held and sent with the same key once the connection returns.
 */
export function AttendanceToggle({
  groupId,
  date,
  userId,
  status,
  subject,
  labels = { present: "I'm playing", absent: "Not playing" },
  compact = false,
}: Props) {
  const [state, action, pending] = useActionState(recordAttendance, undefined);
  const [requested, setRequested] = useState<AttendanceStatus | null>(null);
  const [queued, setQueued] = useState<FormData | null>(null);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

  useEffect(() => {
    if (!queued) return;
    const send = () => {
      startTransition(() => action(queued));
      setQueued(null);
    };
    window.addEventListener("online", send);
    return () => window.removeEventListener("online", send);
  }, [queued, action]);

  function choose(next: AttendanceStatus) {
    const fd = new FormData();
    fd.set("group_id", groupId);
    fd.set("local_date", date);
    fd.set("user_id", userId);
    fd.set("status", next);
    fd.set("idempotency_key", crypto.randomUUID());
    setRequested(next);
    if (!navigator.onLine) {
      setQueued(fd);
      return;
    }
    startTransition(() => action(fd));
  }

  const shown = queued || pending ? requested : status;

  return (
    <div className={compact ? "toggle compact" : "toggle"}>
      <div className="toggle-buttons" role="group" aria-label={`Set ${subject} attendance`}>
        {(["present", "absent"] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={shown === s ? `choice selected ${s}` : "choice"}
            aria-pressed={shown === s}
            disabled={pending}
            onClick={() => choose(s)}
          >
            <span aria-hidden="true">{s === "present" ? "✓" : "✕"}</span> {labels[s]}
          </button>
        ))}
      </div>
      <p className="toggle-status" role="status" aria-live="polite">
        {queued
          ? `You're offline. "${statusLabel[queued.get("status") as AttendanceStatus]}" will be saved when you reconnect.`
          : pending
            ? "Saving…"
            : state?.error
              ? null
              : !online
                ? "You're offline. Changes will be saved when you reconnect."
                : null}
      </p>
      {state?.error && !pending && !queued && (
        <p className="alert" role="alert">{state.error}</p>
      )}
    </div>
  );
}
