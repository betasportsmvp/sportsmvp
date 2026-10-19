import { describe, expect, it } from "vitest";
import { currencyDigits, formatMoney, parseMoney } from "@/lib/money";

describe("parseMoney", () => {
  it("turns typed amounts into integer minor units", () => {
    expect(parseMoney("1200", "INR")).toBe(120000);
    expect(parseMoney("1,200.5", "INR")).toBe(120050);
    expect(parseMoney(" 99.99 ", "USD")).toBe(9999);
    expect(parseMoney("0.07", "INR")).toBe(7);
  });

  it("respects currencies without minor units", () => {
    expect(currencyDigits("JPY")).toBe(0);
    expect(parseMoney("500", "JPY")).toBe(500);
    expect(parseMoney("500.5", "JPY")).toBeNull();
  });

  it("rejects anything that isn't a plain amount", () => {
    for (const bad of ["", "abc", "-5", "1.234", "1e3", "12.3.4", undefined]) {
      expect(parseMoney(bad, "INR")).toBeNull();
    }
  });
});

describe("formatMoney", () => {
  it("shows whole amounts without decimals and keeps paise when present", () => {
    expect(formatMoney(120000, "INR")).toBe("₹1,200");
    expect(formatMoney(120050, "INR")).toBe("₹1,200.50");
  });
});
