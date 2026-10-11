/**
 * 분기 보정 제안 (PRD §12 보정 · T12, D49) — 순수 함수. **제안만 만든다 — rules.yaml 자동 변경 금지.**
 *  · 표본 ≥ min_samples 인 구간끼리만 비교한다(과최적화 방지).
 *  · 임계값 제안: 🎯 주가 반영도 상한(axes.P.buy_max) · 최소 신호 계열 수(queues.buy.min_signal_families).
 *  · 정보 제안: 신호원·산업·큐별 성과가 전체와 크게 다른 경우(가중·조건 재검토 거리).
 *  · M1~M5 의 "필수" 여부는 사용자 결정 사항이라 제안 대상이 아니다.
 * 승인되면 사용자가 Claude Code 세션에서 rules.yaml 을 고치고 docs/DECISIONS.md 에 근거를 남긴다.
 */
import { DIMENSION_NAME, type FeedbackRules, BASIS_WORD, metricOf } from "@/lib/engine/feedback";
import type { StatRow } from "./attribution";

export type Proposal = { kind: "threshold" | "info"; title: string; rule?: string; current?: number; suggested?: number; evidence: string };

const signed = (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(2)}%`;
const SELL = new Set(["holding_alert", "take_profit"]);

export function reviewProposals(stats: StatRow[], current: { buy_max: number; min_signal_families: number }, cfg: FeedbackRules, name: (scope: string) => string = (s) => s): Proposal[] {
  const h = cfg.primary_horizon;
  const gap = cfg.review.min_gap_pctp;
  // 채점 기준(feedback.basis, D69 = 절대 수익률)의 대표값을 median_excess 자리에 놓고 같은 규칙으로 비교한다
  const ok = stats.map((s) => ({ ...s, median_excess: metricOf(s, cfg.basis) })).filter((s) => s.horizon_days === h && s.n >= cfg.min_samples && s.median_excess !== null) as (StatRow & { median_excess: number })[];
  const get = (scope: string, dim: string, bucket: string) => ok.find((s) => s.scope === scope && s.dimension === dim && s.bucket === bucket);
  const ev = (s: StatRow & { median_excess: number }) => `${h}거래일 ${BASIS_WORD[cfg.basis]} 중앙값 ${signed(s.median_excess)}${s.hit_rate === null ? "" : `, 승률 ${Math.round(s.hit_rate * 100)}%`} (${s.n}건)`;
  const out: Proposal[] = [];
  const all = get("buy", "all", "all");

  if (all) {
    // ① 주가 반영도 상한 — 상한 바로 아래 구간이 전체보다 gap 이상 나쁘고 음수면 그 구간 하한으로 낮춤
    const cuts = [...cfg.p_buckets].sort((a, b) => a - b);
    const i = cuts.indexOf(current.buy_max);
    const top = i > 0 ? get("buy", "p_bucket", `${cuts[i - 1]}~${cuts[i]}`) : undefined;
    if (top && top.median_excess < 0 && top.median_excess <= all.median_excess - gap) {
      out.push({ kind: "threshold", title: "🎯 주가 반영도 상한 낮추기", rule: "axes.P.buy_max", current: current.buy_max, suggested: cuts[i - 1],
        evidence: `반영도 ${cuts[i - 1]}~${cuts[i]} 구간 ${ev(top)} vs 🎯 전체 ${ev(all)}` });
    }
    // ② 최소 신호 계열 수 — 최소값 구간이 전체보다 gap 이상 나쁘고 음수면 1 올림
    const fam = get("buy", "families", String(current.min_signal_families));
    if (fam && fam.median_excess < 0 && fam.median_excess <= all.median_excess - gap) {
      out.push({ kind: "threshold", title: "🎯 최소 합의 신호 계열 수 올리기", rule: "queues.buy.min_signal_families", current: current.min_signal_families, suggested: current.min_signal_families + 1,
        evidence: `계열 ${current.min_signal_families}개 ${ev(fam)} vs 🎯 전체 ${ev(all)}` });
    }
    // ③ 신호원·산업 — 전체 대비 크게 다르면 정보 제안
    for (const s of ok.filter((x) => x.scope === "buy" && (x.dimension === "sources" || x.dimension === "l1"))) {
      if (s.median_excess <= all.median_excess - gap) out.push({ kind: "info", title: `${DIMENSION_NAME[s.dimension]} ${s.bucket}: 🎯 성과 부진 — 가중·조건 재검토`, evidence: `${ev(s)} vs 전체 ${ev(all)}` });
      else if (s.median_excess >= all.median_excess + gap) out.push({ kind: "info", title: `${DIMENSION_NAME[s.dimension]} ${s.bucket}: 🎯 성과 우수 — 유지·강화 검토`, evidence: `${ev(s)} vs 전체 ${ev(all)}` });
    }
    if (all.median_excess < 0) out.push({ kind: "info", title: `🎯 매수 검토 전체 ${BASIS_WORD[cfg.basis]} 마이너스 — 조건 전반 재검토`, evidence: ev(all) });
  }

  // ④ 다른 큐 — 매수 쪽은 음수, 매도 쪽(⚠️·💰)은 양수(경고 후 오히려 강세)면 재검토
  for (const s of ok.filter((x) => x.scope !== "buy" && x.dimension === "all")) {
    if (SELL.has(s.scope) ? s.median_excess > 0 : s.median_excess < 0) {
      out.push({ kind: "info", title: `${name(s.scope)}: ${SELL.has(s.scope) ? `경고 뒤 오히려 ${BASIS_WORD[cfg.basis]} 플러스 — 경고 기준 재검토` : `${BASIS_WORD[cfg.basis]} 마이너스 — 조건 재검토`}`, evidence: ev(s) });
    }
  }
  return out;
}
