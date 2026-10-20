"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isIsoDate } from "@/lib/dates";
import { friendlyError } from "@/lib/errors";
import type { FormState } from "@/lib/form";
import { parseMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

export async function recordPayment(_prev: FormState, formData: FormData): Promise<FormState> {
  const groupId = String(formData.get("group_id") ?? "");
  const payer = String(formData.get("payer_id") ?? "");
  const payee = String(formData.get("payee_id") ?? "");
  const amount = parseMoney(formData.get("amount"), String(formData.get("currency") ?? "INR"));
  const paidOn = formData.get("paid_on");
  if (!payer || !payee || payer === payee) return { error: "Choose two different people: who paid and who received it." };
  if (!amount) return { error: "Enter the amount paid, for example 400 or 1,200.50." };
  if (!isIsoDate(paidOn)) return { error: "Choose the date it was paid." };
  if (formData.get("confirmed") !== "on") return { error: "Tick the box to confirm this payment really happened." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_payment", {
    p_group_id: groupId,
    p_payer_id: payer,
    p_payee_id: payee,
    p_amount_minor: amount,
    p_paid_on: paidOn,
    p_note: String(formData.get("note") ?? ""),
    p_confirmed: true,
    p_idempotency_key: String(formData.get("idempotency_key") ?? ""),
  });
  if (error) return { error: friendlyError(error) };

  revalidatePath(`/groups/${groupId}`, "layout");
  redirect(`/groups/${groupId}/settle`);
}

export async function reversePayment(_prev: FormState, formData: FormData): Promise<FormState> {
  const groupId = String(formData.get("group_id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("reverse_payment", {
    p_payment_id: String(formData.get("payment_id") ?? ""),
    p_reason: String(formData.get("reason") ?? ""),
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath(`/groups/${groupId}`, "layout");
  return { message: "Payment reversed. Balances no longer count it; record the right payment if one was made." };
}

export async function setSettlementLead(_prev: FormState, formData: FormData): Promise<FormState> {
  const groupId = String(formData.get("group_id") ?? "");
  const lead = String(formData.get("lead_id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_settlement_lead", { p_group_id: groupId, p_user_id: lead || null });
  if (error) return { error: friendlyError(error) };
  revalidatePath(`/groups/${groupId}`, "layout");
  return { message: lead ? "Settlement lead saved." : "Back to the default: the person owed the most." };
}
