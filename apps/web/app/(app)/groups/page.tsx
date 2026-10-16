import type { Metadata } from "next";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { listMyGroups } from "@/lib/groups";
import { getUser } from "@/lib/supabase/server";
import { CreateGroupForm } from "./create-group-form";

export const metadata: Metadata = { title: "Your groups" };

export default async function GroupsPage() {
  const user = (await getUser())!;
  const groups = await listMyGroups(user.id);
  const timezones = Intl.supportedValuesOf("timeZone");

  return (
    <main>
      <h1>Your groups</h1>
      {groups.length === 0 ? (
        <p className="muted">You&apos;re not in a group yet. Create one, or open an invite link from your group admin.</p>
      ) : (
        <ul className="list card">
          {groups.map((g) => (
            <li key={g.id} className="row">
              <Link href={`/groups/${g.id}`}>{g.name}</Link>
              <span className="badge">{g.role}</span>
            </li>
          ))}
        </ul>
      )}
      <h2>Create a group</h2>
      <CreateGroupForm timezones={timezones} idempotencyKey={randomUUID()} />
    </main>
  );
}
