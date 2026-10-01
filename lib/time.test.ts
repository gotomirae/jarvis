import { describe, expect, it } from "vitest";
import { briefDate, isFirstSaturdayOfQuarter, kstDate, kstString, slotTimeOk } from "./time";

describe("time", () => {
  it("formats KST", () => {
    const d = new Date("2026-09-27T16:30:00Z");
    expect(kstString(d)).toBe("2026-09-28 01:30");
    expect(kstDate(d)).toBe("2026-09-28");
    expect(kstString()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(kstDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("briefDate / slotTimeOk (D48)", () => {
  const at = (kst: string) => new Date(`${kst}+09:00`);
  it("저녁 브리핑은 정오 전 실행이면 전날분", () => {
    expect(briefDate("evening", at("2026-10-01T01:30:00"))).toBe("2026-09-30");
    expect(briefDate("evening", at("2026-10-01T19:20:00"))).toBe("2026-10-01");
    expect(briefDate("morning", at("2026-10-01T07:30:00"))).toBe("2026-10-01");
    expect(briefDate("morning")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("정시 슬롯 이름과 실행 시각이 맞아야 함", () => {
    expect(slotTimeOk("2026-10-01-am", at("2026-10-01T01:30:00"))).toBe(false);
    expect(slotTimeOk("2026-10-01-am", at("2026-10-01T07:12:00"))).toBe(true);
    expect(slotTimeOk("2026-10-01-am", at("2026-10-01T13:00:00"))).toBe(false);
    expect(slotTimeOk("2026-10-01-pm", at("2026-10-01T16:10:00"))).toBe(true);
    expect(slotTimeOk("2026-10-01-pm", at("2026-10-01T11:00:00"))).toBe(false);
    expect(slotTimeOk("2026-10-02-am", at("2026-10-01T07:12:00"))).toBe(false);
    expect(slotTimeOk("2026-10-01-daily", at("2026-10-01T01:30:00"))).toBe(true);
    expect(slotTimeOk("manual-x")).toBe(true);
  });
});

describe("isFirstSaturdayOfQuarter", () => {
  it("1·4·7·10월 첫 토요일(KST)만", () => {
    expect(isFirstSaturdayOfQuarter(new Date("2027-01-02T10:30:00+09:00"))).toBe(true);
    expect(isFirstSaturdayOfQuarter(new Date("2027-01-09T10:30:00+09:00"))).toBe(false);
    expect(isFirstSaturdayOfQuarter(new Date("2027-02-06T10:30:00+09:00"))).toBe(false);
    expect(isFirstSaturdayOfQuarter(new Date("2027-01-01T10:30:00+09:00"))).toBe(false);
    expect(typeof isFirstSaturdayOfQuarter()).toBe("boolean");
  });
});
