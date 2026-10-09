import { describe, expect, it } from "vitest";
import { cycleOf, phaseOf } from "./cycle";
import { addColumns, alignPaths, attachQuarterly, pickSeries, indicatorSeries, monthReturn, monthsAgo, periodReturn, quarterEnd, quartersAgoStart, rebaseMerge, weekStart, weekWindow , alignForward, correlation } from "./series";
import { earlyRise, flowPhaseOf, industryPhaseOf } from "./cycle";

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
  it("monthReturn: 직전 달 마지막 종가 대비", () => {
    expect(monthReturn([bar("2026-08-31", 90), bar("2026-09-30", 100), bar("2026-10-01", 105), bar("2026-10-02", 110)])).toBeCloseTo(10);
    expect(monthReturn([bar("2026-10-01", 105), bar("2026-10-02", 110)])).toBeNull();
    expect(monthReturn([])).toBeNull();
  });
  it("addColumns: 공포·탐욕·변동성을 같은 날짜 축에 (날짜 합집합, 없는 값 null, 등급 함께)", () => {
    const base = rebaseMerge({ a: [bar("2026-01-02", 10), bar("2026-01-05", 11)] }, "2026-01-01");
    const m = addColumns(base, { fg: [{ date: "2025-12-31", value: 1 }, { date: "2026-01-02", value: 40, rating: "공포" }, { date: "2026-01-03", value: 42, rating: "공포" }], vix: [{ date: "2026-01-05", value: 18 }] }, "2026-01-01");
    expect(m).toEqual([
      { date: "2026-01-02", a: 100, fg: 40, fg_rating: "공포", vix: null },
      { date: "2026-01-03", a: null, fg: 42, fg_rating: "공포", vix: null },
      { date: "2026-01-05", a: 110, fg: null, vix: 18 },
    ]);
    expect(addColumns([], { v: [{ date: "2026-01-02", value: 1 }] }, "2026-01-01")).toEqual([{ date: "2026-01-02", v: 1 }]);
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
  it("alignPaths: 시작일 이후 첫 거래일 = 100, 경과 거래일로 정렬, 짧은 시계열은 null (D63)", () => {
    const rows = alignPaths({
      a: { start: "2018-10-01", bars: [bar("2018-09-28", 90), bar("2018-10-01", 100), bar("2018-10-02", 95), bar("2018-10-03", 110)] },
      b: { start: "2026-06-22", bars: [bar("2026-06-22", 200), bar("2026-06-23", 150)] },
    }, 2);
    expect(rows).toEqual([
      { date: "0", a: 100, b: 100 },
      { date: "1", a: 95, b: 75 },
      { date: "2", a: 110, b: null },
    ]);
  });
  it("pickSeries: 이동평균 2개를 전체로 계산해 from 이후만, 예열 전은 null", () => {
    const xs = [10, 12, 14, 16, 18, 20].map((c, i) => bar(`2026-01-0${i + 1}`, c));
    const ps = pickSeries(xs, "2026-01-02", [2, 3, 2], 2, [2, 4]);
    expect(ps.map((p) => p.date)).toEqual(["2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05", "2026-01-06"]);
    expect(ps.map((p) => p.ma_fast)).toEqual([11, 13, 15, 17, 19]);
    expect(ps.map((p) => p.ma_slow)).toEqual([null, null, 13, 15, 17]);
    expect(ps[4].close).toBe(20);
  });
});

describe("🔄 세 렌즈 · 상승 초입 (D69)", () => {
  const L = { industry: { high_pct: 15, tol_pctp: 1 }, flow: { short_days: 2, long_days: 4 }, early_rise: { price_angle_from: 300, price_angle_to: 90 } };
  it("산업 사이클 — 성장률 높이 × 방향", () => {
    expect(industryPhaseOf(20, 18, L.industry)).toBe("expansion");
    expect(industryPhaseOf(20, 20.5, L.industry)).toBe("expansion");  // 1%p 이내 하락은 감속 아님
    expect(industryPhaseOf(20, null, L.industry)).toBe("expansion");
    expect(industryPhaseOf(8, 3, L.industry)).toBe("recovery");
    expect(industryPhaseOf(-5, -9, L.industry)).toBe("recovery");     // 역성장 폭이 줄어드는 중
    expect(industryPhaseOf(3.6, 3.4, L.industry)).toBe("slowdown");   // 낮은 성장률 정체 = 회복 아님
    expect(industryPhaseOf(25, 40, L.industry)).toBe("slowdown");
    expect(industryPhaseOf(-3, 2, L.industry)).toBe("contraction");
    expect(industryPhaseOf(null, 3, L.industry)).toBeNull();
  });
  it("수급 추세 — 최근 합 × 추세 합", () => {
    expect(flowPhaseOf([1, 1, 1, 1], L.flow)).toEqual({ phase: "expansion", short: 2, long: 4 });
    expect(flowPhaseOf([-5, -5, 1, 1], L.flow)?.phase).toBe("recovery");
    expect(flowPhaseOf([5, 5, -1, -1], L.flow)?.phase).toBe("slowdown");
    expect(flowPhaseOf([-1, -1, -1, -1], L.flow)?.phase).toBe("contraction");
    expect(flowPhaseOf([1, 1], L.flow)).toBeNull();
  });
  it("상승 초입 — 산업 회복·확장 ∧ 주가 바닥권~회복 초입", () => {
    const c = (angle: number) => ({ angle, phase: phaseOf(angle), level: 0, momentum: 0 });
    expect(earlyRise("expansion", c(30), L.early_rise)).toBe(true);
    expect(earlyRise("recovery", c(320), L.early_rise)).toBe(true);
    expect(earlyRise("recovery", c(150), L.early_rise)).toBe(false);
    expect(earlyRise("slowdown", c(30), L.early_rise)).toBe(false);
    expect(earlyRise("expansion", null, L.early_rise)).toBe(false);
    expect(earlyRise(null, c(30), L.early_rise)).toBe(false);
    const M = { ...L.early_rise, industry_min_growth_pct: 5 };
    expect(earlyRise("recovery", c(30), M, 8)).toBe(true);
    expect(earlyRise("recovery", c(30), M, 2.3)).toBe(false);
    expect(earlyRise("recovery", c(30), M, null)).toBe(false);
  });
  it("alignForward · correlation", () => {
    const base = [{ date: "2026-01-02", close: 1 }, { date: "2026-01-05", close: 2 }, { date: "2026-02-02", close: 3 }];
    expect(alignForward(base, [{ date: "2026-01-03", close: 10 }, { date: "2026-02-01", close: 20 }])).toEqual([null, 10, 20]);
    expect(correlation([1, 2, 3, 4], [2, 4, 6, 8])).toBe(1);
    expect(correlation([1, 2, 3, 4], [8, 6, 4, null])).toBe(-1);
    expect(correlation([1, 2], [1, 2])).toBeNull();
    expect(correlation([1, 1, 1], [1, 2, 3])).toBeNull();
  });
});
