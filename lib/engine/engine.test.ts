import { describe, expect, it } from "vitest";
import { loadYaml } from "@/lib/config/load";
import { computeAxes, type AxesRules, type EntityCtx } from "./axes";
import { fromEarnings, fromHeimdallr, fromHermes, fromSnowball, fromYaml, m4ForEntity, monthEnd } from "./catalysts";
import { GRADE_RANK, holdingAlerts, pct, type HoldingRules } from "./holding-alerts";
import { latestQuarters, median, realizedGrowth, type QuarterPoint, type RealizedRules } from "./industry-growth";
import { m3ForEntity, m3ForL1, m3Line, outlookPass, type M3Rules } from "./m3";
import {
  flywheelMentions, flywheelNarrative, hermesCatalyst, hermesQuality, hermesSentiment, heimdallrGrade, heimdallrPri, sageConsensus, snowballRisk, stepValue, usFilters,
  type NormalizeRules,
} from "./normalize";
import { assignQueue, QUEUE_LABEL, type PRules, type QueueRules } from "./queues";
import { movingAverage, regime, type RegimeRules } from "./regime";
import { addDays, clamp10, type Signal } from "./types";

type Rules = {
  normalize: NormalizeRules; axes: AxesRules & { P: PRules }; regime: RegimeRules; queues: QueueRules & { holding_alert: HoldingRules };
  entry_core: { M3_industry_high_growth: M3Rules & { realized: RealizedRules } };
};
const R = loadYaml<Rules>("rules.yaml");
const now = new Date("2026-09-28T00:00:00Z");
const iso = (d: string) => `${d}T00:00:00.000Z`;

describe("types", () => {
  it("clamp10·addDays", () => {
    expect(clamp10(12)).toBe(10);
    expect(clamp10(-1)).toBe(0);
    expect(clamp10(3.456)).toBe(3.46);
    expect(addDays("2026-09-28T00:00:00.000Z", 2)).toBe("2026-09-30T00:00:00.000Z");
  });
});

describe("normalize (rules.yaml normalize)", () => {
  const r = R.normalize;
  it("stepValue", () => {
    expect(stepValue({ 1: 4, 2: 6, 3: 8 }, 0)).toBe(0);
    expect(stepValue({ 1: 4, 2: 6, 3: 8 }, 2)).toBe(6);
    expect(stepValue({ 1: 4, 2: 6, 3: 8 }, 9)).toBe(8);
  });

  it("FlyWheel 연계종합 → 신호강도×2, L2 없음·강도 없음 제외", () => {
    const s = flywheelNarrative([
      { l2: "반도체", page_id: "p1", date: "2026-09-26", strength: 5, created_time: iso("2026-09-26"), url: "u" },
      { l2: "모름", page_id: "p2", date: "2026-09-26", strength: 5, created_time: iso("2026-09-26"), url: "u" },
      { l2: "AI", page_id: "p3", date: "2026-09-26", strength: null, created_time: iso("2026-09-26"), url: "u" },
    ], { 반도체: "1b", AI: "1a" }, r);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ kind: "industry_narrative", l1_codes: ["1b"], strength: 10, entity_id: null, dedupe_key: "fw:narr:p1", expires_at: "2026-10-10T00:00:00.000Z" });
  });

  it("FlyWheel WiKi 14일 언급 수 → 4·6·8", () => {
    const rows = [1, 2, 3].map((i) => ({ page_id: `w${i}`, created_time: iso(`2026-09-2${i}`), companies: ["SK하이닉스", "없는회사"], url: `u${i}` }));
    rows.push({ page_id: "old", created_time: iso("2026-08-01"), companies: ["SK하이닉스"], url: "old" });
    rows.push({ page_id: "w9", created_time: iso("2026-09-20"), companies: ["삼성전자", "삼성전자"], url: "u9" });
    const s = flywheelMentions(rows, (n) => ({ SK하이닉스: "KR:000660", 삼성전자: "KR:005930" } as Record<string, string>)[n] ?? null, now, r);
    expect(s.find((x) => x.entity_id === "KR:000660")).toMatchObject({ strength: 8, evidence: { mentions_14d: 3 } });
    expect(s.find((x) => x.entity_id === "KR:005930")).toMatchObject({ strength: 4 });
    expect(flywheelMentions([], () => null, now, { ...r, company_mention_fw: { counts: { 2: 6 }, ttl_days: 14 } })).toEqual([]);
    expect(flywheelMentions(rows.slice(4), (n) => (n === "삼성전자" ? "KR:005930" : null), now, { ...r, company_mention_fw: { counts: { 2: 6 }, ttl_days: 14 } })).toEqual([]);
  });

  it("Sage 컨센서스: 점수 ≥ 50 강세 멘토 수, 약세 우세면 −1", () => {
    const m = (mentor: string, stance: string, value: string, d = "2026-09-20") => ({ mentor_id: mentor, stance, value, mention_type: "company", published_at: iso(d) });
    const scores = { a: 60, b: 70, c: 80, d: 40, e: 90, f: 55 };
    const rows = [m("a", "강세", "삼성전자"), m("b", "강세", "삼성전자"), m("c", "강세", "삼성전자", "2026-09-25"), m("d", "강세", "삼성전자"), m("a", "강세", "old", "2026-07-01"),
      m("e", "약세", "반도체"), m("f", "약세", "반도체"), m("a", "강세", "반도체"), m("b", "중립", "모름")];
    const s = sageConsensus(rows, scores, (x) => (x.value === "삼성전자" ? "KR:005930" : x.value === "반도체" ? "L1:1b" : x.value === "old" ? "KR:000001" : null), now, r);
    expect(s.find((x) => x.entity_id === "KR:005930")).toMatchObject({ strength: 8, direction: 1, observed_at: iso("2026-09-25"), evidence: { bullish: ["a", "b", "c"] } });
    expect(s.find((x) => x.l1_codes[0] === "1b")).toMatchObject({ direction: -1, strength: 6, entity_id: null });
    expect(s).toHaveLength(2);
  });

  it("HermesCall 수혜·품질·센티먼트", () => {
    const c = hermesCatalyst([
      { id: 1, analysis_id: 9, beneficiary_symbol: "000660.KS", beneficiary_market: "KR", strength: 8, industry: "반도체", created_at: iso("2026-09-01"), source_symbol: "NVDA" },
      { id: 2, analysis_id: 9, beneficiary_symbol: "X", beneficiary_market: "US", strength: 8, created_at: iso("2026-09-01"), source_symbol: "NVDA" },
      { id: 3, analysis_id: 9, beneficiary_symbol: "AVGO", beneficiary_market: "US", strength: null, created_at: iso("2026-09-01"), source_symbol: "NVDA" },
    ], (s) => (s === "X" ? null : `ID:${s}`), r);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ entity_id: "ID:000660.KS", strength: 8, evidence: { leader: "NVDA", industry: "반도체" } });
    expect(hermesCatalyst([{ id: 4, analysis_id: 1, beneficiary_symbol: "A", beneficiary_market: "US", strength: 7, created_at: iso("2026-09-01"), source_symbol: "B" }], () => "US:A", r)[0].evidence.industry).toBeNull();

    expect(usFilters({ symbol: "A", fiscal_year: 2026, fiscal_quarter: 2, f1_surprise: 3.2, f2_guidance_up: true, f3_acceleration: null, f4_opm_up: true })).toEqual(["F1", "F2", "F4"]);
    expect(usFilters({ symbol: "A", fiscal_year: 2026, fiscal_quarter: 2, f1_surprise: true, f2_guidance_up: false, f3_acceleration: true, f4_opm_up: false })).toEqual(["F1", "F3"]);
    expect(usFilters({ symbol: "A", fiscal_year: 2026, fiscal_quarter: 2, f1_surprise: -1, f2_guidance_up: null, f3_acceleration: null, f4_opm_up: null })).toEqual([]);
    const q = hermesQuality([
      { symbol: "NVDA", fiscal_year: 2026, fiscal_quarter: 2, f1_surprise: true, f2_guidance_up: true, f3_acceleration: true, f4_opm_up: false, updated_at: iso("2026-09-01") },
      { symbol: "ZZ", fiscal_year: 2026, fiscal_quarter: 2, f1_surprise: null, f2_guidance_up: null, f3_acceleration: null, f4_opm_up: null },
      { symbol: "AVGO", fiscal_year: 2026, fiscal_quarter: 2, f1_surprise: false, f2_guidance_up: false, f3_acceleration: false, f4_opm_up: false },
    ], (s) => (s === "ZZ" ? null : `US:${s}`), iso("2026-09-28"), r);
    expect(q.map((x) => [x.entity_id, x.strength])).toEqual([["US:NVDA", 7.5], ["US:AVGO", 0]]);
    expect(q[1].observed_at).toBe(iso("2026-09-28"));

    const s = hermesSentiment([
      { analysis_id: 1, created_at: iso("2026-09-20"), sentiment: "긍정적", industries: ["AI인프라반도체"] },
      { analysis_id: 2, created_at: iso("2026-09-25"), sentiment: "긍정적", industries: ["반도체"] },
      { analysis_id: 3, created_at: iso("2026-09-21"), sentiment: "부정적", industries: ["조선"] },
      { analysis_id: 4, created_at: iso("2026-09-21"), sentiment: "중립", industries: ["조선"] },
      { analysis_id: 5, created_at: iso("2026-07-01"), sentiment: "긍정적", industries: ["조선"] },
      { analysis_id: 6, created_at: iso("2026-09-22"), sentiment: null, industries: ["조선"] },
      { analysis_id: 7, created_at: iso("2026-09-22"), sentiment: "긍정적", industries: ["바이오"] },
      { analysis_id: 8, created_at: iso("2026-09-23"), sentiment: "부정적", industries: ["바이오"] },
    ], (l) => ({ AI인프라반도체: ["1a", "1b"], 반도체: ["1b"], 조선: ["1h"], 바이오: ["1d"] } as Record<string, string[]>)[l] ?? [], now, r);
    expect(s.find((x) => x.l1_codes[0] === "1b")).toMatchObject({ strength: 2, direction: 1, observed_at: iso("2026-09-25") });
    expect(s.find((x) => x.l1_codes[0] === "1h")).toMatchObject({ direction: -1, strength: 1 });
    expect(s.find((x) => x.l1_codes[0] === "1d")).toBeUndefined();
  });

  it("Heimdallr 등급·PRI, SnowBall 경보", () => {
    const row = { code: "000660", fiscal_year: 2026, fiscal_quarter: 2, gate_passed: true, score_final: 82, score_delta: 3, pri: 31, base_effect_warning: false, computed_at: iso("2026-09-01") };
    const g = heimdallrGrade([{ ...row, grade: "★" }, { ...row, code: "1", grade: "○", base_effect_warning: true }, { ...row, grade: "✕" }, { ...row, grade: null }], r);
    expect(g.map((x) => x.strength)).toEqual([10, 5]);
    const p = heimdallrPri([{ ...row, grade: "★" }, { ...row, grade: null, pri: null }], now);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ strength: 3.1, evidence: { pri: 31 }, dedupe_key: "hd:pri:000660:2026-09-28" });
    const k = snowballRisk([
      { alert_id: "a1", rule_type: "drawdown", asset_id: "x", ticker: "T", fired_at: iso("2026-09-27"), severity: "critical", title: "t" },
      { alert_id: "a2", rule_type: "drawdown", asset_id: null, ticker: null, fired_at: iso("2026-09-27"), severity: "weird", title: "t" },
    ], (a) => (a ? "KR:1" : null));
    expect(k.map((x) => [x.entity_id, x.strength])).toEqual([["KR:1", 10], [null, 2]]);
  });
});

const sig = (p: Partial<Signal>): Signal => ({
  source: "flywheel", source_ref: "r", kind: "industry_narrative", entity_id: null, l1_codes: [], direction: 1, strength: 0,
  observed_at: iso("2026-09-27"), expires_at: iso("2026-10-10"), evidence: {}, dedupe_key: Math.random().toString(), ...p,
});

describe("axes · queues · regime", () => {
  const A = R.axes;
  const kr: EntityCtx = { id: "KR:000660", market: "KR", l1_codes: ["1b"], screen: { gate_passed: true, score_final: 80, pri: 30, grade: "★" } };
  const signals = [
    sig({ kind: "industry_narrative", l1_codes: ["1b"], strength: 10 }),
    sig({ kind: "industry_narrative", l1_codes: ["1b"], strength: 4 }),
    sig({ kind: "mentor_consensus", entity_id: "KR:000660", strength: 8, source: "sage" }),
    sig({ kind: "mentor_consensus", entity_id: "KR:000660", strength: 10, direction: -1, source: "sage" }),
    sig({ kind: "earnings_catalyst", entity_id: "KR:000660", strength: 8, source: "hermescall" }),
    sig({ kind: "company_mention_fw", entity_id: "KR:000660", strength: 4, expires_at: iso("2026-09-01") }),
    sig({ kind: "company_mention_fw", entity_id: "KR:000660", strength: 6, expires_at: null }),
    sig({ kind: "industry_narrative", l1_codes: ["2e"], strength: 10 }),
  ];

  it("국내: N·C·F·P", () => {
    const a = computeAxes(kr, signals, A, now);
    expect(a).toMatchObject({ n: true, c: true, f: true, p: 30, h: false, families: ["flywheel", "heimdallr", "hermescall", "sage"] });
    const off = computeAxes({ ...kr, screen: { gate_passed: false, score_final: 90, pri: null, grade: "○" } }, [], A, now);
    expect(off).toMatchObject({ n: false, c: false, f: false, p: null, families: [] });
    const noGate = computeAxes({ ...kr, screen: { gate_passed: false, score_final: 90, pri: 10, grade: "○" } }, [], { ...A, F: { ...A.F, kr_gate_required: false } }, now);
    expect(noGate.f).toBe(true);
    expect(computeAxes({ ...kr, screen: { gate_passed: true, score_final: null, pri: 1, grade: null } }, [], A, now).f).toBe(false);
    expect(computeAxes({ ...kr, screen: null, holding: { weight: 0.05, allowed_weight: 0.06, heat_score: 80 } }, [], A, now)).toMatchObject({ f: false, h: true, p: null });
  });

  it("미국: F1/F2 → C, F3&F4 → F, P = pri_us_lite", () => {
    const us: EntityCtx = { id: "US:NVDA", market: "US", l1_codes: ["1a"], usFilters: ["F2", "F3", "F4"], priUsLite: 55 };
    expect(computeAxes(us, [], A, now)).toMatchObject({ c: true, f: true, p: 55, families: ["hermescall"] });
    expect(computeAxes({ ...us, usFilters: null, priUsLite: undefined }, [], A, now)).toMatchObject({ c: false, f: false, p: null });
  });

  it("범위가 정해진 L2 흐름(음식료)은 그 L2 종목에만 붙는다", () => {
    const food: Signal = { source: "flywheel", source_ref: "p", kind: "industry_narrative", entity_id: null, l1_codes: ["2d"], direction: 1, strength: 10, observed_at: "2026-09-30T00:00:00Z", market_date: null, expires_at: null, evidence: { l2: "음식료" }, dedupe_key: "fw:narr:p" };
    const bag: EntityCtx = { id: "KR:194370", market: "KR", l1_codes: ["2d"], l2Scope: { scoped: ["음식료"], member: [] } };
    expect(computeAxes(bag, [food], A, now).n).toBe(false);
    expect(computeAxes({ ...bag, l2Scope: { scoped: ["음식료"], member: ["음식료"] } }, [food], A, now).n).toBe(true);
    expect(computeAxes({ ...bag, l2Scope: undefined }, [food], A, now).n).toBe(true);                                  // 범위 규칙 없음 → L1 전체
    expect(computeAxes(bag, [{ ...food, evidence: {} }], A, now).n).toBe(true);                                        // L2 없는 흐름
    expect(computeAxes(bag, [{ ...food, kind: "mentor_consensus", source: "sage", evidence: { l2: "음식료" } }], A, now).n).toBe(true);   // 산업 흐름 외 신호는 그대로
  });

  it("큐: 순서대로 한 개", () => {
    const Q = R.queues, P = R.axes.P;
    const base = { n: true, c: true, f: true, p: 30, h: false, families: ["flywheel", "heimdallr"], evidence: {} };
    expect(assignQueue({ axes: { ...base, h: true }, heat: 50, holdingAlert: true, daysToEarnings: null }, Q, P)?.queue).toBe("holding_alert");
    expect(assignQueue({ axes: { ...base, h: true, p: 80 }, heat: 80, holdingAlert: false, daysToEarnings: null }, Q, P)?.queue).toBe("take_profit");
    expect(assignQueue({ axes: { ...base, h: true, p: null }, heat: 80, holdingAlert: false, daysToEarnings: null }, Q, P)?.queue).toBe(undefined);
    expect(assignQueue({ axes: { ...base, h: true, p: 80 }, heat: null, holdingAlert: false, daysToEarnings: null }, Q, P)?.queue).toBe("pullback_wait");
    expect(assignQueue({ axes: base, heat: null, holdingAlert: false, daysToEarnings: null }, Q, P)?.queue).toBe("buy");
    expect(assignQueue({ axes: { ...base, families: ["heimdallr"] }, heat: null, holdingAlert: false, daysToEarnings: null }, Q, P)).toBeNull();
    expect(assignQueue({ axes: { ...base, f: false }, heat: null, holdingAlert: false, daysToEarnings: 30 }, Q, P)?.queue).toBe("radar");
    expect(assignQueue({ axes: { ...base, f: false }, heat: null, holdingAlert: false, daysToEarnings: 60 }, Q, P)).toBeNull();
    expect(assignQueue({ axes: { ...base, f: false }, heat: null, holdingAlert: false, daysToEarnings: -1 }, Q, P)).toBeNull();
    expect(assignQueue({ axes: { ...base, f: false }, heat: null, holdingAlert: false, daysToEarnings: null }, Q, P)).toBeNull();
    expect(assignQueue({ axes: { ...base, p: 70 }, heat: null, holdingAlert: false, daysToEarnings: null }, Q, P)?.queue).toBe("pullback_wait");
    expect(assignQueue({ axes: { ...base, p: null }, heat: null, holdingAlert: false, daysToEarnings: null }, Q, P)).toBeNull();
    expect(assignQueue({ axes: { ...base, n: false, c: false, p: 70 }, heat: null, holdingAlert: false, daysToEarnings: null }, Q, P)).toBeNull();
    expect(QUEUE_LABEL.buy).toContain("🎯");
  });

  it("레짐", () => {
    expect(movingAverage([1, 2], 3)).toBeNull();
    expect(movingAverage([1, 2, 3, 4], 2)).toBe(3.5);
    const up = Array.from({ length: 60 }, (_, i) => 2500 + i);
    expect(regime({ snowballRegime: -1, vix: null, kospiCloses: [] }, R.regime)).toMatchObject({ risk_off: true, kospi_ma: null });
    expect(regime({ snowballRegime: 0, vix: 30, kospiCloses: [...up, 2400] }, R.regime).risk_off).toBe(true);
    expect(regime({ snowballRegime: 0, vix: 30, kospiCloses: [...up, 2600] }, R.regime).risk_off).toBe(false);
    expect(regime({ snowballRegime: 1, vix: 18, kospiCloses: [...up, 2400] }, R.regime).risk_off).toBe(false);
  });
});

describe("보유 경고", () => {
  const H = R.queues.holding_alert;
  const held = [
    { asset_id: "a1", entity_id: "KR:000660", name: "SK하이닉스", ticker: "000660", weight: 0.07, allowed_weight: 0.08, heat_score: 60, invalidation: [] },
    { asset_id: "a2", entity_id: null, name: "펀드", ticker: "F", weight: 0.01, allowed_weight: null, heat_score: null, invalidation: [] },
  ];
  it("경보 필터·트리거·등급 하락·멘토 전환", () => {
    const out = holdingAlerts({
      held,
      riskAlerts: [
        { alert_id: "r1", rule_type: "drawdown", asset_id: "a1", ticker: "000660", fired_at: iso("2026-09-27"), severity: "warn", title: "t", payload: { drawdown: -0.23 } },
        { alert_id: "r2", rule_type: "drawdown", asset_id: "a1", ticker: "000660", fired_at: iso("2026-09-27"), severity: "warn", title: "t", payload: { drawdown: -12 } },
        { alert_id: "r3", rule_type: "drawdown", asset_id: "a1", ticker: "000660", fired_at: iso("2026-09-27"), severity: "warn", title: "t", payload: {} },
        { alert_id: "r4", rule_type: "dynamic_weight", asset_id: "a1", ticker: "000660", fired_at: iso("2026-09-27"), severity: "critical", title: "비중 초과" },
        { alert_id: "r5", rule_type: "dynamic_weight", asset_id: "a1", ticker: "000660", fired_at: iso("2026-09-27"), severity: "warn", title: "x" },
        { alert_id: "r6", rule_type: "volume_anomaly", asset_id: "a1", ticker: "000660", fired_at: iso("2026-09-27"), severity: "info", title: "x" },
        { alert_id: "r7", rule_type: "drawdown", asset_id: "zz", ticker: null, fired_at: iso("2026-09-27"), severity: "warn", title: "x", payload: { drawdown: -30 } },
      ],
      triggers: [
        { trigger_id: "t1", asset_id: "a1", direction: "negative", status: "waiting", thesis_link: "훼손", one_line: "CAPEX 둔화" },
        { trigger_id: "t2", asset_id: "a1", direction: "negative", status: "imminent", thesis_link: "훼손", one_line: "고객 이탈" },
        { trigger_id: "t3", asset_id: "a1", direction: "negative", status: "waiting", thesis_link: "훼손", one_line: "known" },
        { trigger_id: "t4", asset_id: "a1", direction: "negative", status: "waiting", thesis_link: "무관", one_line: "x" },
        { trigger_id: "t5", asset_id: "zz", direction: "negative", status: "imminent", thesis_link: "훼손", one_line: "x" },
      ],
      knownTriggerIds: new Set(["t2", "t3"]),
      screens: [
        { code: "000660", prev_grade: "★", grade: "○", score_delta: -2, fiscal: "2026Q2" },
        { code: "000660", prev_grade: "○", grade: "○", score_delta: -6, fiscal: "2026Q3" },
        { code: "000660", prev_grade: null, grade: "○", score_delta: null, fiscal: "2026Q4" },
        { code: "999999", prev_grade: "★", grade: "·", score_delta: -9, fiscal: "2026Q2" },
      ],
      stances: [
        { mentor_id: "m1", entity_id: "KR:000660", stance: "강세", published_at: iso("2026-09-20") },
        { mentor_id: "m1", entity_id: "KR:000660", stance: "약세", published_at: iso("2026-09-26") },
        { mentor_id: "m2", entity_id: "KR:000660", stance: "약세", published_at: iso("2026-09-27") },
        { mentor_id: "m2", entity_id: "KR:000660", stance: "강세", published_at: iso("2026-09-21") },
        { mentor_id: "m3", entity_id: "KR:000660", stance: "강세", published_at: iso("2026-09-21") },
        { mentor_id: "m4", entity_id: "KR:000660", stance: "강세", published_at: iso("2026-08-01") },
        { mentor_id: "m4", entity_id: "KR:000660", stance: "약세", published_at: iso("2026-09-27") },
        { mentor_id: "m5", entity_id: "US:X", stance: "약세", published_at: iso("2026-09-27") },
      ],
    }, H, now);
    const causes = out.map((a) => `${a.cause}:${a.dedupe_key.split(":").slice(2, 4).join(":")}`);
    expect(out.filter((a) => a.cause === "snowball_risk")).toHaveLength(2);
    expect(out.find((a) => a.detail.alert_id === "r1")).toMatchObject({ dedupe_key: "hold:dd:a1:-25" });
    expect(out.find((a) => a.detail.alert_id === "r1")?.summary).toContain("-23.0%");
    expect(out.filter((a) => a.cause === "thesis_trigger").map((a) => a.dedupe_key)).toEqual(["hold:trigger:t1:new", "hold:trigger:t2:imminent"]);
    expect(out.filter((a) => a.cause === "grade_down").map((a) => a.summary)).toEqual(["Heimdallr 등급 ★→○ (2026Q2)", "Heimdallr 점수 -6 (2026Q3)"]);
    expect(out.find((a) => a.cause === "mentor_flip")).toMatchObject({ summary: "강세→약세 전환 멘토 2명", dedupe_key: "hold:flip:KR:000660:m1,m2" });
    expect(causes.length).toBe(7);
  });

  it("멘토 1명 전환은 경고 아님, pct·등급표", () => {
    expect(holdingAlerts({ held, riskAlerts: [], triggers: [], knownTriggerIds: new Set(), screens: [], stances: [
      { mentor_id: "m1", entity_id: "KR:000660", stance: "강세", published_at: iso("2026-09-20") },
      { mentor_id: "m1", entity_id: "KR:000660", stance: "약세", published_at: iso("2026-09-26") },
    ] }, H, now)).toEqual([]);
    expect(pct("-0.5")).toBe(-50);
    expect(pct("abc")).toBeNull();
    expect(pct(null)).toBeNull();
    expect(GRADE_RANK["★"]).toBeGreaterThan(GRADE_RANK["○"]);
    const off = holdingAlerts({ held, riskAlerts: [], knownTriggerIds: new Set(), screens: [{ code: "000660", prev_grade: "?", grade: "!", score_delta: 0, fiscal: "x" }], stances: [],
      triggers: [{ trigger_id: "t9", asset_id: "a1", direction: "negative", status: "imminent", thesis_link: "훼손", one_line: "x" }] }, { ...H, thesis_break_trigger: { ...H.thesis_break_trigger, alert_on: [] } }, now);
    expect(off).toEqual([]);
  });
});

describe("M3 ① 실적 · 종합", () => {
  const RR = R.entry_core.M3_industry_high_growth;
  const pt = (id: string, market: "KR" | "US", fiscal: string, rev: number | null, op: number | null, l1 = ["1b"]): QuarterPoint => ({ entity_id: id, market, l1_codes: l1, fiscal, revenue_yoy: rev, op_yoy: op });
  const kr = (n: number, rev0: number, rev1: number, op = 10) => Array.from({ length: n }, (_, i) => [pt(`K${i}`, "KR", "2026Q2", rev0, op), pt(`K${i}`, "KR", "2026Q1", rev1, op), pt(`K${i}`, "KR", "2025Q4", 1, 1)]).flat();

  it("median·latestQuarters", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    const q = latestQuarters([pt("a", "KR", "2025Q4", 1, 1), pt("a", "KR", "2026Q2", 3, 1), pt("a", "KR", "bad", 0, 0)], 2);
    expect(q.get("a")!.map((x) => x.fiscal)).toEqual(["2026Q2", "2025Q4"]);
  });

  it("통과·미달·국내+미국 합산·판단 불가", () => {
    expect(realizedGrowth("1b", kr(5, 20, 18), RR.realized)).toMatchObject({ pass: true, members: 5, sample: "KR", median_rev_yoy_q0: 20, median_rev_yoy_q1: 18 });
    expect(realizedGrowth("1b", kr(5, 20, 10), RR.realized).pass).toBe(false);
    expect(realizedGrowth("1b", kr(5, 20, 18, -5), RR.realized).pass).toBe(false);
    const mixed = [...kr(3, 20, 20), ...["U1", "U2"].flatMap((u) => [pt(u, "US", "2026Q2", 30, null), pt(u, "US", "2026Q1", 25, 5)])];
    expect(realizedGrowth("1b", mixed, RR.realized)).toMatchObject({ sample: "KR+US", members: 5, pass: true });
    expect(realizedGrowth("1b", kr(2, 30, 30), RR.realized)).toMatchObject({ pass: null, sample: "insufficient", members: 2 });
    expect(realizedGrowth("1b", [...kr(5, 20, 18)].map((p) => ({ ...p, op_yoy: null })), RR.realized).median_op_yoy).toBeNull();
    const one = realizedGrowth("1b", kr(5, 20, 18), { ...RR.realized, consecutive_quarters: 1 });
    expect(one).toMatchObject({ pass: true, median_rev_yoy_q1: 20 });
  });

  it("③ yaml 전망 · 종합 · 표시", () => {
    const today = new Date("2026-09-28T00:00:00Z");
    const o = outlookPass([
      { source_type: "research", segment: "AI", cagr_3y_pct: 15.7, source: "Gartner", as_of: "2026-09", url: "u" },
      { source_type: "research", cagr_3y_pct: 30, source: "old", as_of: "2025-08" },
      { source_type: "research", cagr_3y_pct: 10, source: "low", as_of: "2026-09" },
      { source_type: "broker", cagr_3y_pct: 30, source: "x", as_of: "2026-09" },
      { source_type: "company", cagr_3y_pct: 30, as_of: "2026-09" },
      { source_type: "company", cagr_3y_pct: 30, source: "s", as_of: "bad" },
    ], RR.outlook, today);
    expect(o.map((x) => x.source)).toEqual(["Gartner"]);
    const realized = realizedGrowth("1b", kr(5, 24, 21), RR.realized);
    const broker = { median: 30, pass: true, brokers: 1, detail: [{ broker: "Morgan Stanley", value: 30, published: "2026-09-12", rule: "A1" }] };
    const m = m3ForL1("1b", realized, broker, [], RR);
    expect(m).toMatchObject({ pass: true, bases: { realized: true, us_major_broker: true, outlook: false } });
    expect(m3Line(m, "반도체")).toBe("①실적 반도체 매출 YoY 중앙값 +24%·+21% (표본 5) · ②Morgan Stanley 30% (09/12)");
    expect(m3Line(m3ForL1("1a", null, null, o, RR), "AI")).toBe("③Gartner 15.7%");
    expect(m3Line(m3ForL1("2e", null, null, [], RR), "여행")).toBe("성장 근거 없음");
    expect(m3ForL1("1b", realized, null, [], { ...RR, required_bases: ["us_major_broker"] }).pass).toBe(false);
    expect(m3Line(m3ForL1("1b", { ...realized, median_rev_yoy_q1: null }, null, [], RR), "반도체")).toContain("-");
    expect(m3ForEntity(["1a", "1b", "zz"], { "1b": m, "1a": m3ForL1("1a", null, null, o, RR) })).toEqual({ pass: true, passed: ["1a", "1b"], basis: ["outlook", "realized", "us_major_broker"] });
    expect(m3ForEntity(["2e"], {})).toEqual({ pass: false, passed: [], basis: [] });
  });
});

describe("M4 이벤트", () => {
  it("SnowBall 트리거 창 환산·필터", () => {
    const t = (id: string, p: Partial<Parameters<typeof fromSnowball>[0][number]>) => ({ trigger_id: id, asset_id: "a1", direction: "positive", status: "waiting", expected_date: null, expected_window: "0-1Q", one_line: "수주", source_url: "u", updated_at: iso("2026-09-01"), category: "수주", ...p });
    const ev = fromSnowball([t("1", {}), t("2", { expected_window: "4Q+" }), t("3", { direction: "negative" }), t("4", { status: "done" }), t("5", { asset_id: "zz" }),
      t("6", { expected_date: "2026-11-15T00:00:00Z" }), t("7", { expected_window: null }), t("8", { category: null, expected_window: "1-2Q" })], (a) => (a === "a1" ? "KR:1" : null));
    expect(ev.map((e) => [e.dedupe_key, e.date, e.window_end])).toEqual([["sb:1", null, "2026-12-01"], ["sb:6", "2026-11-15", null], ["sb:8", null, "2027-03-02"]]);
    expect(ev[2].source).toBe("SnowBall 트리거(-·1-2Q)");
  });

  it("HermesCall 타임라인(신·구형)·Heimdallr 트리거·실적·yaml", () => {
    const h = fromHermes([
      { analysis_id: 9, beneficiary_id: 1, entity_id: "KR:1", created_at: iso("2026-09-01"), timeline: { within_3m: ["수주 확인", { event: "증설", expected_by: "2026-11-30" }, "", 3], within_6m: ["신규 고객"], "2Q_내": [{ title: "구형" }] } },
      { analysis_id: 9, beneficiary_id: 2, entity_id: null, created_at: iso("2026-09-01"), timeline: { within_3m: ["x"] } },
      { analysis_id: 9, beneficiary_id: 3, entity_id: "KR:2", created_at: iso("2026-09-01"), timeline: { within_3m: ["x"] }, direction: "하향" },
      { analysis_id: 9, beneficiary_id: 4, entity_id: "KR:3", created_at: iso("2026-09-01"), timeline: null },
      { analysis_id: 9, beneficiary_id: 5, entity_id: "KR:4", created_at: iso("2026-09-01"), timeline: { within_3m: "not array" } },
    ]);
    expect(h.map((e) => [e.title, e.date, e.window_end])).toEqual([
      ["수주 확인", null, "2026-11-30"], ["증설", "2026-11-30", null], ["신규 고객", null, "2027-02-28"], ["구형", null, "2027-02-28"],
    ]);
    expect(monthEnd("2026-11")).toBe("2026-11-30");
    expect(monthEnd("2026-02-10")).toBe("2026-02-10");
    expect(monthEnd("11월")).toBeNull();
    const hd = fromHeimdallr([
      { id: 1, code: "000660", created_at: iso("2026-09-01"), grade: "★", triggers: { within_3m: [{ event: "3Q OPM 확인", expected_date: "2026-11" }, { event: "공시", expected_date: 5 }, { nope: 1 }, null] } },
      { id: 2, code: "1", created_at: iso("2026-09-01"), grade: "·", triggers: { within_3m: [{ event: "x" }] } },
      { id: 3, code: "2", created_at: iso("2026-09-01"), grade: "○", triggers: null },
      { id: 4, code: "3", created_at: iso("2026-09-01"), grade: "○", triggers: { within_3m: "x" } },
      { id: 5, code: "4", created_at: iso("2026-09-01"), grade: null, triggers: {} },
    ], ["★", "○"]);
    expect(hd.map((e) => [e.title, e.date, e.window_end])).toEqual([["3Q OPM 확인", "2026-11-30", null], ["공시", null, "2026-11-30"]]);
    const er = fromEarnings([
      { entity_id: "KR:1", next_date: "2026-11-14", estimated: true, consensus_change_30d_pct: 3.26, source: "Heimdallr 컨센" },
      { entity_id: "US:A", next_date: "2026-11-01", estimated: false, consensus_change_30d_pct: -1, source: "x" },
      { entity_id: "US:B", next_date: null, estimated: false, consensus_change_30d_pct: 5, source: "x" },
      { entity_id: "US:C", next_date: "2026-11-01", estimated: false, consensus_change_30d_pct: null, source: "x" },
    ], 0);
    expect(er.map((e) => e.title)).toEqual(["다음 실적(예상일) · 30일 컨센 +3.3%"]);
    expect(fromEarnings([{ entity_id: "US:D", next_date: "2026-11-01", estimated: false, consensus_change_30d_pct: 0.5, source: "x" }], 0)[0].title).toBe("다음 실적 · 30일 컨센 +0.5%");
    const y = fromYaml([
      { scope: "industry", l1: "1b", title: "HBM", window_end: "2027-03-31", direction: "up", source: "컨콜", url: "" },
      { scope: "company", entity: "KR:1", title: "x", date: "2026-10-10", direction: "down", source: "s" },
      { scope: "macro", title: "FOMC", date: "2026-10-28", direction: "neutral", source: "fw" },
      { scope: "industry", l1: "1b", title: "no source", date: "2026-10-01", direction: "up" },
      { scope: "bad", title: "x", date: "2026-10-01", direction: "up", source: "s" },
      { scope: "industry", l1: "1b", title: "no date", direction: "up", source: "s" },
    ]);
    expect(y.map((e) => [e.scope, e.direction, e.url])).toEqual([["industry", "up", null], ["company", "down", null], ["macro", "neutral", null]]);
  });

  it("종목 M4: 기업·산업, 180일 창, 가까운 2개", () => {
    const ev = [
      ...fromYaml([{ scope: "industry", l1: "1b", title: "산업", window_end: "2027-03-01", direction: "up", source: "s" }]),
      ...fromYaml([{ scope: "industry", l1: "1b", title: "너무 멂", window_end: "2027-06-01", direction: "up", source: "s" }]),
      ...fromYaml([{ scope: "company", entity: "KR:1", title: "기업", date: "2026-10-20", direction: "up", source: "s" }]),
      ...fromYaml([{ scope: "company", entity: "KR:1", title: "지난", date: "2026-09-01", direction: "up", source: "s" }]),
      ...fromYaml([{ scope: "company", entity: "KR:1", title: "하락", date: "2026-10-01", direction: "down", source: "s" }]),
      ...fromYaml([{ scope: "company", entity: "KR:1", title: "세번째", date: "2026-12-01", direction: "up", source: "s" }]),
    ];
    const r = m4ForEntity("KR:1", ["1b"], ev, "2026-09-28", 180);
    expect(r.pass).toBe(true);
    expect(r.nearest.map((e) => e.title)).toEqual(["기업", "세번째"]);
    expect(m4ForEntity("KR:9", ["2e"], ev, "2026-09-28", 180)).toEqual({ pass: false, nearest: [] });
  });
});

describe("explain — 결론·근거 문장", () => {
  it("신호 설명", async () => {
    const { describeSignal } = await import("./explain");
    expect(describeSignal("industry_narrative", 10, { l2: "반도체", signal_strength: 5 })).toBe("FlyWheel 반도체 흐름 강도 5/5");
    expect(describeSignal("industry_narrative", 8, {})).toBe("FlyWheel 산업 흐름 강도 4/5");
    expect(describeSignal("company_mention_fw", 6, { mentions_14d: 2 })).toBe("FlyWheel 위키 최근 14일 언급 2건");
    expect(describeSignal("company_mention_fw", 6, {})).toBe("FlyWheel 위키 최근 14일 언급 ?건");
    expect(describeSignal("mentor_consensus", 8, { bullish: ["a", "b", "c"] })).toBe("Sage 멘토 3명 강세");
    expect(describeSignal("mentor_consensus", 8, {})).toBe("Sage 멘토 ?명 강세");
    expect(describeSignal("mentor_consensus", 8, { bullish: ["a", "b"], scope: "industry" })).toBe("Sage 멘토 2명 강세(산업 전체)");
    expect(describeSignal("earnings_catalyst", 8, { leader: "NVDA" })).toBe("HermesCall NVDA 실적 수혜 강도 8/10");
    expect(describeSignal("earnings_catalyst", 8, {})).toBe("HermesCall 미국 대장주 실적 수혜 강도 8/10");
    expect(describeSignal("x", 1, {})).toBe("x 1");
  });

  it("큐별 결론 + 근거 (국내·미국·기술 참고)", async () => {
    const { explain, pLevel, rsiBand } = await import("./explain");
    expect([rsiBand(75), rsiBand(25), rsiBand(50)]).toEqual(["과열권", "과매도권", "중립"]);
    expect([pLevel(null), pLevel(10), pLevel(50), pLevel(80)]).toEqual(["계산 전", "덜 반영", "보통", "많이 반영"]);
    const kr = explain({ queue: "buy", market: "KR", p: 14.9, evidence: {
      F: { gate_passed: true, score: 82.25, grade: "★" }, P: { value: 14.9, basis: "PRI" }, families: ["flywheel", "heimdallr", "sage"],
      N: [{ kind: "industry_narrative", strength: 10, detail: "FlyWheel 반도체 흐름 강도 5/5" }, { kind: "mentor_consensus", strength: 8 }],
      C: { catalyst: { strength: 8, detail: "HermesCall NVDA 실적 수혜 강도 8/10" }, us_filters: [] } },
      tech: { source: "Heimdallr 기술 셋업", as_of: "2026-09-23", rsi: 51.1, rsi_note: "상승 아님", macd_note: "시그널 아래", price_note: "하락 중 반등 접근" } });
    expect(kr.conclusion).toBe("매수 검토 후보 — 실적 숫자가 좋고 주가는 덜 반영(15), FlyWheel·Heimdallr·Sage 3곳 신호 합의");
    expect(kr.reasons).toEqual([
      "실적 숫자: Heimdallr ★ · 점수 82 · 게이트 통과",
      "주가 반영도: 15/100 (덜 반영) — 낮을수록 좋은 실적이 주가에 덜 반영됨",
      "산업·종목 이야기: FlyWheel 반도체 흐름 강도 5/5 · Sage 멘토 ?명 강세",
      "실적 촉매: HermesCall NVDA 실적 수혜 강도 8/10",
      "기술적 참고(판정 미사용): MACD 시그널 아래 · RSI 51(중립, 상승 아님) · 가격 하락 중 반등 접근 — Heimdallr 기술 셋업 2026-09-23",
    ]);
    const gateNo = explain({ queue: "pullback_wait", market: "KR", p: 70, evidence: { F: { gate_passed: false, score: 90, grade: null } } });
    expect(gateNo.reasons[0]).toBe("실적 숫자: Heimdallr 등급 없음 · 점수 90 · 게이트 미통과");
    expect(gateNo.conclusion).toContain("눌림 대기 — 실적은 좋지만 주가가 이미 많이 반영(70)");
    expect(explain({ queue: "buy", market: "KR", p: null, evidence: { F: { score: undefined, grade: "○" } } }).reasons[0]).toBe("실적 숫자: Heimdallr ○ · 점수 -");
    const us = explain({ queue: "radar", market: "US", p: null, daysToEarnings: 30, evidence: { C: { catalyst: { strength: 7 }, us_filters: ["F2", "X9"] }, families: [] } });
    expect(us.conclusion).toBe("실적 발표 30일 전 선행 관찰 — 이야기·촉매는 켜졌고 실적 숫자는 아직 확인 전");
    expect(us.reasons).toEqual(["실적 숫자: 가이던스 상향 · X9", "실적 촉매: 수혜 강도 7/10"]);
    expect(explain({ queue: "radar", market: "US", p: null, evidence: { F: { us_filters: ["F3", "F4"] } } }).reasons[0]).toBe("실적 숫자: 성장 가속 · 영업이익률 개선");
    expect(explain({ queue: "radar", market: "US", p: null, evidence: {} }).conclusion).toContain("? 일 전".replace(" ", ""));
    expect(explain({ queue: "take_profit", market: "KR", p: 80, heat: 78, evidence: {} }).conclusion).toBe("익절 검토 — 과열 78점, 주가 반영도 80로 높음 (SnowBall 익절 사다리 확인)");
    expect(explain({ queue: "take_profit", market: "KR", p: null, evidence: {} }).conclusion).toContain("과열 -점, 주가 반영도 -");
    expect(explain({ queue: "holding_alert", market: "KR", p: null, evidence: {} }).conclusion).toContain("보유 경고");
    expect(explain({ queue: "buy", market: "US", p: 30, evidence: {}, tech: { source: "s", as_of: null, rsi: null, rsi_note: null, macd_note: null, price_note: null } }).reasons).toEqual(["주가 반영도: 30/100 (덜 반영) — 낮을수록 좋은 실적이 주가에 덜 반영됨"]);
    expect(explain({ queue: "buy", market: "US", p: 30, evidence: {}, tech: { source: "s", as_of: null, rsi: 40, rsi_note: null, macd_note: null, price_note: null } }).reasons[1]).toBe("기술적 참고(판정 미사용): RSI 40(중립) — s");
    expect(explain({ queue: "pullback_wait", market: "KR", p: null, evidence: {} }).conclusion).toContain("계산 전(-)");
    expect(explain({ queue: "buy", market: "KR", p: 10, evidence: { tech: { source: "저장", as_of: "2026-09-29", rsi: 72, rsi_note: null, macd_note: null, price_note: null } } }).reasons[1]).toBe("기술적 참고(판정 미사용): RSI 72(과열권) — 저장 2026-09-29");
  });
});
