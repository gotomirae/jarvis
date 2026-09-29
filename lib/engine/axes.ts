/**
 * 종목별 축 N·C·F·P·H (PRD §6.2) — 합산하지 않는다. 임계값은 rules.yaml `axes`.
 * 순수 함수: 유효 신호·Heimdallr 최신 스크린·HermesCall 필터·보유 정보를 받는다.
 */
import { describeSignal } from "./explain";
import { FAMILY, type Signal } from "./types";

export type AxesRules = {
  N: { industry_narrative_min: number; company_mention_min: number; mentor_consensus_min: number };
  C: { earnings_catalyst_min: number; us_filters_any: string[] };
  F: { kr_score_min: number; kr_gate_required: boolean; us_filters_all: string[] };
};

export type EntityCtx = {
  id: string;
  market: "KR" | "US";
  l1_codes: string[];
  screen?: { gate_passed: boolean | null; score_final: number | null; pri: number | null; grade: string | null } | null;   // 국내
  usFilters?: string[] | null;          // 미국 F1~F4
  priUsLite?: number | null;            // 미국 가격 위치(간이) — P2 에서는 미계산이면 null
  holding?: { weight: number | null; allowed_weight: number | null; heat_score: number | null } | null;
};

export type Axes = {
  n: boolean; c: boolean; f: boolean; p: number | null; h: boolean;
  families: string[];                     // N·C·F 를 켠 신호 계열(서로 다른 계열 수 판정용)
  evidence: Record<string, unknown>;
};

const active = (s: Signal, now: number) => !s.expires_at || new Date(s.expires_at).getTime() > now;

export function computeAxes(e: EntityCtx, signals: Signal[], rules: AxesRules, now: Date): Axes {
  const t = now.getTime();
  const mine = signals.filter((s) => active(s, t) && (s.entity_id === e.id || (s.entity_id === null && s.l1_codes.some((c) => e.l1_codes.includes(c)))));
  const best = (kind: Signal["kind"], dir: -1 | 1 = 1) => {
    const xs = mine.filter((s) => s.kind === kind && s.direction === dir);
    return xs.length ? xs.reduce((a, b) => (b.strength > a.strength ? b : a)) : null;
  };
  const fam = new Set<string>();
  const ev: Record<string, unknown> = {};

  const narr = best("industry_narrative");
  const ment = best("company_mention_fw");
  const cons = best("mentor_consensus");
  const nHits = [
    narr && narr.strength >= rules.N.industry_narrative_min && narr,
    ment && ment.strength >= rules.N.company_mention_min && ment,
    cons && cons.strength >= rules.N.mentor_consensus_min && cons,
  ].filter((x): x is Signal => !!x);
  nHits.forEach((s) => fam.add(FAMILY[s.kind]));
  ev.N = nHits.map((s) => ({ kind: s.kind, strength: s.strength, ref: s.source_ref, detail: describeSignal(s.kind, s.strength, { ...s.evidence, scope: s.entity_id ? "company" : "industry" }) }));

  const cat = best("earnings_catalyst");
  const usAny = (e.usFilters ?? []).filter((f) => rules.C.us_filters_any.includes(f));
  const cOn = (cat !== null && cat.strength >= rules.C.earnings_catalyst_min) || usAny.length > 0;
  if (cOn) fam.add("hermescall");
  ev.C = { catalyst: cat ? { strength: cat.strength, ref: cat.source_ref, detail: describeSignal(cat.kind, cat.strength, cat.evidence) } : null, us_filters: usAny };

  let fOn = false;
  if (e.market === "KR" && e.screen) {
    fOn = (!rules.F.kr_gate_required || e.screen.gate_passed === true) && (e.screen.score_final ?? -1) >= rules.F.kr_score_min;
    if (fOn) fam.add("heimdallr");
    ev.F = { gate_passed: e.screen.gate_passed, score: e.screen.score_final, grade: e.screen.grade };
  } else if (e.market === "US") {
    fOn = rules.F.us_filters_all.every((f) => (e.usFilters ?? []).includes(f));
    if (fOn) fam.add("hermescall");
    ev.F = { us_filters: e.usFilters ?? [] };
  }

  const p = e.market === "KR" ? e.screen?.pri ?? null : e.priUsLite ?? null;
  ev.P = { value: p, basis: e.market === "KR" ? "PRI" : "pri_us_lite" };
  ev.H = e.holding ?? null;
  return { n: nHits.length > 0, c: cOn, f: fOn, p, h: !!e.holding, families: [...fam].sort(), evidence: ev };
}
