/**
 * 🎯 추천 선별 기준 — 기본 기준 + 사후 검증으로 배운 기준 (사용자 지정 2026-10-04, D54). 순수 함수.
 *  · 학습 표본 = 브리핑 때마다 기록한 🎯 후보 전체(추천한 것 + 안 한 것, 원장 `pick`, perf_stats scope `pick_all`).
 *    추천하지 않은 후보도 계속 측정하므로 한 번 제외한 기준도 성과가 회복되면 다시 풀린다(선택 편향 방지).
 *  · 표본 ≥ min_samples 인 구간만 쓴다. 승률(시장 대비 초과수익 > 0 비율)이 target 미만이거나 중앙값이 음수이고
 *    전체보다 min_gap 이상 나쁘면 그 구간을 TOP 추천에서 뺀다. 가장 좋은 매력 단계는 빼지 않는다(추천이 끊겨 학습이 멈추지 않게).
 *  · auto_apply=false 면 배운 기준은 표시만(제안). 🎯 큐 자격·🟢 진입 신호(M1~M5)는 바꾸지 않는다(불변 규칙 4).
 */
import type { AxesEvidence } from "./explain";
import { featuresOf, pBucket, perfPrior, type FeedbackRules, type PerfStat, type Prior, type SignalFeatures } from "./feedback";
import { CHECK_NAME, checkMarks, daysUntil, timingOf, type CheckKey, type Mark, type Timing, type TimingRules, type Verdict, VERDICT_SHORT } from "./timing";

export type PolicyRules = {
  auto_apply: boolean;
  min_samples: number;
  target_hit_rate: number;           // 승률 목표(0~1)
  min_gap_pctp: number;              // 전체 대비 이만큼(%p) 이상 나쁠 때만 제외
  base_exclude_verdicts: Verdict[];  // 기본 기준: 이 매력 단계는 TOP 추천 제외 (wait)
  scope: string;                     // 학습 표본 scope (pick_all)
};

export type Rule = { kind: "verdict" | "check" | "score"; bucket: string; title: string; evidence: string; good: boolean };
export type Policy = {
  as_of: string | null;
  horizon: number;
  applied: boolean;                  // 배운 기준을 실제 선별에 쓰는지
  overall: { n: number; hit_rate: number | null; median_excess: number | null } | null;
  exclude: Rule[];                   // 승률 낮은 구간 — TOP 추천 제외
  prefer: Rule[];                    // 승률 높은 구간 — 표시(순위는 perfPrior 가 반영)
};

const MARK_WORD: Record<Mark, string> = { pass: "통과", warn: "주의", fail: "탈락", none: "해당 없음" };
const signed = (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(1)}%`;
const ev = (s: PerfStat, h: number) => `${h}거래일 뒤 승률 ${s.hit_rate === null ? "-" : `${Math.round(s.hit_rate * 100)}%`} · 시장 대비 중앙값 ${s.median_excess === null ? "-" : signed(s.median_excess)} (${s.n}건)`;

/** 구간 이름 — "rsi:fail" → "RSI 과열 탈락" */
export function bucketTitle(kind: Rule["kind"], bucket: string): string {
  if (kind === "verdict") return `매수 매력 ${VERDICT_SHORT[bucket as Verdict] ?? bucket}`;
  if (kind === "score") return `매수 매력 점수 ${bucket}`;
  const [k, m] = bucket.split(":");
  return `${CHECK_NAME[k as CheckKey] ?? k} ${MARK_WORD[m as Mark] ?? m}`;
}

export function derivePolicy(stats: PerfStat[], r: PolicyRules, horizon: number, asOf: string | null): Policy {
  const ok = stats.filter((s) => s.scope === r.scope && s.horizon_days === horizon);
  const all = ok.find((s) => s.dimension === "all");
  const base: Policy = { as_of: asOf, horizon, applied: r.auto_apply, overall: all ? { n: all.n, hit_rate: all.hit_rate, median_excess: all.median_excess } : null, exclude: [], prefer: [] };
  if (!all || all.median_excess === null) return base;
  const enough = ok.filter((s) => s.n >= r.min_samples && s.median_excess !== null && s.hit_rate !== null) as (PerfStat & { median_excess: number; hit_rate: number })[];
  const kinds: [string, Rule["kind"]][] = [["timing_verdict", "verdict"], ["timing_check", "check"], ["timing_score", "score"]];
  const bestVerdict = enough.filter((s) => s.dimension === "timing_verdict").sort((a, b) => b.median_excess - a.median_excess)[0]?.bucket;
  for (const [dim, kind] of kinds) {
    for (const s of enough.filter((x) => x.dimension === dim)) {
      if (kind === "check" && s.bucket.endsWith(":none")) continue;
      const bad = (s.hit_rate < r.target_hit_rate || s.median_excess < 0) && s.median_excess <= all.median_excess - r.min_gap_pctp;
      const good = s.hit_rate >= r.target_hit_rate && s.median_excess > 0 && s.median_excess >= all.median_excess + r.min_gap_pctp;
      const rule = { kind, bucket: s.bucket, title: bucketTitle(kind, s.bucket), evidence: `${ev(s, horizon)} vs 후보 전체 ${ev(all, horizon)}` };
      if (bad && !(kind === "verdict" && s.bucket === bestVerdict)) base.exclude.push({ ...rule, good: false });
      else if (good) base.prefer.push({ ...rule, good: true });
    }
  }
  return base;
}

/** TOP 추천 자격 — 기본 기준(대기 제외) + 적용 중인 배운 기준. 탈락 사유를 함께 돌려준다 */
export function admits(t: Timing, policy: Policy | null, r: Pick<PolicyRules, "base_exclude_verdicts">, scoreCuts: number[]): { ok: boolean; why: string[] } {
  const why: string[] = [];
  if (r.base_exclude_verdicts.includes(t.verdict)) why.push(`기본 기준: ${VERDICT_SHORT[t.verdict]}`);
  if (policy?.applied) {
    const marks = new Set(t.checks.map((k) => `${k.key}:${k.mark}`));
    const score = pBucket(t.score, scoreCuts);
    for (const x of policy.exclude) {
      const hit = x.kind === "verdict" ? x.bucket === t.verdict : x.kind === "score" ? x.bucket === score : marks.has(x.bucket);
      if (hit) why.push(`사후 검증: ${x.title} 승률 낮음`);
    }
  }
  return { ok: why.length === 0, why };
}

export type Assessed = { timing: Timing; admit: { ok: boolean; why: string[] }; features: SignalFeatures; prior: Prior; scope: string };

/** 학습 표본이 충분하면 후보 전체(pick_all) 성과로, 아니면 🎯 큐 성과로 순위 가중 */
export function priorScope(stats: PerfStat[], cfg: Pick<PolicyRules, "scope" | "min_samples">, horizon: number): string {
  return stats.some((s) => s.scope === cfg.scope && s.dimension === "all" && s.horizon_days === horizon && s.n >= cfg.min_samples) ? cfg.scope : "buy";
}

/** 🎯 후보 한 종목 평가 — 타이밍 → TOP 자격 → 신호 특징(원장 고정용) → 과거 성과 가중. 브리핑·대시보드 공용 */
export function assess(x: { ev: AxesEvidence; p: number | null; market: "KR" | "US"; l1: string | null; riskOff: boolean; today: string },
  R: { buy_timing: TimingRules; pick_policy: PolicyRules; feedback: FeedbackRules }, policy: Policy | null, stats: PerfStat[]): Assessed {
  const idea = x.ev.idea;
  const timing = timingOf({ p: x.p, chart: idea?.chart, flow: idea?.flow, eventDays: daysUntil(x.ev.next_event, x.today), eventTitle: idea?.events[0]?.title ?? null, riskOff: x.riskOff }, R.buy_timing);
  const features = featuresOf({ families: x.ev.families, p: x.p, grade: x.ev.F?.grade, market: x.market, l1: x.l1, timing: { score: timing.score, verdict: timing.verdict, checks: checkMarks(timing) } });
  const scope = priorScope(stats, R.pick_policy, R.feedback.primary_horizon);
  return { timing, admit: admits(timing, policy, R.pick_policy, R.feedback.timing_score_buckets), features, prior: perfPrior(features, stats, scope, R.feedback), scope };
}
