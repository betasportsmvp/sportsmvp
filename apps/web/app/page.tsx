import Image from "next/image";
import { redirect } from "next/navigation";
import { signInWithGoogle } from "@/app/auth/actions";
import { DevLoginForm } from "@/components/dev-login-form";
import { SubmitButton } from "@/components/submit-button";
import { appConfig } from "@/lib/config";
import { safeNextPath } from "@/lib/redirect";
import { getUser } from "@/lib/supabase/server";

const errors: Record<string, string> = {
  oauth: "We couldn't start Google sign-in. Please try again.",
  callback: "Sign-in didn't complete. Please try again.",
};

export default async function Welcome({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null);
  const error = typeof params.error === "string" ? errors[params.error] : undefined;

  if (await getUser()) redirect(next);

  return (
    <main>
      <section className="hero">
        <Image className="mark" src="/icon.svg" alt="" width={72} height={72} priority />
        <h1>{appConfig.name}</h1>
        <p className="muted">{appConfig.tagline}</p>
        {error && <p className="alert" role="alert">{error}</p>}
        <form action={signInWithGoogle}>
          <input type="hidden" name="next" value={next} />
          <SubmitButton className="block" pendingText="Opening Google…">
            Continue with Google
          </SubmitButton>
        </form>
        {appConfig.devLoginEnabled && <DevLoginForm next={next} />}
      </section>
      <footer className="legal muted">
        {appConfig.termsUrl ? <a href={appConfig.termsUrl}>Terms</a> : <span>Terms (coming soon)</span>}
        {appConfig.privacyUrl ? <a href={appConfig.privacyUrl}>Privacy</a> : <span>Privacy (coming soon)</span>}
      </footer>
    </main>
  );
}
