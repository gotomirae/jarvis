import { describe, expect, it } from "vitest";
import { briefDate, briefDayOk, briefSlotOk, isFirstSaturdayOfQuarter, kstDate, kstString, slotTimeOk } from "./time";

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

describe("briefDayOk (D71 — 토·일 브리핑 쉼)", () => {
  it("평일만 발송, 요일 설정 없으면 매일", () => {
    const wd = [1, 2, 3, 4, 5];
    expect(briefDayOk("2026-10-09", wd)).toBe(true);    // 금
    expect(briefDayOk("2026-10-10", wd)).toBe(false);   // 토
    expect(briefDayOk("2026-10-11", wd)).toBe(false);   // 일
    expect(briefDayOk("2026-10-12", wd)).toBe(true);    // 월
    expect(briefDayOk("2026-10-11")).toBe(true);
    // 금요일 저녁 브리핑이 자정 넘어 토요일 새벽에 늦게 돌아도 브리핑 날짜는 금요일
    expect(briefDayOk(briefDate("evening", new Date("2026-10-10T01:30:00+09:00")), wd)).toBe(true);
  });
});

describe("briefSlotOk (지연된 예비 실행)", () => {
  const at = (kst: string) => new Date(`${kst}+09:00`);
  it("저녁 예비가 자정 넘어 돌면 다음 날 슬롯을 거부", () => {
    expect(briefSlotOk("evening", "2026-10-02", at("2026-10-02T02:08:00"))).toBe(false);
    expect(briefSlotOk("evening", "2026-10-01", at("2026-10-02T02:08:00"))).toBe(true);
    expect(briefSlotOk("evening", "2026-10-02", at("2026-10-02T19:45:00"))).toBe(true);
    expect(briefSlotOk("morning", "2026-10-02", at("2026-10-02T07:50:00"))).toBe(true);
    expect(briefSlotOk("morning", "manual-x", at("2026-10-02T07:50:00"))).toBe(true);
    expect(briefSlotOk("morning", "2026-10-02")).toBeTypeOf("boolean");
  });
});

describe("memoWeek", async () => {
  const { memoWeek } = await import("./time");
  it("토·일은 이번 주, 평일은 지난주 — ISO 주차", () => {
    expect(memoWeek(new Date("2026-10-03T09:30:00+09:00"))).toEqual({ week: "2026-W40", start: "2026-09-28", end: "2026-10-02" });
    expect(memoWeek(new Date("2026-10-04T09:30:00+09:00")).week).toBe("2026-W40");
    expect(memoWeek(new Date("2026-10-05T09:30:00+09:00")).end).toBe("2026-10-02");
    expect(memoWeek(new Date("2026-10-09T23:00:00+09:00")).end).toBe("2026-10-02");
    expect(memoWeek(new Date("2027-01-02T09:30:00+09:00"))).toEqual({ week: "2026-W53", start: "2026-12-28", end: "2027-01-01" });
    expect(memoWeek().week).toMatch(/^\d{4}-W\d{2}$/);
  });
});
