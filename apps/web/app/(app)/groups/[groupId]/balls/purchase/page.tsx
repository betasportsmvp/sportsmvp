import type { Metadata } from "next";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { localDate } from "@/lib/dates";
import { getGroupContext } from "@/lib/groups";
import { loadItems } from "@/lib/inventory";
import { getUser } from "@/lib/supabase/server";
import { PurchaseForm } from "../forms";

export const metadata: Metadata = { title: "Add purchase" };

export default async function PurchasePage({ params }: PageProps<"/groups/[groupId]/balls/purchase">) {
  const { groupId } = await params;
  const user = (await getUser())!;
  const ctx = await getGroupContext(groupId, user.id);
  if (!ctx) notFound();
  const items = await loadItems(groupId);

  return (
    <>
      <p><Link href={`/groups/${groupId}/balls`}>← Balls</Link></p>
      <h2>Add purchase</h2>
      <PurchaseForm
        groupId={groupId}
        currency={ctx.group.currency}
        items={items}
        members={ctx.members}
        viewerId={user.id}
        isAdmin={ctx.isAdmin}
        today={localDate(ctx.group.timezone)}
        idempotencyKey={randomUUID()}
      />
    </>
  );
}
