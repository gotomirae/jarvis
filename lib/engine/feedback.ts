/**
 * 성과 피드백 (PRD §7.3 진입 게이트 6 · §12, D49) — 순수 함수.
 *  · 신호 특징(계열 수·신호원·주가 반영도 구간·실적 등급·시장·산업)을 구간으로 나눈다 — 성과 집계와 추천 순위가 같은 함수를 쓴다.
 *  · 추천 순위: 후보가 속한 구간 중 표본 ≥ min_samples 인 구간의 D+N 초과수익 중앙값을 표본 수로 축소(n/(n+k))해 평균 → "기대 초과수익".
 *    표본이 모자라면 null — 기존 규칙 순위를 그대로 쓴다. 후보 자격(🎯 조건)·🟢 조건(M1~M5)은 바꾸지 않는다(불변 규칙 4).
 */
export type Dimension = "families" | "p_bucket" | "grade" | "market" | "l1" | "sources" | "timing_verdict" | "timing_check" | "timing_score";

export type FeedbackRules = {
  primary_horizon: number;
  min_samples: number;
  shrinkage_k: number;
  dimensions: Dimension[];
  p_buckets: number[];
  timing_score_buckets: number[];      // ⏱️ 매수 매력 점수 구간 (D53)
  review: { min_gap_pctp: number };
};

/** ⏱️ 지금 매수 매력도 요약 (lib/engine/timing.ts) — 브리핑 후보 원장(pick)에만 있다 */
export type TimingFeature = { score: number; verdict: string; checks: Record<string, string> };
export type SignalFeatures = { families: string[]; p: number | null; grade: string | null; market: "KR" | "US"; l1: string | null; timing?: TimingFeature | null };

export type PerfStat = { scope: string; dimension: string; bucket: string; horizon_days: number; n: number; median_excess: number | null; hit_rate: number | null };

export type Prior = {
  score: number | null;
  basis: { dimension: string; bucket: string; n: number; median_excess: number }[];
  overall: PerfStat | null;
};

const r2 = (x: number) => Math.round(x * 100) / 100;

/** 축 근거·큐 사유 → 신호 특징 (신호 시점 값 — 원장 payload.features 에 고정 저장) */
export function featuresOf(x: { families?: string[] | null; p: number | null; grade?: string | null; market: "KR" | "US"; l1?: string | null; timing?: TimingFeature | null }): SignalFeatures {
  const f: SignalFeatures = { families: [...(x.families ?? [])].sort(), p: x.p, grade: x.grade ?? null, market: x.market, l1: x.l1 ?? null };
  return x.timing ? { ...f, timing: x.timing } : f;
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
    else if (!f.timing) continue;
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
    if (s && s.n >= cfg.min_samples && s.median_excess !== null) basis.push({ dimension: b.dimension, bucket: b.bucket, n: s.n, median_excess: s.median_excess });
  }
  const shrunk = basis.map((b) => (b.n / (b.n + cfg.shrinkage_k)) * b.median_excess);
  return { score: shrunk.length ? r2(shrunk.reduce((a, c) => a + c, 0) / shrunk.length) : null, basis, overall: idx.get("all|all") ?? null };
}

export const DIMENSION_NAME: Record<string, string> = { all: "전체", families: "합의한 신호 계열 수", p_bucket: "주가 반영도", grade: "실적 등급", market: "시장", l1: "산업", sources: "신호원", timing_verdict: "지금 매수 매력", timing_check: "타이밍 항목", timing_score: "매수 매력 점수" };

const signed = (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(1)}%`;

/** 카드 한 줄 — 순위 반영 여부를 함께 밝힌다. 데이터가 아직 없으면 null */
export function perfLine(p: Prior, cfg: FeedbackRules, name: (dimension: string, bucket: string) => string = (_, b) => b): string | null {
  const o = p.overall;
  if (!o || o.n === 0) return null;
  const h = `${cfg.primary_horizon}거래일`;
  const base = `같은 큐 ${h} 뒤 시장 대비 ${o.median_excess === null ? "-" : signed(o.median_excess)}${o.hit_rate === null ? "" : ` · 이긴 비율 ${Math.round(o.hit_rate * 100)}%`} (${o.n}건)`;
  if (p.score === null) return `${base} — 표본 ${cfg.min_samples}건 전이라 순위에는 아직 반영하지 않음`;
  const why = p.basis.slice(0, 3).map((b) => `${DIMENSION_NAME[b.dimension] ?? b.dimension} ${name(b.dimension, b.bucket)} ${signed(b.median_excess)}(${b.n}건)`).join(", ");
  return `비슷한 신호의 기대 초과수익 ${signed(p.score)} — 순위 반영 (근거: ${why}) · ${base}`;
}
