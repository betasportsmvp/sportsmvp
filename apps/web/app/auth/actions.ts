"use server";

import { redirect } from "next/navigation";
import { appConfig } from "@/lib/config";
import type { FormState } from "@/lib/form";
import { safeNextPath } from "@/lib/redirect";
import { siteOrigin } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";

function callbackUrl(origin: string, next: string) {
  return `${origin}/auth/callback?next=${encodeURIComponent(next)}`;
}

export async function signInWithGoogle(formData: FormData) {
  const next = safeNextPath(formData.get("next") as string | null);
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: callbackUrl(await siteOrigin(), next),
      queryParams: { prompt: "select_account" },
    },
  });
  if (error || !data.url) redirect(`/?error=oauth&next=${encodeURIComponent(next)}`);
  redirect(data.url);
}

/** Local development only: email link sign-in for the seeded test users. */
export async function signInWithDevEmail(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!appConfig.devLoginEnabled) return { error: "Email sign-in is turned off." };
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter an email address." };
  const next = safeNextPath(formData.get("next") as string | null);
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: callbackUrl(await siteOrigin(), next), shouldCreateUser: true },
  });
  if (error) return { error: "Couldn't send the sign-in link. Is local Supabase running?" };
  return { message: "Sign-in link sent. Open the local mail inbox (http://127.0.0.1:54324) to use it." };
}
