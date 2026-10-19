import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Redirects a group member to a short-lived signed link for a purchase's receipt. */
export async function GET(_req: Request, ctx: RouteContext<"/groups/[groupId]/balls/receipt/[purchaseId]">) {
  const { groupId, purchaseId } = await ctx.params;
  const supabase = await createClient();
  const { data: purchase } = await supabase
    .from("purchases")
    .select("receipt_path")
    .eq("id", purchaseId)
    .eq("group_id", groupId)
    .maybeSingle();
  if (!purchase?.receipt_path) return new NextResponse("Not found", { status: 404 });

  const { data, error } = await supabase.storage.from("receipts").createSignedUrl(purchase.receipt_path, 60);
  if (error || !data) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}
