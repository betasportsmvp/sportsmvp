import Link from "next/link";
import { redirect } from "next/navigation";
import { appConfig } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await getUser();
  if (!user) redirect("/");

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, email")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <>
      <header className="topbar">
        <Link href="/groups" className="brand">{appConfig.name}</Link>
        <div className="row">
          <span className="muted" aria-label="Signed in as">{profile?.display_name || profile?.email || user.email}</span>
          <form action="/auth/sign-out" method="post">
            <button type="submit" className="quiet">Sign out</button>
          </form>
        </div>
      </header>
      {children}
    </>
  );
}
