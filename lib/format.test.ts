import { describe, expect, it } from "vitest";
import { fmtDate, fmtNum, fmtPct, fmtWeight } from "./format";

describe("format", () => {
  it("formats numbers defensively", () => {
    expect(fmtPct(12.345)).toBe("+12.3%");
    expect(fmtPct(-1, 0)).toBe("-1%");
    expect(fmtPct(null)).toBe("-");
    expect(fmtPct(NaN)).toBe("-");
    expect(fmtNum(1234567)).toBe("1,234,567");
    expect(fmtNum(undefined)).toBe("-");
    expect(fmtWeight(0.078)).toBe("7.8%");
    expect(fmtWeight(null)).toBe("-");
    expect(fmtDate("2026-09-29T00:00:00Z")).toBe("2026-09-29");
    expect(fmtDate(null)).toBe("-");
  });
});
