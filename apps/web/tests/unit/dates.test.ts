import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  attendanceEditPolicy,
  isIsoDate,
  isIsoMonth,
  localDate,
  monthGrid,
  monthRange,
} from "@/lib/dates";

describe("localDate", () => {
  // 18:45 UTC on 16 Oct is already 17 Oct in India and still 16 Oct in New York.
  const instant = new Date("2026-10-16T18:45:00Z");

  it("uses the group's timezone, not the server's", () => {
    expect(localDate("Asia/Kolkata", instant)).toBe("2026-10-17");
    expect(localDate("America/New_York", instant)).toBe("2026-10-16");
    expect(localDate("UTC", instant)).toBe("2026-10-16");
  });

  it("flips at local midnight", () => {
    expect(localDate("Asia/Kolkata", new Date("2026-10-16T18:29:59Z"))).toBe("2026-10-16");
    expect(localDate("Asia/Kolkata", new Date("2026-10-16T18:30:00Z"))).toBe("2026-10-17");
  });
});

describe("date arithmetic", () => {
  it("adds days across month, year and DST boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("adds months and finds month ranges", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(monthRange("2026-02")).toEqual({ first: "2026-02-01", last: "2026-02-28" });
  });

  it("validates dates and months", () => {
    expect(isIsoDate("2026-10-16")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("16/10/2026")).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
    expect(isIsoMonth("2026-10")).toBe(true);
    expect(isIsoMonth("2026-13")).toBe(false);
  });
});

describe("monthGrid", () => {
  it("lays out weeks starting on Monday", () => {
    const weeks = monthGrid("2026-10"); // 1 Oct 2026 is a Thursday
    expect(weeks[0]).toEqual([null, null, null, "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(weeks.flat().filter(Boolean)).toHaveLength(31);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });
});

describe("attendanceEditPolicy", () => {
  const today = "2026-10-16";
  const base = { today, backdateDays: 14 };

  it("lets members edit today and the backdate window", () => {
    expect(attendanceEditPolicy({ ...base, date: today, isAdmin: false })).toBe("editable");
    expect(attendanceEditPolicy({ ...base, date: "2026-10-02", isAdmin: false })).toBe("editable");
    expect(attendanceEditPolicy({ ...base, date: "2026-10-01", isAdmin: false })).toBe("locked");
  });

  it("lets admins correct any past date", () => {
    expect(attendanceEditPolicy({ ...base, date: "2025-01-01", isAdmin: true })).toBe("editable");
  });

  it("rejects future dates for everyone", () => {
    expect(attendanceEditPolicy({ ...base, date: "2026-10-17", isAdmin: true })).toBe("future");
  });
});
