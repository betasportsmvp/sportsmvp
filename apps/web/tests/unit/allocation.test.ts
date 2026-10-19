import { describe, expect, it } from "vitest";
import { allocationIsStale, equalSplit } from "@/lib/allocation";

describe("allocationIsStale", () => {
  it("is false when the same people are charged and present", () => {
    expect(allocationIsStale(["a", "b"], ["b", "a"])).toBe(false);
  });

  it("is true when someone joined, dropped out or was swapped", () => {
    expect(allocationIsStale(["a"], ["a", "b"])).toBe(true);
    expect(allocationIsStale(["a", "b"], ["a"])).toBe(true);
    expect(allocationIsStale(["a", "b"], ["a", "c"])).toBe(true);
    expect(allocationIsStale(["a"], [])).toBe(true);
  });
});

describe("equalSplit", () => {
  it("matches the database rule in whole minor units", () => {
    expect(equalSplit(10000, 3)).toEqual({ base: 3333, extra: 1 });
    expect(equalSplit(9000, 2)).toEqual({ base: 4500, extra: 0 });
  });
});
