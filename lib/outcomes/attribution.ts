/**
 * 성과 귀속 (PRD §12 "조건별 기여", D49) — 순수 함수.
 * 큐(🎯·🔭·⏳·⚠️·💰)마다 신호 특징 구간별 D+N 수익률·초과수익 중앙값과 승률을 계산한다 → perf_stats (매일 스냅샷).
 * 승률(hit_rate)의 기준은 feedback.basis — absolute(D69 기본) = 수익률 > 0, excess = 시장 대비 초과수익 > 0 (매도 쪽은 < 0).
 * 추천 순위(lib/engine/feedback.ts perfPrior)와 분기 보정 제안(review.ts)이 이 표를 읽는다.
 */
import { bucketsOf, type FeedbackRules, type PerfStat, type SignalFeatures } from "@/lib/engine/feedback";
import type { Side } from "./ledger";
import { median } from "./scorecard";

export type Sample = { scope: string; level: Side; horizon_days: number; ret_pct: number; excess_pct: number | null; features: SignalFeatures | null };
export type StatRow = PerfStat & { mean_excess: number | null; median_ret: number; enough: boolean };

const r2 = (x: number) => Math.round(x * 100) / 100;

export function attribute(samples: Sample[], cfg: Pick<FeedbackRules, "basis" | "dimensions" | "p_buckets" | "timing_score_buckets" | "min_samples">): StatRow[] {
  const groups = new Map<string, { scope: string; level: Side; dimension: string; bucket: string; horizon_days: number; xs: Sample[] }>();
  for (const s of samples) {
    const buckets = s.features ? bucketsOf(s.features, cfg) : [{ dimension: "all", bucket: "all" }];
    for (const b of buckets) {
      const k = [s.scope, b.dimension, b.bucket, s.horizon_days].join("|");
      const g = groups.get(k) ?? { scope: s.scope, level: s.level, ...b, horizon_days: s.horizon_days, xs: [] };
      g.xs.push(s);
      groups.set(k, g);
    }
  }
  const out: StatRow[] = [];
  for (const g of groups.values()) {
    const ex = g.xs.map((x) => x.excess_pct).filter((x): x is number => x !== null);
    const me = median(ex);
    const graded = cfg.basis === "absolute" ? g.xs.map((x) => x.ret_pct) : ex;
    const hits = graded.filter((x) => (g.level === "sell" ? x < 0 : x > 0)).length;
    out.push({
      scope: g.scope, dimension: g.dimension, bucket: g.bucket, horizon_days: g.horizon_days, n: g.xs.length,
      median_excess: me === null ? null : r2(me),
      mean_excess: ex.length ? r2(ex.reduce((a, b) => a + b, 0) / ex.length) : null,
      hit_rate: graded.length ? r2(hits / graded.length) : null,
      median_ret: r2(median(g.xs.map((x) => x.ret_pct)) as number),
      enough: g.xs.length >= cfg.min_samples,
    });
  }
  return out.sort((a, b) => a.scope.localeCompare(b.scope) || a.horizon_days - b.horizon_days || a.dimension.localeCompare(b.dimension) || a.bucket.localeCompare(b.bucket));
}
