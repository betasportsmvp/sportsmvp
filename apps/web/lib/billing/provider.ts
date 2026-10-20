// The seam a real billing provider will plug into later. During the private beta only the
// fake provider exists: nothing collects cards or opens a checkout.

export type BillingEventType =
  | "subscription.activated"
  | "subscription.renewed"
  | "subscription.past_due"
  | "subscription.canceled"
  | "subscription.expired"
  | "subscription.revoked";

/** A provider's webhook event, normalised to what public.apply_billing_event() expects. */
export type BillingEvent = {
  provider: string;
  eventId: string;
  type: BillingEventType;
  payload: {
    group_id?: string;
    plan_code?: string;
    customer_id?: string;
    subscription_id: string;
    current_period_start?: string;
    current_period_end?: string | null;
  };
};

export interface BillingProvider {
  readonly name: string;
  /** Verifies the signature and normalises the event. Throws on a bad signature or body. */
  parseWebhook(rawBody: string, signature: string | null): BillingEvent;
  /** Starts a purchase. Not available during the beta. */
  createCheckout(input: { groupId: string; planCode: string }): Promise<{ url: string }>;
}

export class CheckoutUnavailableError extends Error {
  constructor() {
    super("checkout_unavailable");
  }
}

export type ApplyBillingEvent = (event: BillingEvent) => Promise<"processed" | "duplicate" | "ignored">;

/**
 * Handles one webhook delivery. Retries of the same event are safe: the database records
 * each provider event id once and reports a repeat as "duplicate".
 */
export async function handleBillingWebhook(
  provider: BillingProvider,
  rawBody: string,
  signature: string | null,
  apply: ApplyBillingEvent,
): Promise<{ status: number; outcome?: string }> {
  let event: BillingEvent;
  try {
    event = provider.parseWebhook(rawBody, signature);
  } catch {
    return { status: 400 };
  }
  return { status: 200, outcome: await apply(event) };
}
