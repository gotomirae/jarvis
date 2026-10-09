/**
 * 성과 피드백 (PRD §7.3 진입 게이트 6 · §12, D49) — 순수 함수.
 *  · 신호 특징(계열 수·신호원·주가 반영도 구간·실적 등급·시장·산업)을 구간으로 나눈다 — 성과 집계와 추천 순위가 같은 함수를 쓴다.
 *  · 채점 기준(basis): absolute = 추천일 기준 절대 수익률(사용자 지정 10/9, D69) · excess = 시장 대비 초과수익(D49 옛 기준).
 *    승률 = 수익률 > 0 비율(⚠️·💰 매도 쪽은 < 0). 상승장에선 모든 구간이 좋아 보이므로 구간 비교는 항상 "후보 전체 대비"로 한다(pick-policy).
 *  · 추천 순위: 후보가 속한 구간 중 표본 ≥ min_samples 인 구간의 D+N 수익률 중앙값을 표본 수로 축소(n/(n+k))해 평균 → "기대 수익률".
 *    표본이 모자라면 null — 기존 규칙 순위를 그대로 쓴다. 후보 자격(🎯 조건)·🟢 조건(M1~M5)은 바꾸지 않는다(불변 규칙 4).
 */
import type { MarketPhase } from "./regime";

export type Dimension = "families" | "p_bucket" | "grade" | "market" | "l1" | "sources" | "timing_verdict" | "timing_check" | "timing_score" | "setup_path" | "market_phase";
export type Basis = "absolute" | "excess";

export type FeedbackRules = {
  basis: Basis;                        // 채점 기준 — absolute(절대 수익률, D69) · excess(시장 대비)
  primary_horizon: number;
  report_horizons: number[];           // /verify 기준별 승률을 나눠 보여 줄 기간 (10·20거래일, D69)
  min_samples: number;
  shrinkage_k: number;
  dimensions: Dimension[];
  p_buckets: number[];
  timing_score_buckets: number[];      // ⏱️ 매수 매력 점수 구간 (D53)
  review: { min_gap_pctp: number };
};

/** ⏱️ 지금 매수 매력도 요약 (lib/engine/timing.ts) — 브리핑 후보 원장(pick)에만 있다 */
export type TimingFeature = { score: number; verdict: string; checks: Record<string, string>; path?: string | null };   // path = 주가 위치 경로 ma·base·both (D69)
export type SignalFeatures = { families: string[]; p: number | null; grade: string | null; market: "KR" | "US"; l1: string | null; timing?: TimingFeature | null; phase?: MarketPhase | null };

export type PerfStat = { scope: string; dimension: string; bucket: string; horizon_days: number; n: number; median_excess: number | null; hit_rate: number | null; median_ret?: number | null };

/** 채점 기준에 맞는 대표값 — absolute = 수익률 중앙값, excess = 초과수익 중앙값 */
export const metricOf = (s: Pick<PerfStat, "median_excess" | "median_ret">, basis: Basis): number | null => (basis === "absolute" ? s.median_ret ?? null : s.median_excess);
export const BASIS_WORD: Record<Basis, string> = { absolute: "수익률", excess: "시장 대비" };
const EXPECT_WORD: Record<Basis, string> = { absolute: "기대 수익률", excess: "기대 초과수익" };

export type Prior = {
  score: number | null;
  basis: { dimension: string; bucket: string; n: number; median_excess: number }[];   // median_excess = 채점 기준 대표값(absolute 면 수익률 중앙값)
  overall: PerfStat | null;
};

const r2 = (x: number) => Math.round(x * 100) / 100;

/** 축 근거·큐 사유 → 신호 특징 (신호 시점 값 — 원장 payload.features 에 고정 저장) */
export function featuresOf(x: { families?: string[] | null; p: number | null; grade?: string | null; market: "KR" | "US"; l1?: string | null; timing?: TimingFeature | null; phase?: MarketPhase | null }): SignalFeatures {
  const f: SignalFeatures = { families: [...(x.families ?? [])].sort(), p: x.p, grade: x.grade ?? null, market: x.market, l1: x.l1 ?? null };
  const g = x.phase ? { ...f, phase: x.phase } : f;
  return x.timing ? { ...g, timing: x.timing } : g;
}

export function pBucket(p: number | null, cuts: number[]): string {
  if (p === null) return "없음";
  const s = [...cuts].sort((a, b) => a - b);
  if (p < s[0]) return `<${s[0]}`;
  for (let i = 1; i < s.length; i++) if (p < s[i]) return `${s[i - 1]}~${s[i]}`;
  return `≥${s[s.length - 1]}`;
}

/** 특징 → (차원, 구간) 목록. 전체 구간(all|all)을 항상 포함. 신호원·타이밍 항목은 여러 구간에 동시에 속한다. 타이밍 차원은 타이밍이 있는 특징에만 */
export function bucketsOf(f: SignalFeatures, cfg: Pick<FeedbackRules, "dimensions" | "p_buckets" | "timing_score_buckets">): { dimension: string; bucket: string }[] {
  const out = [{ dimension: "all", bucket: "all" }];
  for (const d of cfg.dimensions) {
    if (d === "families") out.push({ dimension: d, bucket: f.families.length >= 4 ? "4+" : String(f.families.length) });
    else if (d === "p_bucket") out.push({ dimension: d, bucket: pBucket(f.p, cfg.p_buckets) });
    else if (d === "grade") out.push({ dimension: d, bucket: f.grade ?? "없음" });
    else if (d === "market") out.push({ dimension: d, bucket: f.market });
    else if (d === "l1") out.push({ dimension: d, bucket: f.l1 ?? "없음" });
    else if (d === "sources") for (const s of f.families) out.push({ dimension: d, bucket: s });
    else if (d === "market_phase") { if (f.phase) out.push({ dimension: d, bucket: f.phase }); }
    else if (!f.timing) continue;
    else if (d === "setup_path") out.push({ dimension: d, bucket: f.timing.path ?? "none" });
    else if (d === "timing_verdict") out.push({ dimension: d, bucket: f.timing.verdict });
    else if (d === "timing_score") out.push({ dimension: d, bucket: pBucket(f.timing.score, cfg.timing_score_buckets) });
    else for (const [k, m] of Object.entries(f.timing.checks)) out.push({ dimension: d, bucket: `${k}:${m}` });
  }
  return out;
}

/** 후보의 기대 초과수익(축소 추정) — 표본 충분한 구간만 */
export function perfPrior(f: SignalFeatures, stats: PerfStat[], scope: string, cfg: FeedbackRules): Prior {
  const idx = new Map(stats.filter((s) => s.scope === scope && s.horizon_days === cfg.primary_horizon).map((s) => [`${s.dimension}|${s.bucket}`, s]));
  const basis: Prior["basis"] = [];
  for (const b of bucketsOf(f, cfg)) {
    if (b.dimension === "all") continue;
    const s = idx.get(`${b.dimension}|${b.bucket}`);
    const v = s ? metricOf(s, cfg.basis) : null;
    if (s && s.n >= cfg.min_samples && v !== null) basis.push({ dimension: b.dimension, bucket: b.bucket, n: s.n, median_excess: v });
  }
  const shrunk = basis.map((b) => (b.n / (b.n + cfg.shrinkage_k)) * b.median_excess);
  return { score: shrunk.length ? r2(shrunk.reduce((a, c) => a + c, 0) / shrunk.length) : null, basis, overall: idx.get("all|all") ?? null };
}

export const DIMENSION_NAME: Record<string, string> = { all: "전체", families: "합의한 신호 계열 수", p_bucket: "주가 반영도", grade: "실적 등급", market: "시장", l1: "산업", sources: "신호원", timing_verdict: "지금 매수 매력", timing_check: "타이밍 항목", timing_score: "매수 매력 점수", setup_path: "주가 위치 경로", market_phase: "시장 국면" };

const signed = (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(1)}%`;

/** 카드 한 줄 — 순위 반영 여부를 함께 밝힌다. 데이터가 아직 없으면 null */
export function perfLine(p: Prior, cfg: FeedbackRules, name: (dimension: string, bucket: string) => string = (_, b) => b): string | null {
  const o = p.overall;
  if (!o || o.n === 0) return null;
  const h = `${cfg.primary_horizon}거래일`;
  const m = metricOf(o, cfg.basis);
  const base = `같은 큐 ${h} 뒤 ${BASIS_WORD[cfg.basis]} ${m === null ? "-" : signed(m)}${o.hit_rate === null ? "" : ` · 승률 ${Math.round(o.hit_rate * 100)}%`} (${o.n}건)`;
  if (p.score === null) return `${base} — 표본 ${cfg.min_samples}건 전이라 순위에는 아직 반영하지 않음`;
  const why = p.basis.slice(0, 3).map((b) => `${DIMENSION_NAME[b.dimension] ?? b.dimension} ${name(b.dimension, b.bucket)} ${signed(b.median_excess)}(${b.n}건)`).join(", ");
  return `비슷한 신호의 ${EXPECT_WORD[cfg.basis]} ${signed(p.score)} — 순위 반영 (근거: ${why}) · ${base}`;
}
