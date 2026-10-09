/**
 * 🎯 추천 선별 기준 — 기본 기준 + 사후 검증으로 배운 기준 (사용자 지정 2026-10-04, D54). 순수 함수.
 *  · 학습 표본 = 브리핑 때마다 기록한 🎯 후보 전체(추천한 것 + 안 한 것, 원장 `pick`, perf_stats scope `pick_all`).
 *    추천하지 않은 후보도 계속 측정하므로 한 번 제외한 기준도 성과가 회복되면 다시 풀린다(선택 편향 방지).
 *  · 표본 ≥ min_samples 인 구간만 쓴다. 승률(추천일 기준 절대 수익률 > 0 비율, D69 — feedback.basis)이 target 미만이거나 중앙값이 음수이고
 *    후보 전체보다 min_gap 이상 나쁘면 그 구간을 TOP 추천에서 뺀다. 가장 좋은 매력 단계·주가 위치 경로는 빼지 않는다(추천이 끊겨 학습이 멈추지 않게).
 *  · 시장 국면별 학습(D69): 후보 표본을 국면(📈·📉·↔️)별 scope(`pick_all@up`)로도 따로 집계한다. 지금 국면의 표본이 min_samples 이상이면
 *    그 국면에서 배운 기준·순위 가중을 쓰고, 아니면 전체 기준을 쓴다 — 그때그때 시장 상황에 맞는 기준.
 *  · 비중 한도(D69): 이미 보유 중이고 SnowBall 동적 허용 비중(등급 상한 25·10·10%)에 닿은 종목은 TOP 추천에서 뺀다.
 *  · auto_apply=false 면 배운 기준은 표시만(제안). 🎯 큐 자격·🟢 진입 신호(M1~M5)는 바꾸지 않는다(불변 규칙 4).
 */
import type { AxesEvidence } from "./explain";
import { BASIS_WORD, featuresOf, metricOf, pBucket, perfPrior, type Basis, type FeedbackRules, type PerfStat, type Prior, type SignalFeatures } from "./feedback";
import type { MarketPhase } from "./regime";
import { CHECK_NAME, checkMarks, daysUntil, PATH_NAME, timingOf, type CheckKey, type Mark, type SetupPath, type Timing, type TimingRules, type Verdict, VERDICT_SHORT } from "./timing";

export type PolicyRules = {
  auto_apply: boolean;
  min_samples: number;
  target_hit_rate: number;           // 승률 목표(0~1)
  min_gap_pctp: number;              // 전체 대비 이만큼(%p) 이상 나쁠 때만 제외
  base_exclude_verdicts: Verdict[];  // 기본 기준: 이 매력 단계는 TOP 추천 제외 (wait)
  scope: string;                     // 학습 표본 scope (pick_all)
  promote_from: string[];            // 이 큐에서 상승 초기 조건(setup)을 만족하면 🎯 후보로 올림 (D66: pullback_wait)
};

export type Rule = { kind: "verdict" | "check" | "score" | "path"; bucket: string; title: string; evidence: string; good: boolean };
export type Policy = {
  as_of: string | null;
  horizon: number;
  basis?: Basis;                     // 채점 기준 (옛 기록엔 없음 = excess)
  phase?: MarketPhase | null;        // 국면별 기준이면 그 국면
  applied: boolean;                  // 배운 기준을 실제 선별에 쓰는지
  overall: { n: number; hit_rate: number | null; median_excess: number | null; median_ret?: number | null } | null;
  exclude: Rule[];                   // 승률 낮은 구간 — TOP 추천 제외
  prefer: Rule[];                    // 승률 높은 구간 — 표시(순위는 perfPrior 가 반영)
};
/** 전체 기준 + 시장 국면별 기준(표본 충분한 국면만) — outcomes_update 가 bot_state.pick_policy 에 쓴다 */
export type PolicySet = { overall: Policy | null; by_phase: Partial<Record<MarketPhase, Policy>> };

const isSet = (p: Policy | PolicySet | null | undefined): p is PolicySet => !!p && "by_phase" in p;
/** 지금 국면의 기준이 있으면 그것, 없으면 전체 기준 */
export function policyFor(p: Policy | PolicySet | null | undefined, phase: MarketPhase | null | undefined): Policy | null {
  if (!isSet(p)) return p ?? null;
  return (phase ? p.by_phase[phase] : undefined) ?? p.overall;
}

const MARK_WORD: Record<Mark, string> = { pass: "통과", warn: "주의", fail: "탈락", none: "해당 없음" };
const signed = (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(1)}%`;
const ev = (s: PerfStat, h: number, b: Basis) => { const m = metricOf(s, b); return `${h}거래일 뒤 승률 ${s.hit_rate === null ? "-" : `${Math.round(s.hit_rate * 100)}%`} · ${BASIS_WORD[b]} 중앙값 ${m === null ? "-" : signed(m)} (${s.n}건)`; };

/** 구간 이름 — "rsi:fail" → "RSI 과열 탈락" */
export function bucketTitle(kind: Rule["kind"], bucket: string): string {
  if (kind === "verdict") return `매수 매력 ${VERDICT_SHORT[bucket as Verdict] ?? bucket}`;
  if (kind === "score") return `매수 매력 점수 ${bucket}`;
  if (kind === "path") return `주가 위치 ${PATH_NAME[bucket as SetupPath] ?? bucket}`;
  const [k, m] = bucket.split(":");
  return `${CHECK_NAME[k as CheckKey] ?? k} ${MARK_WORD[m as Mark] ?? m}`;
}

export function derivePolicy(stats: PerfStat[], r: PolicyRules, horizon: number, asOf: string | null, basis: Basis = "excess", scope: string = r.scope, phase: MarketPhase | null = null): Policy {
  const ok = stats.filter((s) => s.scope === scope && s.horizon_days === horizon);
  const all = ok.find((s) => s.dimension === "all");
  const base: Policy = { as_of: asOf, horizon, basis, phase, applied: r.auto_apply, overall: all ? { n: all.n, hit_rate: all.hit_rate, median_excess: all.median_excess, median_ret: all.median_ret ?? null } : null, exclude: [], prefer: [] };
  const allM = all ? metricOf(all, basis) : null;
  if (!all || allM === null) return base;
  const enough = ok.filter((s) => s.n >= r.min_samples && metricOf(s, basis) !== null && s.hit_rate !== null).map((s) => ({ ...s, m: metricOf(s, basis) as number, hit: s.hit_rate as number }));
  const kinds: [string, Rule["kind"]][] = [["timing_verdict", "verdict"], ["timing_check", "check"], ["timing_score", "score"], ["setup_path", "path"]];
  const best = (dim: string) => enough.filter((s) => s.dimension === dim && s.bucket !== "none").sort((a, b) => b.m - a.m)[0]?.bucket;
  const bestVerdict = best("timing_verdict"), bestPath = best("setup_path");
  for (const [dim, kind] of kinds) {
    for (const s of enough.filter((x) => x.dimension === dim)) {
      if (kind === "check" && s.bucket.endsWith(":none")) continue;
      if (kind === "path" && s.bucket === "none") continue;
      const bad = (s.hit < r.target_hit_rate || s.m < 0) && s.m <= allM - r.min_gap_pctp;
      const good = s.hit >= r.target_hit_rate && s.m > 0 && s.m >= allM + r.min_gap_pctp;
      const rule = { kind, bucket: s.bucket, title: bucketTitle(kind, s.bucket), evidence: `${ev(s, horizon, basis)} vs 후보 전체 ${ev(all, horizon, basis)}` };
      const protectedBest = (kind === "verdict" && s.bucket === bestVerdict) || (kind === "path" && s.bucket === bestPath);
      if (bad && !protectedBest) base.exclude.push({ ...rule, good: false });
      else if (good) base.prefer.push({ ...rule, good: true });
    }
  }
  return base;
}

/** 전체 기준 + 표본이 충분한(후보 전체 ≥ min_samples) 시장 국면별 기준 */
export function derivePolicies(stats: PerfStat[], r: PolicyRules, horizon: number, asOf: string | null, basis: Basis): PolicySet {
  const by_phase: PolicySet["by_phase"] = {};
  for (const ph of ["up", "down", "side"] as MarketPhase[]) {
    const scope = `${r.scope}@${ph}`;
    const all = stats.find((s) => s.scope === scope && s.dimension === "all" && s.horizon_days === horizon);
    if (all && all.n >= r.min_samples) by_phase[ph] = derivePolicy(stats, r, horizon, asOf, basis, scope, ph);
  }
  return { overall: derivePolicy(stats, r, horizon, asOf, basis), by_phase };
}

/** TOP 추천 자격 — 필수 조건(MACD 돌파 직전·직후 ∧ 주가 위치 A·B, D69) + 비중 한도 + 기본 기준(대기 제외) + 적용 중인 배운 기준. 탈락 사유를 함께 돌려준다 */
export type HoldingRef = { weight: number | null; allowed_weight: number | null } | null | undefined;
const pc1 = (x: number) => `${(x * 100).toFixed(1)}%`;

export function admits(t: Timing, policy: Policy | null, r: Pick<PolicyRules, "base_exclude_verdicts">, scoreCuts: number[], holding?: HoldingRef): { ok: boolean; why: string[] } {
  const why: string[] = [];
  if (t.setup.required && !t.setup.ok) why.push(...t.setup.why.map((w) => `필수 조건: ${w}`));
  if (holding?.allowed_weight != null && holding.weight != null && holding.weight >= holding.allowed_weight) why.push(`비중 한도: 보유 ${pc1(holding.weight)} ≥ 허용 ${pc1(holding.allowed_weight)}`);
  if (r.base_exclude_verdicts.includes(t.verdict)) why.push(`기본 기준: ${VERDICT_SHORT[t.verdict]}`);
  if (policy?.applied) {
    const marks = new Set(t.checks.map((k) => `${k.key}:${k.mark}`));
    const score = pBucket(t.score, scoreCuts);
    for (const x of policy.exclude) {
      const hit = x.kind === "verdict" ? x.bucket === t.verdict : x.kind === "score" ? x.bucket === score : x.kind === "path" ? x.bucket === t.setup.path : marks.has(x.bucket);
      if (hit) why.push(`사후 검증: ${x.title} 승률 낮음`);
    }
  }
  return { ok: why.length === 0, why };
}

export type Assessed = { timing: Timing; admit: { ok: boolean; why: string[] }; features: SignalFeatures; prior: Prior; scope: string };

/** 학습 표본이 충분하면 후보 전체(pick_all) 성과로 — 지금 시장 국면 표본도 충분하면 그 국면(pick_all@up) 성과로 — 아니면 🎯 큐 성과로 순위 가중 */
export function priorScope(stats: PerfStat[], cfg: Pick<PolicyRules, "scope" | "min_samples">, horizon: number, phase?: MarketPhase | null): string {
  const enough = (scope: string) => stats.some((s) => s.scope === scope && s.dimension === "all" && s.horizon_days === horizon && s.n >= cfg.min_samples);
  if (phase && enough(`${cfg.scope}@${phase}`)) return `${cfg.scope}@${phase}`;
  return enough(cfg.scope) ? cfg.scope : "buy";
}

/** 🎯 후보 한 종목 평가 — 타이밍 → TOP 자격 → 신호 특징(원장 고정용) → 과거 성과 가중. 브리핑·대시보드 공용 */
export function assess(x: { ev: AxesEvidence; p: number | null; market: "KR" | "US"; l1: string | null; riskOff: boolean; today: string; phase?: MarketPhase | null; holding?: HoldingRef },
  R: { buy_timing: TimingRules; pick_policy: PolicyRules; feedback: FeedbackRules }, policy: Policy | PolicySet | null, stats: PerfStat[]): Assessed {
  const idea = x.ev.idea;
  const timing = timingOf({ p: x.p, chart: idea?.chart, flow: idea?.flow, eventDays: daysUntil(x.ev.next_event, x.today), eventTitle: idea?.events[0]?.title ?? null, riskOff: x.riskOff }, R.buy_timing);
  const features = featuresOf({ families: x.ev.families, p: x.p, grade: x.ev.F?.grade, market: x.market, l1: x.l1, phase: x.phase ?? null, timing: { score: timing.score, verdict: timing.verdict, checks: checkMarks(timing), path: timing.setup.path } });
  const scope = priorScope(stats, R.pick_policy, R.feedback.primary_horizon, x.phase);
  return { timing, admit: admits(timing, policyFor(policy, x.phase), R.pick_policy, R.feedback.timing_score_buckets, x.holding), features, prior: perfPrior(features, stats, scope, R.feedback), scope };
}

/**
 * 🎯 후보 풀 (D66) — 🎯 매수 검토 큐 전부 + promote_from 큐(⏳ 눌림 대기) 중 상승 초기 조건을 만족하는 종목.
 * 주가 반영도는 보정 중이라 큐 경계(axes.P.buy_max)로 거르지 않고 ⏱️ 점수(p_weight)로만 반영한다. 올라온 종목도 admits 를 똑같이 거친다.
 */
export function candidatePool<T extends { queue: string; a: Assessed }>(xs: T[], promoteFrom: string[]): (T & { promoted: boolean })[] {
  return xs.filter((x) => x.queue === "buy" || (promoteFrom.includes(x.queue) && x.a.timing.setup.ok)).map((x) => ({ ...x, promoted: x.queue !== "buy" }));
}
