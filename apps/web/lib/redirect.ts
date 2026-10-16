/**
 * Returns `next` only when it is a same-origin path, so sign-in links can't be used to
 * bounce users to another site.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/groups"): string {
  if (!next || typeof next !== "string") return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f]/.test(next)) return fallback;
  return next;
}
