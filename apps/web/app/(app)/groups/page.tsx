import type { Metadata } from "next";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { listMyGroups } from "@/lib/groups";
import { getUser } from "@/lib/supabase/server";
import { CreateGroupForm } from "./create-group-form";

export const metadata: Metadata = { title: "Your groups" };

export default async function GroupsPage({ searchParams }: PageProps<"/groups">) {
  const user = (await getUser())!;
  const groups = await listMyGroups(user.id);
  // With a single group, open its Today screen straight away so check-in is one tap.
  if (groups.length === 1 && !(await searchParams).all) redirect(`/groups/${groups[0].id}`);
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
