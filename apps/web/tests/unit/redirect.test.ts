import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/redirect";

describe("safeNextPath", () => {
  it.each(["/groups", "/join/abc123", "/groups/1?tab=members"])("keeps same-origin path %s", (p) => {
    expect(safeNextPath(p)).toBe(p);
  });

  it.each([
    null,
    "",
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "/groups\n",
  ])("falls back for %s", (p) => {
    expect(safeNextPath(p as string | null)).toBe("/groups");
  });
});
