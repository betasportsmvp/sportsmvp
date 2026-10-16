import { describe, expect, it } from "vitest";
import { friendlyError } from "@/lib/errors";

describe("friendlyError", () => {
  it("maps known command errors", () => {
    expect(friendlyError({ message: "invite_invalid" })).toMatch(/invalid, expired/);
    expect(friendlyError({ message: "forbidden" })).toMatch(/permission/);
  });

  it("never echoes unknown database messages", () => {
    expect(friendlyError({ message: 'relation "secret_table" does not exist' })).toBe(
      "Something went wrong. Please try again.",
    );
    expect(friendlyError(null)).toBe("Something went wrong. Please try again.");
  });
});
