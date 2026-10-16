import type { Metadata } from "next";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { friendlyError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { JoinForm } from "./join-form";

export const metadata: Metadata = { title: "Join a group" };

type Preview = { group_id: string; group_name: string; sport: string; member_count: number; already_member: boolean };

export default async function JoinPage({ params }: PageProps<"/join/[token]">) {
  const { token } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_invite_preview", { p_token: token });
  const preview = (data as Preview[] | null)?.[0];

  if (error || !preview) {
    return (
      <main>
        <h1>Invite not available</h1>
        <p className="alert" role="alert">{friendlyError(error ?? { message: "invite_invalid" })}</p>
        <p><Link href="/groups">Go to your groups</Link></p>
      </main>
    );
  }

  return (
    <main>
      <h1>Join {preview.group_name}?</h1>
      <div className="card stack">
        <p className="muted">
          {preview.sport} · {preview.member_count} {preview.member_count === 1 ? "member" : "members"}
        </p>
        {preview.already_member ? (
          <Link className="button block" href={`/groups/${preview.group_id}`}>You&apos;re already a member. Open group</Link>
        ) : (
          <JoinForm token={token} idempotencyKey={randomUUID()} />
        )}
      </div>
    </main>
  );
}
