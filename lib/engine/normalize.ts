/**
 * 신호 정규화 (PRD §6.1) — 순수 함수. 원천 행 → Signal. 배수·유효기간·구간은 rules.yaml `normalize` 에서만 온다.
 * 엔티티 해석(코드 → entity_id)과 L1 은 호출부가 넘긴 resolver 로 한다.
 */
import { addDays, clamp10, type Signal } from "./types";

export type NormalizeRules = {
  industry_narrative: { multiplier: number; ttl_days: number };
  company_mention_fw: { counts: Record<string, number>; ttl_days: number };
  mentor_consensus: { min_sage_score: number; counts: Record<string, number>; ttl_days: number };
  earnings_catalyst: { ttl_days: number };
  earnings_quality_us: { per_filter: number; ttl_days: number };
  industry_sentiment: { ttl_days: number };
  accel_grade: Record<string, number> & { base_effect_penalty: number };
};

/** 구간표 {1:4, 2:6, 3:8} 에서 n 이상인 가장 큰 구간 값. 최소 구간 미만이면 0 */
export function stepValue(counts: Record<string, number>, n: number): number {
  let best = 0;
  for (const [k, v] of Object.entries(counts).sort((a, b) => Number(a[0]) - Number(b[0]))) if (n >= Number(k)) best = v;
  return best;
}

// ── FlyWheel ───────────────────────────────────────────
export type LinkedRow = { l2: string; page_id: string; date: string; strength: number | null; created_time: string; url: string };

export function flywheelNarrative(rows: LinkedRow[], l2ToL1: Record<string, string>, r: NormalizeRules): Signal[] {
  const out: Signal[] = [];
  for (const x of rows) {
    const l1 = l2ToL1[x.l2];
    if (!l1 || x.strength === null) continue;
    out.push({
      source: "flywheel", source_ref: x.page_id, kind: "industry_narrative", entity_id: null, l1_codes: [l1], direction: 1,
      strength: clamp10(x.strength * r.industry_narrative.multiplier), observed_at: x.created_time, market_date: x.date,
      expires_at: addDays(x.created_time, r.industry_narrative.ttl_days),
      evidence: { l2: x.l2, signal_strength: x.strength, url: x.url }, dedupe_key: `fw:narr:${x.page_id}`,
    });
  }
  return out;
}

export type WikiRow = { page_id: string; created_time: string; companies: string[]; url: string };

/** WiKi 14일 수혜 기업 언급 수 → 4·6·8 (엔티티별 1건, 날짜별 dedupe) */
export function flywheelMentions(rows: WikiRow[], resolve: (name: string) => string | null, now: Date, r: NormalizeRules): Signal[] {
  const ttl = r.company_mention_fw.ttl_days;
  const since = now.getTime() - ttl * 86400_000;
  const by = new Map<string, { n: number; refs: string[]; last: string }>();
  for (const w of rows) {
    if (new Date(w.created_time).getTime() < since) continue;
    for (const id of new Set(w.companies.map(resolve).filter((x): x is string => !!x))) {
      const cur = by.get(id) ?? { n: 0, refs: [], last: w.created_time };
      cur.n++; cur.refs.push(w.url); if (w.created_time > cur.last) cur.last = w.created_time;
      by.set(id, cur);
    }
  }
  const day = now.toISOString().slice(0, 10);
  return [...by.entries()].map(([id, v]) => ({
    source: "flywheel" as const, source_ref: `wiki:${day}`, kind: "company_mention_fw" as const, entity_id: id, l1_codes: [], direction: 1 as const,
    strength: clamp10(stepValue(r.company_mention_fw.counts, v.n)), observed_at: v.last, expires_at: addDays(v.last, ttl),
    evidence: { mentions_14d: v.n, urls: v.refs.slice(0, 5) }, dedupe_key: `fw:wiki:${id}:${day}`,
  })).filter((s) => s.strength > 0);
}

// ── Sage ───────────────────────────────────────────────
export type MentionRow = { mentor_id: string; stance: string; value: string; mention_type: string; published_at: string };

/**
 * 멘토 컨센서스 (30일): 대상(종목 또는 L1)별 강세 멘토 수(Sage 점수 ≥ min) 2·3·4+ → 6·8·10.
 * 약세 멘토가 강세보다 많고 2명 이상이면 direction −1. 대상 해석은 resolveTarget(엔티티 id 또는 "L1:코드").
 */
export function sageConsensus(rows: MentionRow[], scores: Record<string, number>, resolveTarget: (m: MentionRow) => string | null, now: Date, r: NormalizeRules): Signal[] {
  const c = r.mentor_consensus;
  const since = now.getTime() - c.ttl_days * 86400_000;
  const by = new Map<string, { bull: Set<string>; bear: Set<string>; last: string }>();
  for (const m of rows) {
    if (new Date(m.published_at).getTime() < since || (scores[m.mentor_id] ?? 0) < c.min_sage_score) continue;
    const t = resolveTarget(m);
    if (!t) continue;
    const cur = by.get(t) ?? { bull: new Set<string>(), bear: new Set<string>(), last: m.published_at };
    if (m.stance === "강세") cur.bull.add(m.mentor_id);
    if (m.stance === "약세") cur.bear.add(m.mentor_id);
    if (m.published_at > cur.last) cur.last = m.published_at;
    by.set(t, cur);
  }
  const day = now.toISOString().slice(0, 10);
  const out: Signal[] = [];
  for (const [t, v] of by) {
    const bear = v.bear.size > v.bull.size && v.bear.size >= 2;
    const n = bear ? v.bear.size : v.bull.size;
    const strength = clamp10(stepValue(c.counts, n));
    if (strength === 0) continue;
    const isL1 = t.startsWith("L1:");
    out.push({
      source: "sage", source_ref: `consensus:${day}`, kind: "mentor_consensus", entity_id: isL1 ? null : t, l1_codes: isL1 ? [t.slice(3)] : [],
      direction: bear ? -1 : 1, strength, observed_at: v.last, expires_at: addDays(v.last, c.ttl_days),
      evidence: { bullish: [...v.bull].sort(), bearish: [...v.bear].sort() }, dedupe_key: `sage:cons:${t}:${day}`,
    });
  }
  return out;
}

// ── HermesCall ─────────────────────────────────────────
export type BeneficiaryRow = { id: number; analysis_id: number; beneficiary_symbol: string; beneficiary_market: string; strength: number | null; industry?: string | null; created_at: string; source_symbol: string };

export function hermesCatalyst(rows: BeneficiaryRow[], resolve: (sym: string, market: string) => string | null, r: NormalizeRules): Signal[] {
  const out: Signal[] = [];
  for (const b of rows) {
    const id = resolve(b.beneficiary_symbol, b.beneficiary_market);
    if (!id || b.strength === null || b.strength === undefined) continue;
    out.push({
      source: "hermescall", source_ref: `beneficiary:${b.id}`, kind: "earnings_catalyst", entity_id: id, l1_codes: [], direction: 1,
      strength: clamp10(b.strength), observed_at: b.created_at, expires_at: addDays(b.created_at, r.earnings_catalyst.ttl_days),
      evidence: { analysis_id: b.analysis_id, leader: b.source_symbol, industry: b.industry ?? null }, dedupe_key: `hc:bene:${b.id}`,
    });
  }
  return out;
}

export type QuarterlyMetricRow = { symbol: string; fiscal_year: number; fiscal_quarter: number; f1_surprise: number | boolean | null; f2_guidance_up: boolean | null; f3_acceleration: boolean | null; f4_opm_up: boolean | null; updated_at?: string | null };

/** F1~F4: F1 = EPS 서프라이즈(수치면 > 0, 불리언이면 true) */
export function usFilters(q: QuarterlyMetricRow): string[] {
  const f1 = typeof q.f1_surprise === "number" ? q.f1_surprise > 0 : q.f1_surprise === true;
  return [f1 && "F1", q.f2_guidance_up && "F2", q.f3_acceleration && "F3", q.f4_opm_up && "F4"].filter((x): x is string => !!x);
}

export function hermesQuality(rows: QuarterlyMetricRow[], resolve: (sym: string) => string | null, observedFallback: string, r: NormalizeRules): Signal[] {
  const out: Signal[] = [];
  for (const q of rows) {
    const id = resolve(q.symbol);
    if (!id) continue;
    const flags = usFilters(q);
    const at = q.updated_at ?? observedFallback;
    out.push({
      source: "hermescall", source_ref: `qm:${q.symbol}:${q.fiscal_year}Q${q.fiscal_quarter}`, kind: "earnings_quality_us", entity_id: id, l1_codes: [],
      direction: 1, strength: clamp10(flags.length * r.earnings_quality_us.per_filter), observed_at: at,
      expires_at: addDays(at, r.earnings_quality_us.ttl_days), evidence: { flags, fiscal: `${q.fiscal_year}Q${q.fiscal_quarter}` },
      dedupe_key: `hc:qm:${q.symbol}:${q.fiscal_year}Q${q.fiscal_quarter}`,
    });
  }
  return out;
}

export type SentimentRow = { analysis_id: number; created_at: string; sentiment: string | null; industries: string[] };

/** 산업 센티먼트 30일 순합: 긍정 +1 / 부정 −1 (L1 별). strength = |순합|(최대 10), 방향 = 부호 */
export function hermesSentiment(rows: SentimentRow[], toL1: (label: string) => string[], now: Date, r: NormalizeRules): Signal[] {
  const ttl = r.industry_sentiment.ttl_days;
  const since = now.getTime() - ttl * 86400_000;
  const by = new Map<string, { sum: number; n: number; last: string; ids: number[] }>();
  for (const x of rows) {
    if (new Date(x.created_at).getTime() < since) continue;
    const v = x.sentiment?.includes("긍정") ? 1 : x.sentiment?.includes("부정") ? -1 : 0;
    if (!v) continue;
    for (const l1 of new Set(x.industries.flatMap(toL1))) {
      const cur = by.get(l1) ?? { sum: 0, n: 0, last: x.created_at, ids: [] };
      cur.sum += v; cur.n++; cur.ids.push(x.analysis_id); if (x.created_at > cur.last) cur.last = x.created_at;
      by.set(l1, cur);
    }
  }
  const day = now.toISOString().slice(0, 10);
  return [...by.entries()].filter(([, v]) => v.sum !== 0).map(([l1, v]) => ({
    source: "hermescall" as const, source_ref: `sentiment:${day}`, kind: "industry_sentiment" as const, entity_id: null, l1_codes: [l1],
    direction: (v.sum > 0 ? 1 : -1) as 1 | -1, strength: clamp10(Math.abs(v.sum)), observed_at: v.last, expires_at: addDays(v.last, ttl),
    evidence: { net: v.sum, analyses: v.n, analysis_ids: v.ids.slice(0, 10) }, dedupe_key: `hc:sent:${l1}:${day}`,
  }));
}

// ── Heimdallr ──────────────────────────────────────────
export type ScreenRow = { code: string; fiscal_year: number; fiscal_quarter: number; grade: string | null; gate_passed: boolean | null; score_final: number | null; score_delta: number | null; pri: number | null; base_effect_warning: boolean | null; computed_at: string };

/** ★○△· 등급 → 10·7·5·2, 기저효과 경고면 −2. 다음 분기 실적 전까지(≈100일) 유효 */
export function heimdallrGrade(rows: ScreenRow[], r: NormalizeRules): Signal[] {
  const out: Signal[] = [];
  for (const s of rows) {
    const base = s.grade ? r.accel_grade[s.grade] : undefined;
    if (base === undefined) continue;
    out.push({
      source: "heimdallr", source_ref: `screen:${s.code}:${s.fiscal_year}Q${s.fiscal_quarter}`, kind: "accel_grade", entity_id: `KR:${s.code}`, l1_codes: [],
      direction: 1, strength: clamp10(base - (s.base_effect_warning ? r.accel_grade.base_effect_penalty : 0)), observed_at: s.computed_at,
      expires_at: addDays(s.computed_at, 100),
      evidence: { grade: s.grade, gate_passed: s.gate_passed, score: s.score_final, score_delta: s.score_delta, pri: s.pri, base_effect_warning: s.base_effect_warning, fiscal: `${s.fiscal_year}Q${s.fiscal_quarter}` },
      dedupe_key: `hd:grade:${s.code}:${s.fiscal_year}Q${s.fiscal_quarter}:${s.grade}`,
    });
  }
  return out;
}

/** PRI 0~100 → strength 0~10 (원값은 evidence.pri). 1일 유효, 날짜별 dedupe */
export function heimdallrPri(rows: ScreenRow[], now: Date): Signal[] {
  const day = now.toISOString().slice(0, 10);
  return rows.filter((s) => s.pri !== null && s.pri !== undefined).map((s) => ({
    source: "heimdallr" as const, source_ref: `pri:${s.code}:${day}`, kind: "price_reflection" as const, entity_id: `KR:${s.code}`, l1_codes: [],
    direction: 0 as const, strength: clamp10((s.pri as number) / 10), observed_at: now.toISOString(), market_date: day, expires_at: addDays(now.toISOString(), 1),
    evidence: { pri: s.pri }, dedupe_key: `hd:pri:${s.code}:${day}`,
  }));
}

// ── SnowBall ───────────────────────────────────────────
export type RiskAlertRow = { alert_id: string; rule_type: string; asset_id: string | null; ticker: string | null; fired_at: string; severity: string; title: string };
export const SEVERITY: Record<string, number> = { critical: 10, warn: 6, info: 2 };

export function snowballRisk(rows: RiskAlertRow[], resolveAsset: (assetId: string | null, ticker: string | null) => string | null): Signal[] {
  return rows.map((a) => ({
    source: "snowball" as const, source_ref: `risk:${a.alert_id}`, kind: "holding_risk" as const, entity_id: resolveAsset(a.asset_id, a.ticker), l1_codes: [],
    direction: -1 as const, strength: SEVERITY[a.severity] ?? 2, observed_at: a.fired_at, expires_at: null,
    evidence: { rule_type: a.rule_type, severity: a.severity, title: a.title }, dedupe_key: `sb:risk:${a.alert_id}`,
  }));
}
