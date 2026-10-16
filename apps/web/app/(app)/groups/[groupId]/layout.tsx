import Link from "next/link";
import { notFound } from "next/navigation";
import { GroupTabs } from "@/components/group-tabs";
import { getGroupContext } from "@/lib/groups";
import { getUser } from "@/lib/supabase/server";

export default async function GroupLayout({ children, params }: LayoutProps<"/groups/[groupId]">) {
  const { groupId } = await params;
  const user = (await getUser())!;
  const ctx = await getGroupContext(groupId, user.id);
  if (!ctx) notFound();

  return (
    <>
      <main className="with-tabs">
        <div className="row">
          <h1>{ctx.group.name}</h1>
          <Link href="/groups?all=1" className="muted">Switch group</Link>
        </div>
        {children}
      </main>
      <GroupTabs groupId={groupId} />
    </>
  );
}
