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
