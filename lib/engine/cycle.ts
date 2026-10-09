/**
 * 🔄 섹터 주기 위치 (사용자 지정 2026-10-05, D56) — 표시 전용, 순수 함수.
 *  추세 위치 L = 종가 ÷ 이동평균 − 1, 모멘텀 M = L 의 N일 변화. 둘을 최근 1년 표준편차로 나눠(z) 각도로 바꾼다.
 *  사인 곡선 y = −cos(θ) 위의 점: θ = atan2(Mz, −Lz)
 *    0° 바닥(L 최저·M≈0) → 90° 상승 가속(L≈0·M 최대) → 180° 정점(L 최고·M≈0) → 270° 하락 가속 → 360° 바닥
 *  구간: 0~90° 회복 · 90~180° 확장 · 180~270° 둔화 · 270~360° 침체
 */
import { sma } from "./technicals";

export type CycleRules = { ma_days: number; momentum_days: number; zscore_days: number };
export type Phase = "recovery" | "expansion" | "slowdown" | "contraction";
export type Cycle = { angle: number; phase: Phase; level: number; momentum: number };

export const PHASE_NAME: Record<Phase, string> = { recovery: "🌱 회복", expansion: "🚀 확장", slowdown: "🌥️ 둔화", contraction: "🧊 침체" };
export const PHASE_HINT: Record<Phase, string> = {
  recovery: "바닥을 지나 오르기 시작",
  expansion: "상승 진행 중 · 정점 전",
  slowdown: "정점을 지나 힘이 빠지는 중",
  contraction: "하락 진행 중 · 바닥 전",
};

const std = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};

export function phaseOf(angle: number): Phase {
  return angle < 90 ? "recovery" : angle < 180 ? "expansion" : angle < 270 ? "slowdown" : "contraction";
}

export function cycleOf(closes: number[], r: CycleRules): Cycle | null {
  const ma = sma(closes, r.ma_days);
  const L = closes.map((c, i) => (ma[i] === null ? null : c / (ma[i] as number) - 1)).filter((x): x is number => x !== null);
  if (L.length <= r.momentum_days + 1) return null;
  const M = L.slice(r.momentum_days).map((x, i) => x - L[i]);
  const Lw = L.slice(-r.zscore_days), Mw = M.slice(-r.zscore_days);
  const sL = std(Lw) || 1, sM = std(Mw) || 1;
  const level = L[L.length - 1] / sL, momentum = M[M.length - 1] / sM;
  const deg = (Math.atan2(momentum, 0 - level) * 180) / Math.PI;   // 0 - 0 = +0 (−0 이면 atan2 가 180°)
  const angle = Math.round(deg + 360) % 360;
  return { angle, phase: phaseOf(angle), level: Math.round(level * 100) / 100, momentum: Math.round(momentum * 100) / 100 };
}

// ───────────── 세 가지 렌즈 (사용자 지정 10/9, D69) — 산업 사이클 · 주가 위치(위 cycleOf) · 수급 추세. 표시 전용 ─────────────

export type LensRules = {
  industry: { high_pct: number; tol_pctp: number };          // 매출 YoY 중앙값 high_pct 이상 = 고성장, 직전 분기보다 tol 이상 낮아지면 감속
  flow: { short_days: number; long_days: number };           // 최근 short_days 순매수 합(방향 전환) · long_days 합(추세)
  early_rise: { price_angle_from: number; price_angle_to: number; industry_min_growth_pct?: number };   // 주가 위치 각도가 from 이상 또는 to 미만 = 바닥권 ~ 상승 초입 · 산업 매출 증가율 하한
};

export const LENS_HINT = {
  industry: { recovery: "성장률이 낮지만 다시 빨라지는 중", expansion: "고성장 유지·가속", slowdown: "성장률이 꺾이거나 낮은 채 정체", contraction: "역성장·감속" },
  flow: { recovery: "길게는 매도였지만 최근 매수로 전환", expansion: "매수 우위 지속", slowdown: "매수 우위였지만 최근 매도로 전환", contraction: "매도 우위 지속" },
} as const;

/**
 * 산업 사이클 — 소속 기업 매출 YoY 중앙값(최근 q0 · 직전 q1, M3 ① 과 같은 표본).
 *   고성장(q0 ≥ high): 감속 아님 → 🚀 확장 · 감속 → 🌥️ 둔화
 *   그 외: 가속(q0 − q1 > tol) → 🌱 회복 · 정체·감속이면 q0 > 0 → 🌥️ 둔화, q0 ≤ 0 → 🧊 침체   (직전 분기 없으면 정체로 본다)
 *   10/9 실측: 낮은 성장률이 그대로인 산업(여행 3.4 → 3.6%)까지 '회복'으로 잡혀 회복은 '빨라질 때'로 좁힘
 */
export function industryPhaseOf(q0: number | null, q1: number | null, r: LensRules["industry"]): Phase | null {
  if (q0 === null) return null;
  const d = q1 === null ? 0 : q0 - q1;
  if (q0 >= r.high_pct) return d < -r.tol_pctp ? "slowdown" : "expansion";
  if (d > r.tol_pctp) return "recovery";
  return q0 > 0 ? "slowdown" : "contraction";
}

/**
 * 수급 추세 — 일별 순매수 금액(국내: 외국인 + 기관 순매수 × 종가, 미국: 종가 방향 × 거래량 × 종가 대용).
 *   추세(long 합) > 0 ∧ 최근(short 합) > 0 → 🚀 확장 · 추세 ≤ 0 ∧ 최근 > 0 → 🌱 회복 · 추세 > 0 ∧ 최근 ≤ 0 → 🌥️ 둔화 · 둘 다 ≤ 0 → 🧊 침체
 */
export function flowPhaseOf(net: number[], r: LensRules["flow"]): { phase: Phase; short: number; long: number } | null {
  if (net.length < r.long_days) return null;
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const short = sum(net.slice(-r.short_days)), long = sum(net.slice(-r.long_days));
  const phase: Phase = short > 0 ? (long > 0 ? "expansion" : "recovery") : long > 0 ? "slowdown" : "contraction";
  return { phase, short, long };
}

/** 🚀 상승 초입 — 산업은 회복·확장(매출 증가율 ≥ 하한)인데 주가 위치는 아직 바닥권 ~ 상승 초입(각도 from 이상 또는 to 미만): 실적 개선을 주가가 덜 반영 */
export function earlyRise(industry: Phase | null, price: Cycle | null, r: LensRules["early_rise"], growth: number | null = null): boolean {
  if (!price || (industry !== "recovery" && industry !== "expansion")) return false;
  if (r.industry_min_growth_pct !== undefined && (growth === null || growth < r.industry_min_growth_pct)) return false;
  return price.angle >= r.price_angle_from || price.angle < r.price_angle_to;
}
