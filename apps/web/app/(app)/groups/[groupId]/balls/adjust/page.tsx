import type { Metadata } from "next";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { getGroupContext } from "@/lib/groups";
import { loadItems } from "@/lib/inventory";
import { getUser } from "@/lib/supabase/server";
import { AdjustForm } from "../forms";

export const metadata: Metadata = { title: "Correct stock" };

export default async function AdjustPage({ params }: PageProps<"/groups/[groupId]/balls/adjust">) {
  const { groupId } = await params;
  const user = (await getUser())!;
  const ctx = await getGroupContext(groupId, user.id);
  if (!ctx) notFound();

  return (
    <>
      <p><Link href={`/groups/${groupId}/balls`}>← Balls</Link></p>
      <h2>Correct stock</h2>
      {ctx.isAdmin ? (
        <>
          <p className="muted">
            Use this when the count is off, for example lost or found cans. It&apos;s recorded with your name and
            reason, and the history keeps every change.
          </p>
          <AdjustForm groupId={groupId} items={await loadItems(groupId)} idempotencyKey={randomUUID()} />
        </>
      ) : (
        <p className="notice">Only group admins can correct stock. Ask an admin if the count looks wrong.</p>
      )}
    </>
  );
}
