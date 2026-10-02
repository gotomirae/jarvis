/**
 * 미국 가격 위치 `pri_us_lite` (PRD §7.6, "간이") — 순수 함수. 0(덜 반영) ~ 100(많이 반영).
 * 가중치(rules.yaml pri_us_lite.weights): 52주 위치 30% · 3개월 S&P 500 대비 초과수익 백분위 25% · RSI(14) 20% · 50일선 이격 15% · 실적 발표 후 반응 10%.
 * 구성 요소를 0~100 으로 맞춘 뒤 가중 평균한다. 값이 없는 요소는 빼고 나머지 가중치로 다시 나눈다(52주 위치·RSI 둘 다 없으면 계산 불가).
 *  · 50일선 이격: −20% → 0, +20% → 100 (선형, 범위 밖은 자름)
 *  · 발표 후 반응(발표 전 종가 → 발표 다음 거래일 종가): −20% → 0, +20% → 100
 */
import { rsiSeries, sma, type Close } from "./technicals";

export type PriUsWeights = { pos_52w: number; rel_ret_3m_pctile: number; rsi14: number; ma50_gap: number; post_earnings_reaction: number };
export type PriUsParts = { pos_52w: number | null; rel_ret_3m: number | null; rsi14: number | null; ma50_gap_pct: number | null; post_earnings_reaction_pct: number | null };

const clamp = (x: number) => Math.max(0, Math.min(100, x));
const lin = (x: number, lo: number, hi: number) => clamp(((x - lo) / (hi - lo)) * 100);
const r1 = (x: number) => Math.round(x * 10) / 10;

/** 일봉 → 구성 요소 (3개월 = 63거래일). 벤치마크·발표일이 없으면 해당 요소 null */
export function priUsParts(bars: Close[], bench: Close[] | null, earningsDate: string | null): PriUsParts {
  const c = bars.map((b) => b.close);
  const last = c[c.length - 1];
  const year = c.slice(-252);
  const hi = Math.max(...year), lo = Math.min(...year);
  const pos = c.length >= 60 && hi > lo ? ((last - lo) / (hi - lo)) * 100 : null;
  const rsi = c.length >= 15 ? rsiSeries(c, 14).at(-1) ?? null : null;
  const ma50 = sma(c, 50).at(-1) ?? null;
  let rel: number | null = null;
  if (bench && c.length > 63) {
    const d0 = bars[bars.length - 64].date;
    const b0 = [...bench].reverse().find((b) => b.date <= d0), b1 = bench[bench.length - 1];
    if (b0 && b1) rel = (last / c[c.length - 64] - 1) * 100 - (b1.close / b0.close - 1) * 100;
  }
  let pe: number | null = null;
  if (earningsDate) {
    const i = bars.findIndex((b) => b.date > earningsDate);
    if (i > 0 && bars[i]) pe = (bars[i].close / bars[i - 1].close - 1) * 100;
  }
  return { pos_52w: pos, rel_ret_3m: rel, rsi14: rsi, ma50_gap_pct: ma50 ? (last / ma50 - 1) * 100 : null, post_earnings_reaction_pct: pe };
}

/** 값 목록 안에서 x 의 백분위(0~100, 같은 값은 중간 순위) */
export function percentile(x: number, all: number[]): number {
  if (all.length <= 1) return 50;
  const below = all.filter((v) => v < x).length, same = all.filter((v) => v === x).length;
  return ((below + (same - 1) / 2) / (all.length - 1)) * 100;
}

/** 구성 요소 + 같은 날 미국 종목들의 3개월 초과수익 분포 → pri_us_lite */
export function priUsLite(p: PriUsParts, relUniverse: number[], w: PriUsWeights): number | null {
  if (p.pos_52w === null && p.rsi14 === null) return null;
  const parts: [number | null, number][] = [
    [p.pos_52w, w.pos_52w],
    [p.rel_ret_3m === null ? null : percentile(p.rel_ret_3m, relUniverse), w.rel_ret_3m_pctile],
    [p.rsi14, w.rsi14],
    [p.ma50_gap_pct === null ? null : lin(p.ma50_gap_pct, -20, 20), w.ma50_gap],
    [p.post_earnings_reaction_pct === null ? null : lin(p.post_earnings_reaction_pct, -20, 20), w.post_earnings_reaction],
  ];
  const ok = parts.filter((x): x is [number, number] => x[0] !== null);
  const wsum = ok.reduce((a, [, wt]) => a + wt, 0);
  return r1(ok.reduce((a, [v, wt]) => a + v * wt, 0) / wsum);
}
