/**
 * 가격·기술 지표 (🟢 판정에는 쓰지 않는다 — 🎯 TOP 추천 필수 조건·⏱️ 점수 재료). 일봉 종가 → 고점 대비 하락률 · 5일선/10일선 · MACD/Signal · RSI · 횡보 일수.
 * "교차 직전" 기준은 rules.yaml 에서 읽는다: MACD 는 entry_core.M2_macd_pre_cross 와 같은 값(🟢 M2 는 P3 에서 원 프로젝트 값으로 판정),
 * 이동평균·RSI 는 tech_display. 순수 함수만 둔다.
 */
export type Close = { date: string; close: number };

export type TechDisplayRules = {
  ma: [number, number];                 // [빠른 선, 느린 선] 예: [5, 20]
  ma_near_gap_pct_max: number;          // 빠른 선이 느린 선 아래 이 % 이내면 "직전" 후보
  ma_narrowing_days_min: number;        // 격차가 연속으로 좁혀진 일수
  rsi_period: number;
  rsi_direction_days: number;           // 방향 = 오늘 vs N일 전
  rsi_flat_band: number;                // ±이 값 이내 변화는 "보합"
  high_lookback_days: number;           // 고점 탐색 기간(거래일, 52주 ≈ 250)
  base_range_max_pct: number;           // 횡보 = 최근 N일 (최고 ÷ 최저 − 1) 이 이 % 이하 (D69 — 조정 후 횡보)
};
export type MacdRules = { params: [number, number, number]; hist_rising_bars_min: number; near_cross_gap_pct_of_close_max: number; or_projected_bars_to_cross_max: number };

export type CrossState = "cross_today" | "near" | "above" | "below";
export type ChartRef = {
  as_of: string; close: number; currency: "KRW" | "USD";
  high: { value: number; date: string; drawdown_pct: number; days: number };
  ma: { n: [number, number]; fast: number; slow: number; state: CrossState; gap_pct: number; streak: number } | null;          // streak: above=위에 있은 일수, near/below=격차가 좁혀진 일수
  macd: { state: CrossState; gap_pct: number; bars_to_cross: number | null; streak: number; improving: boolean } | null;
  rsi: { value: number; prev: number; days: number; dir: "up" | "down" | "flat" } | null;
  base?: { days: number; range_pct: number } | null;   // 횡보 일수: 최근 종가들이 base_range_max_pct 폭 안에 머문 연속 거래일 수 (D69, 옛 근거엔 없음)
};

export function sma(xs: number[], n: number): (number | null)[] {
  let sum = 0;
  return xs.map((x, i) => {
    sum += x;
    if (i >= n) sum -= xs[i - n];
    return i >= n - 1 ? sum / n : null;
  });
}

export function ema(xs: number[], n: number): number[] {
  const k = 2 / (n + 1);
  const out: number[] = [];
  xs.forEach((x, i) => out.push(i === 0 ? x : x * k + out[i - 1] * (1 - k)));
  return out;
}

/** Wilder RSI — 기간+1 개 미만이면 빈 배열 */
export function rsiSeries(xs: number[], n: number): number[] {
  if (xs.length < n + 1) return [];
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) { const d = xs[i] - xs[i - 1]; if (d > 0) gain += d; else loss -= d; }
  gain /= n; loss /= n;
  const val = () => (loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
  const out = [val()];
  for (let i = n + 1; i < xs.length; i++) {
    const d = xs[i] - xs[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    out.push(val());
  }
  return out;
}

/** 연속으로 조건을 만족한 일수(마지막부터 거꾸로) */
function streak(xs: number[], ok: (i: number) => boolean): number {
  let s = 0;
  for (let i = xs.length - 1; i >= 0 && ok(i); i--) s++;
  return s;
}

/** 느린 선 대비 빠른 선 격차(%) 시계열로 교차 상태 판정 */
export function maState(gaps: number[], r: Pick<TechDisplayRules, "ma_near_gap_pct_max" | "ma_narrowing_days_min">): { state: CrossState; streak: number } {
  const t = gaps.length - 1;
  const g = gaps[t];
  if (g > 0 && gaps[t - 1] <= 0) return { state: "cross_today", streak: 1 };
  if (g > 0) return { state: "above", streak: streak(gaps, (i) => gaps[i] > 0) };
  const narrowing = streak(gaps, (i) => i > 0 && gaps[i] > gaps[i - 1]);
  return { state: -g <= r.ma_near_gap_pct_max && narrowing >= r.ma_narrowing_days_min ? "near" : "below", streak: narrowing };
}

/** MACD 히스토그램(MACD − Signal) 시계열 + 종가로 교차 상태 판정 — entry_core.M2 와 같은 기준 */
export function macdState(hist: number[], close: number, r: MacdRules): { state: CrossState; gap_pct: number; bars_to_cross: number | null; streak: number; improving: boolean } {
  const t = hist.length - 1;
  const h = hist[t];
  const gap_pct = (Math.abs(h) / close) * 100;
  const improving = h > hist[t - 1];
  if (h > 0 && hist[t - 1] <= 0) return { state: "cross_today", gap_pct, bars_to_cross: 0, streak: 1, improving };
  if (h > 0) return { state: "above", gap_pct, bars_to_cross: null, streak: streak(hist, (i) => hist[i] > 0), improving };
  const rising = streak(hist, (i) => i > 0 && hist[i] > hist[i - 1]);
  const bars = improving ? Math.ceil(-h / (h - hist[t - 1])) : null;
  const near = rising >= r.hist_rising_bars_min && (gap_pct <= r.near_cross_gap_pct_of_close_max || (bars !== null && bars <= r.or_projected_bars_to_cross_max));
  return { state: near ? "near" : "below", gap_pct, bars_to_cross: bars, streak: rising, improving };
}

/** 끝에서부터 거꾸로, 종가 폭((최고 ÷ 최저) − 1)이 maxPct 이하로 유지된 가장 긴 구간의 일수와 그 폭 */
export function baseOf(xs: number[], maxPct: number): { days: number; range_pct: number } {
  let hi = -Infinity, lo = Infinity, days = 0, range = 0;
  for (let i = xs.length - 1; i >= 0; i--) {
    const h = Math.max(hi, xs[i]), l = Math.min(lo, xs[i]);
    const r = (h / l - 1) * 100;
    if (r > maxPct) break;
    hi = h; lo = l; days++; range = r;
  }
  return { days, range_pct: Math.round(range * 100) / 100 };
}

export function chartRef(bars: Close[], currency: "KRW" | "USD", r: TechDisplayRules, m: MacdRules): ChartRef | null {
  if (bars.length < 2) return null;
  const xs = bars.map((b) => b.close);
  const t = xs.length - 1;
  const close = xs[t];

  const from = Math.max(0, xs.length - r.high_lookback_days);
  let hi = from;
  for (let i = from; i <= t; i++) if (xs[i] >= xs[hi]) hi = i;
  const high = { value: xs[hi], date: bars[hi].date, drawdown_pct: ((close - xs[hi]) / xs[hi]) * 100, days: t - hi };

  const [f, s] = r.ma;
  const fast = sma(xs, f), slow = sma(xs, s);
  const gaps: number[] = [];
  xs.forEach((_, i) => { if (fast[i] !== null && slow[i] !== null) gaps.push(((fast[i]! - slow[i]!) / slow[i]!) * 100); });
  const ma = gaps.length >= 2 ? { n: r.ma, fast: fast[t]!, slow: slow[t]!, gap_pct: gaps[gaps.length - 1], ...maState(gaps, r) } : null;

  const [a, b, c] = m.params;
  const slowEma = ema(xs, b);
  const line = ema(xs, a).map((v, i) => v - slowEma[i]);
  const sig = ema(line, c);
  const macd = xs.length >= b + c ? macdState(line.map((v, i) => v - sig[i]), close, m) : null;

  const rs = rsiSeries(xs, r.rsi_period);
  const k = rs.length - 1 - r.rsi_direction_days;
  const rsi = k >= 0 ? (() => {
    const d = rs[rs.length - 1] - rs[k];
    return { value: rs[rs.length - 1], prev: rs[k], days: r.rsi_direction_days, dir: (d > r.rsi_flat_band ? "up" : d < -r.rsi_flat_band ? "down" : "flat") as "up" | "down" | "flat" };
  })() : null;

  return { as_of: bars[t].date, close, currency, high, ma, macd, rsi, base: baseOf(xs, r.base_range_max_pct) };
}
