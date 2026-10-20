import { createHmac, timingSafeEqual } from "node:crypto";
import { type BillingEvent, type BillingProvider, CheckoutUnavailableError } from "./provider";

const eventTypes = new Set<string>([
  "subscription.activated",
  "subscription.renewed",
  "subscription.past_due",
  "subscription.canceled",
  "subscription.expired",
  "subscription.revoked",
]);

/**
 * A stand-in provider for tests and local development. Events are JSON signed with an
 * HMAC-SHA256 of the body: `{ id, type, data }`.
 */
export class FakeBillingProvider implements BillingProvider {
  readonly name = "fake";

  constructor(private readonly secret: string) {}

  sign(rawBody: string): string {
    return createHmac("sha256", this.secret).update(rawBody).digest("hex");
  }

  parseWebhook(rawBody: string, signature: string | null): BillingEvent {
    const expected = Buffer.from(this.sign(rawBody));
    const given = Buffer.from(signature ?? "");
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw new Error("invalid_signature");
    }
    const body = JSON.parse(rawBody) as { id?: unknown; type?: unknown; data?: unknown };
    if (typeof body.id !== "string" || typeof body.type !== "string" || !eventTypes.has(body.type)) {
      throw new Error("invalid_event");
    }
    const data = (body.data ?? {}) as BillingEvent["payload"];
    if (typeof data.subscription_id !== "string") throw new Error("invalid_event");
    return { provider: this.name, eventId: body.id, type: body.type as BillingEvent["type"], payload: data };
  }

  async createCheckout(): Promise<{ url: string }> {
    throw new CheckoutUnavailableError();
  }
}
