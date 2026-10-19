"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isIsoDate } from "@/lib/dates";
import { friendlyError } from "@/lib/errors";
import type { FormState } from "@/lib/form";
import { parseMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const receiptTypes: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
};

function int(value: FormDataEntryValue | null): number | null {
  const n = Number(value);
  return typeof value === "string" && value.trim() !== "" && Number.isInteger(n) ? n : null;
}

export async function recordPurchase(_prev: FormState, formData: FormData): Promise<FormState> {
  const groupId = String(formData.get("group_id") ?? "");
  const currency = String(formData.get("currency") ?? "INR");
  const quantity = int(formData.get("quantity"));
  const total = parseMoney(formData.get("total"), currency);
  const purchasedOn = formData.get("purchased_on");
  if (!quantity || quantity < 1) return { error: "Enter how many you bought." };
  if (!total) return { error: "Enter the total price, for example 1200 or 1,200.50." };
  if (!isIsoDate(purchasedOn)) return { error: "Choose the purchase date." };

  const supabase = await createClient();

  let receiptPath: string | null = null;
  const receipt = formData.get("receipt");
  if (receipt instanceof File && receipt.size > 0) {
    const ext = receiptTypes[receipt.type];
    if (!ext) return { error: "Receipts can be a photo (JPG, PNG, WebP, HEIC) or a PDF." };
    if (receipt.size > MAX_RECEIPT_BYTES) return { error: "That receipt is larger than 5 MB." };
    receiptPath = `${groupId}/${randomUUID()}.${ext}`;
    const { error } = await supabase.storage
      .from("receipts")
      .upload(receiptPath, receipt, { contentType: receipt.type, upsert: false });
    if (error) return { error: "We couldn't upload the receipt. Try again, or save without it." };
  }

  const { error } = await supabase.rpc("record_purchase", {
    p_group_id: groupId,
    p_item_id: String(formData.get("item_id") ?? ""),
    p_purchaser_id: String(formData.get("purchaser_id") ?? ""),
    p_quantity: quantity,
    p_total_minor: total,
    p_purchased_on: purchasedOn,
    p_note: String(formData.get("note") ?? ""),
    p_receipt_path: receiptPath,
    p_idempotency_key: String(formData.get("idempotency_key") ?? ""),
  });
  if (error) return { error: friendlyError(error) };

  revalidatePath(`/groups/${groupId}`, "layout");
  redirect(`/groups/${groupId}/balls`);
}

export async function adjustInventory(_prev: FormState, formData: FormData): Promise<FormState> {
  const groupId = String(formData.get("group_id") ?? "");
  const quantity = int(formData.get("quantity"));
  const direction = formData.get("direction") === "add" ? 1 : -1;
  if (!quantity || quantity < 1) return { error: "Enter how many to add or remove." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("adjust_inventory", {
    p_group_id: groupId,
    p_item_id: String(formData.get("item_id") ?? ""),
    p_quantity_delta: direction * quantity,
    p_reason: String(formData.get("reason") ?? ""),
    p_idempotency_key: String(formData.get("idempotency_key") ?? ""),
  });
  if (error) return { error: friendlyError(error) };

  revalidatePath(`/groups/${groupId}`, "layout");
  redirect(`/groups/${groupId}/balls`);
}

export async function reversePurchase(_prev: FormState, formData: FormData): Promise<FormState> {
  const groupId = String(formData.get("group_id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("reverse_purchase", {
    p_purchase_id: String(formData.get("purchase_id") ?? ""),
    p_reason: String(formData.get("reason") ?? ""),
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath(`/groups/${groupId}`, "layout");
  return { message: "Purchase reversed." };
}

export async function saveItem(_prev: FormState, formData: FormData): Promise<FormState> {
  const groupId = String(formData.get("group_id") ?? "");
  const itemId = formData.get("item_id");
  const name = String(formData.get("name") ?? "").trim();
  const threshold = int(formData.get("reorder_threshold"));
  if (!name) return { error: "Give the item a name." };

  const supabase = await createClient();
  const { error } = itemId
    ? await supabase.rpc("update_item", { p_item_id: String(itemId), p_name: name, p_reorder_threshold: threshold })
    : await supabase.rpc("create_item", {
        p_group_id: groupId,
        p_name: name,
        p_unit: String(formData.get("unit") ?? "can"),
        p_reorder_threshold: threshold,
      });
  if (error) return { error: friendlyError(error) };
  revalidatePath(`/groups/${groupId}`, "layout");
  return { message: itemId ? "Saved." : "Item added." };
}
