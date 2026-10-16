/**
 * Product identity. "Beta" is a temporary display name: every user-facing name, link and
 * contact lives here so a rename is an environment change, not a code change.
 */
export const appConfig = {
  name: process.env.NEXT_PUBLIC_APP_NAME || "Beta",
  tagline:
    process.env.NEXT_PUBLIC_APP_TAGLINE ||
    "Show up, track shared balls, and settle costs fairly from who actually played.",
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "",
  termsUrl: process.env.NEXT_PUBLIC_TERMS_URL || "",
  privacyUrl: process.env.NEXT_PUBLIC_PRIVACY_URL || "",
  themeColor: "#14532d",
  /** Local-only email sign-in for seeded test users. Never enable in staging/production. */
  devLoginEnabled: process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN === "true",
} as const;

export const groupDefaults = {
  sport: "tennis",
  timezone: "Asia/Kolkata",
  currency: "INR",
  backdateDays: 14,
} as const;
