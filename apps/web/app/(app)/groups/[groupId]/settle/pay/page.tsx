import type { Metadata } from "next";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { localDate } from "@/lib/dates";
import { getGroupContext } from "@/lib/groups";
import { currencyDigits } from "@/lib/money";
import { getUser } from "@/lib/supabase/server";
import { PaymentForm } from "../forms";

export const metadata: Metadata = { title: "Record payment" };

export default async function PayPage({ params, searchParams }: PageProps<"/groups/[groupId]/settle/pay">) {
  const { groupId } = await params;
  const query = await searchParams;
  const user = (await getUser())!;
  const ctx = await getGroupContext(groupId, user.id);
  if (!ctx) notFound();
  const { group, members, isAdmin } = ctx;

  const member = (v: unknown) => (typeof v === "string" && members.some((m) => m.user_id === v) ? v : undefined);
  const minor = typeof query.amount === "string" && /^\d{1,13}$/.test(query.amount) ? Number(query.amount) : null;
  const digits = currencyDigits(group.currency);
  const amount = minor === null ? undefined : (minor / 10 ** digits).toFixed(minor % 10 ** digits ? digits : 0);

  return (
    <>
      <p><Link href={`/groups/${groupId}/settle`}>← Settle</Link></p>
      <h2>Record a payment</h2>
      <p className="muted">
        Record money members paid each other outside the app, by cash or UPI. The app doesn&apos;t move any money.
        Payments update everyone&apos;s balance and are kept in the history.
      </p>
      <PaymentForm
        groupId={groupId}
        currency={group.currency}
        members={members}
        viewerId={user.id}
        isAdmin={isAdmin}
        payer={member(query.payer)}
        payee={member(query.payee)}
        amount={amount}
        today={localDate(group.timezone)}
        idempotencyKey={randomUUID()}
      />
    </>
  );
}
