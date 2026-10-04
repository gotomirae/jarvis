import { describe, expect, it } from "vitest";
import { cycleOf, phaseOf } from "./cycle";
import { attachQuarterly, indicatorSeries, monthsAgo, periodReturn, quarterEnd, quartersAgoStart, rebaseMerge, weekStart, weekWindow } from "./series";

const bar = (date: string, close: number) => ({ date, close });

describe("대시보드 시계열 (D56)", () => {
  it("monthsAgo · quarterEnd · quartersAgoStart · weekStart", () => {
    expect(monthsAgo("2026-10-05", 12)).toBe("2025-10-05");
    expect(quarterEnd(2026, 2)).toBe("2026-06-30");
    expect(quarterEnd(2025, 4)).toBe("2025-12-31");
    expect(quartersAgoStart("2026-10-05", 10)).toBe("2024-07-01");
    expect(quartersAgoStart("2026-02-10", 1)).toBe("2026-01-01");
    expect(weekStart("2026-10-05")).toBe("2026-10-05");   // 월
    expect(weekStart("2026-10-04")).toBe("2026-09-28");   // 일
    expect(weekStart("2026-10-09")).toBe("2026-10-05");   // 금
  });
  it("rebaseMerge: 첫 값 = 100, 날짜 합집합, 빈 시계열 건너뜀", () => {
    const m = rebaseMerge({ a: [bar("2026-01-01", 50), bar("2026-01-02", 55), bar("2026-01-05", 60)], b: [bar("2025-12-31", 1), bar("2026-01-02", 200), bar("2026-01-03", 210)], c: [] }, "2026-01-01");
    expect(m).toEqual([
      { date: "2026-01-01", a: 100, b: null, c: null },
      { date: "2026-01-02", a: 110, b: 100, c: null },
      { date: "2026-01-03", a: null, b: 105, c: null },
      { date: "2026-01-05", a: 120, b: null, c: null },
    ]);
  });
  it("periodReturn · weekWindow", () => {
    const xs = [bar("2026-09-29", 100), bar("2026-10-02", 110), bar("2026-10-05", 121), bar("2026-10-06", 99)];
    expect(periodReturn(xs, "2026-10-01")).toBeCloseTo(-10);
    expect(periodReturn(xs, "2026-10-06")).toBeNull();
    expect(weekWindow(xs)).toEqual({ start: "2026-10-05", end: "2026-10-06", change_pct: expect.closeTo(-10, 5) });
    expect(weekWindow([bar("2026-10-05", 1)])).toEqual({ start: "2026-10-05", end: "2026-10-05", change_pct: null });
    expect(weekWindow([])).toBeNull();
  });
  it("indicatorSeries: 예열 구간 제외·RSI 결측 앞부분 null · 분기 증가율 붙이기", () => {
    const bars = Array.from({ length: 60 }, (_, i) => bar(`2026-0${i < 30 ? 7 : 8}-${String((i % 30) + 1).padStart(2, "0")}`, 100 + Math.sin(i / 3) * 5 + i * 0.2));
    const all = indicatorSeries(bars, "2000-01-01", [12, 26, 9], 14);
    expect(all).toHaveLength(60);
    expect(all[0]).toMatchObject({ macd: 0, signal: 0, hist: 0, rsi: null, op_yoy: null });
    expect(all[14].rsi).not.toBeNull();
    const part = indicatorSeries(bars, "2026-08-01", [12, 26, 9], 14);
    expect(part[0].date).toBe("2026-08-01");
    const q = attachQuarterly(part, [{ fy: 2026, fq: 2, op_yoy: 12.345 }, { fy: 2026, fq: 3, op_yoy: 5 }, { fy: 2026, fq: 1, op_yoy: null }]);
    expect(q[0].op_yoy).toBe(12.3);    // 6/30 다음 첫 점
    expect(q.filter((p) => p.op_yoy !== null)).toHaveLength(1);   // 3분기말은 기간 밖
    expect(part[0].op_yoy).toBeNull();  // 원본은 그대로
  });
});

describe("🔄 섹터 주기", () => {
  const R = { ma_days: 20, momentum_days: 5, zscore_days: 250 };
  const wave = (n: number, phase: number) => Array.from({ length: n }, (_, i) => 100 + 10 * Math.sin(((i + phase) / 60) * 2 * Math.PI));
  it("사인 가격 → 위치 각도·구간", () => {
    const xs = wave(300, 0);
    const c = cycleOf(xs, R)!;
    expect(c.angle).toBeGreaterThanOrEqual(0);
    expect(c.angle).toBeLessThan(360);
    expect(c.phase).toBe(phaseOf(c.angle));
    // 가격이 막 바닥을 지나 오를 때와 정점을 지나 내릴 때는 서로 반대쪽
    const up = cycleOf([...wave(300, 0), ...Array.from({ length: 10 }, (_, i) => 90 + i)], R)!;
    const down = cycleOf([...wave(300, 0), ...Array.from({ length: 10 }, (_, i) => 110 - i)], R)!;
    expect(up.momentum).toBeGreaterThan(0);
    expect(down.momentum).toBeLessThan(0);
  });
  it("구간 이름 경계·자료 부족·변동 없음", () => {
    expect([0, 89, 90, 179, 180, 269, 270, 359].map(phaseOf)).toEqual(["recovery", "recovery", "expansion", "expansion", "slowdown", "slowdown", "contraction", "contraction"]);
    expect(cycleOf([1, 2, 3], R)).toBeNull();
    expect(cycleOf(Array(60).fill(100), R)).toMatchObject({ angle: 0, phase: "recovery", level: 0, momentum: 0 });
  });
});
