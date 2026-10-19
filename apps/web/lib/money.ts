/** Money is always stored as integer minor units (paise, cents). These helpers convert at the edges. */

export function currencyDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** Parses "1,200.50" into minor units for `currency`, or null if it isn't a valid amount. */
export function parseMoney(input: unknown, currency: string): number | null {
  if (typeof input !== "string") return null;
  const cleaned = input.replace(/[\s,]/g, "");
  const digits = currencyDigits(currency);
  const pattern = digits > 0 ? new RegExp(`^(\\d{1,12})(?:\\.(\\d{0,${digits}}))?$`) : /^(\d{1,12})$/;
  const match = pattern.exec(cleaned);
  if (!match) return null;
  const fraction = (match[2] ?? "").padEnd(digits, "0");
  return Number(match[1]) * 10 ** digits + Number(fraction || 0);
}

export function formatMoney(minor: number, currency: string, locale = "en-IN"): string {
  const digits = currencyDigits(currency);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: minor % 10 ** digits === 0 ? 0 : digits,
      maximumFractionDigits: digits,
    }).format(minor / 10 ** digits);
  } catch {
    return `${(minor / 10 ** digits).toFixed(digits)} ${currency}`;
  }
}
