import { describe, expect, it } from "vitest";
import { baseOf, chartRef, ema, macdState, maState, rsiSeries, sma, type MacdRules, type TechDisplayRules } from "./technicals";

const R: TechDisplayRules = { ma: [5, 20], ma_near_gap_pct_max: 1.0, ma_narrowing_days_min: 2, rsi_period: 14, rsi_direction_days: 3, rsi_flat_band: 1.0, high_lookback_days: 250, base_range_max_pct: 8 };
const M: MacdRules = { params: [12, 26, 9], hist_rising_bars_min: 2, near_cross_gap_pct_of_close_max: 0.30, or_projected_bars_to_cross_max: 3 };
const bars = (xs: number[]) => xs.map((close, i) => ({ date: `2026-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`, close }));

describe("조정 후 횡보 일수 (D69)", () => {
  it("끝에서부터 폭 8% 안에 머문 연속 일수", () => {
    expect(baseOf([100, 80, 84, 82, 85, 83], 8)).toEqual({ days: 5, range_pct: 6.25 });
    expect(baseOf([100, 100], 8)).toEqual({ days: 2, range_pct: 0 });
    expect(baseOf([], 8)).toEqual({ days: 0, range_pct: 0 });
  });
});

describe("가격·기술 지표 (표시 전용)", () => {
  it("이동평균·지수이동평균·RSI", () => {
    expect(sma([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5]);
    expect(ema([10, 20], 3)).toEqual([10, 15]);
    expect(rsiSeries([1, 2, 3], 14)).toEqual([]);
    expect(rsiSeries(Array.from({ length: 20 }, (_, i) => i + 1), 14).every((v) => v === 100)).toBe(true);
    const z = rsiSeries(Array.from({ length: 30 }, (_, i) => 100 + (i % 2 ? 1 : -1)), 14);
    expect(z[z.length - 1]).toBeGreaterThan(30);
    expect(z[z.length - 1]).toBeLessThan(70);
  });

  it("5일선·20일선 교차 상태", () => {
    expect(maState([-0.5, 0.2], R)).toEqual({ state: "cross_today", streak: 1 });
    expect(maState([-1, 0.5, 0.8, 1.2], R)).toEqual({ state: "above", streak: 3 });
    expect(maState([-1.5, -1.0, -0.4], R)).toEqual({ state: "near", streak: 2 });
    expect(maState([-3, -2.5, -2.0], R)).toEqual({ state: "below", streak: 2 });          // 좁혀지지만 1% 밖
    expect(maState([-0.2, -0.5, -0.8], R)).toEqual({ state: "below", streak: 0 });        // 벌어지는 중
    expect(maState([-0.9, -0.4], R)).toEqual({ state: "below", streak: 1 });              // 1일만 좁혀짐
  });

  it("MACD·시그널 교차 상태 (entry_core M2 와 같은 기준)", () => {
    expect(macdState([-1, 0.5], 100, M)).toMatchObject({ state: "cross_today", bars_to_cross: 0, streak: 1 });
    expect(macdState([-1, 0.5, 0.7], 100, M)).toMatchObject({ state: "above", streak: 2, improving: true });
    expect(macdState([-0.9, -0.6, -0.2], 100, M)).toMatchObject({ state: "near", bars_to_cross: 1, streak: 2 });   // 격차 0.2%
    expect(macdState([-9, -6, -4], 100, M)).toMatchObject({ state: "near", bars_to_cross: 2 });                    // 격차 4% 지만 2일 후 교차 추정
    expect(macdState([-9, -8.5, -8], 100, M)).toMatchObject({ state: "below", bars_to_cross: 16, improving: true });
    expect(macdState([-0.1, -0.2], 100, M)).toMatchObject({ state: "below", bars_to_cross: null, improving: false });
    expect(macdState([-0.5, -0.2], 100, M)).toMatchObject({ state: "below", streak: 1 });                           // 1일만 개선
  });

  it("차트 요약: 고점 대비·지표 계산, 데이터 부족 시 생략", () => {
    expect(chartRef(bars([100]), "KRW", R, M)).toBeNull();
    const short = chartRef(bars([100, 90]), "KRW", R, M)!;
    expect(short).toMatchObject({ close: 90, ma: null, macd: null, rsi: null, high: { value: 100, days: 1 } });
    expect(short.high.drawdown_pct).toBeCloseTo(-10);

    // 상승 → 하락 → 최근 반등: 고점 대비 하락, 5일선이 20일선에 다가감, RSI 상승
    const xs = [...Array.from({ length: 60 }, (_, i) => 100 + i), ...Array.from({ length: 30 }, (_, i) => 159 - i * 1.5), 116, 117, 118.5, 120];
    const c = chartRef(bars(xs), "USD", R, M)!;
    expect(c.high).toMatchObject({ value: 159, days: 33 });
    expect(c.high.drawdown_pct).toBeCloseTo(((120 - 159) / 159) * 100);
    expect(c.ma?.n).toEqual([5, 20]);
    expect(c.ma?.gap_pct).toBeLessThan(0);
    expect(c.macd?.improving).toBe(true);
    expect(c.rsi?.dir).toBe("up");
    expect(c.rsi?.days).toBe(3);

    const top = chartRef(bars(Array.from({ length: 40 }, (_, i) => 100 + i)), "KRW", R, M)!;
    expect(top.high.days).toBe(0);
    expect(top.rsi?.dir).toBe("flat");      // 계속 100
    const down = chartRef(bars([...Array.from({ length: 30 }, (_, i) => 100 + i), ...Array.from({ length: 5 }, (_, i) => 128 - 2 * i)]), "KRW", R, M)!;
    expect(down.rsi?.dir).toBe("down");
    expect(chartRef(bars(Array.from({ length: 300 }, (_, i) => (i === 10 ? 500 : 100 + i / 10))), "KRW", R, M)!.high.value).toBeCloseTo(129.9);   // 250일 밖 고점 제외
  });
});
