"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { friendlyError } from "@/lib/errors";
import type { FormState } from "@/lib/form";
import { siteOrigin } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";

export async function createGroup(_prev: FormState, formData: FormData): Promise<FormState> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Give the group a name." };
  const backdate = Number(formData.get("backdate_days") ?? 14);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_group", {
    p_name: name,
    p_sport: String(formData.get("sport") ?? "tennis"),
    p_timezone: String(formData.get("timezone") ?? ""),
    p_currency: String(formData.get("currency") ?? "").trim().toUpperCase(),
    p_idempotency_key: String(formData.get("idempotency_key") ?? ""),
    p_backdate_days: Number.isFinite(backdate) ? backdate : 14,
  });
  if (error) return { error: friendlyError(error) };
  redirect(`/groups/${data}`);
}

export async function createInvite(_prev: FormState, formData: FormData): Promise<FormState> {
  const groupId = String(formData.get("group_id"));
  const hours = Number(formData.get("expires_in_hours") ?? 168);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_invite", {
    p_group_id: groupId,
    p_expires_in_hours: hours,
  });
  if (error) return { error: friendlyError(error) };
  const invite = (data as { token: string }[])[0];
  revalidatePath(`/groups/${groupId}`);
  return { inviteUrl: `${await siteOrigin()}/join/${invite.token}` };
}

export async function revokeInvite(formData: FormData) {
  const groupId = String(formData.get("group_id"));
  const supabase = await createClient();
  await supabase.rpc("revoke_invite", { p_invite_id: String(formData.get("invite_id")) });
  revalidatePath(`/groups/${groupId}`);
}

export async function setMemberRole(formData: FormData) {
  const groupId = String(formData.get("group_id"));
  const supabase = await createClient();
  await supabase.rpc("set_member_role", {
    p_group_id: groupId,
    p_user_id: String(formData.get("user_id")),
    p_role: String(formData.get("role")),
  });
  revalidatePath(`/groups/${groupId}`);
}

export async function removeMember(formData: FormData) {
  const groupId = String(formData.get("group_id"));
  const supabase = await createClient();
  await supabase.rpc("remove_member", {
    p_group_id: groupId,
    p_user_id: String(formData.get("user_id")),
  });
  revalidatePath(`/groups/${groupId}`);
}

export async function joinGroup(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("join_group_from_invite", {
    p_token: String(formData.get("token") ?? ""),
    p_idempotency_key: String(formData.get("idempotency_key") ?? ""),
  });
  if (error) return { error: friendlyError(error) };
  redirect(`/groups/${data}`);
}
