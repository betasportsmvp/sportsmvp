import type { Metadata } from "next";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { isIsoDate, localDate } from "@/lib/dates";
import { getGroupContext } from "@/lib/groups";
import { loadItems } from "@/lib/inventory";
import { getUser } from "@/lib/supabase/server";
import { UseForm } from "../forms";

export const metadata: Metadata = { title: "Record ball use" };

export default async function UsePage({ params, searchParams }: PageProps<"/groups/[groupId]/balls/use">) {
  const { groupId } = await params;
  const query = await searchParams;
  const user = (await getUser())!;
  const ctx = await getGroupContext(groupId, user.id);
  if (!ctx) notFound();

  const today = localDate(ctx.group.timezone);
  const date = isIsoDate(query.date) && query.date <= today ? query.date : today;

  return (
    <>
      <p><Link href={`/groups/${groupId}/balls`}>← Balls</Link></p>
      <h2>Record ball use</h2>
      {ctx.isAdmin ? (
        <>
          <p className="muted">
            The balls come out of stock, oldest purchase first, and their cost is split equally between everyone
            marked as playing that day. Mark attendance first.
          </p>
          <UseForm groupId={groupId} items={await loadItems(groupId)} date={date} today={today} idempotencyKey={randomUUID()} />
        </>
      ) : (
        <p className="notice">Only group admins can record ball use. Ask an admin to add it.</p>
      )}
    </>
  );
}
