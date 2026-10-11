import { describe, expect, it } from "vitest";
import type { FeedbackRules, PerfStat } from "./feedback";
import { admits, assess, bucketTitle, candidatePool, derivePolicies, derivePolicy, policyFor, priorScope, type Assessed, type PolicyRules } from "./pick-policy";
import type { Timing, TimingRules } from "./timing";

const TR: TimingRules = {
  p: { great_max: 25, good_max: 40 }, p_weight: 1, setup: { require: false, just_after_days: 3, base: { drawdown_min_pct: -20, drawdown_max_pct: -10, days_min: 10 } }, position: { chase_above_pct: -5, pullback1_pct: -10, pullback2_pct: -20 }, rsi: { overheat_min: 70, near_hot_min: 65, rebound_max: 45 }, flow_days: 2, event_within_days: 90,
  points: { p_great: 2, p_good: 1, p_high: -1, pullback: 1, pullback2: 1, chase: -1, rsi_hot: -2, rsi_rebound: 1, cross: 1, trend_down: -1, base: 1, flow_buy: 2, flow_proxy: 1, flow_sell: -1, event: 1, risk_off: -1 },
  verdict: { high_min: 4, mid_min: 1 },
};

const PR: PolicyRules = { auto_apply: true, min_samples: 30, target_hit_rate: 0.55, min_gap_pctp: 2, base_exclude_verdicts: ["wait"], scope: "pick_all", promote_from: ["pullback_wait"] };
const FR: FeedbackRules = { basis: "absolute", report_horizons: [10, 20], primary_horizon: 20, min_samples: 30, shrinkage_k: 30, dimensions: ["market", "timing_verdict", "timing_check", "timing_score"], p_buckets: [20, 30, 40], timing_score_buckets: [1, 4, 6], review: { min_gap_pctp: 2 } };
const st = (dimension: string, bucket: string, n: number, median_excess: number | null, hit_rate: number | null, extra: Partial<PerfStat> = {}): PerfStat => ({ scope: "pick_all", dimension, bucket, horizon_days: 20, n, median_excess, hit_rate, ...extra });

describe("derivePolicy — 사후 검증으로 추천 기준 배우기", () => {
  const stats = [
    st("all", "all", 120, 1, 0.55),
    st("timing_verdict", "high", 40, 4, 0.7), st("timing_verdict", "mid", 50, -2, 0.4), st("timing_verdict", "wait", 30, -3, 0.3),
    st("timing_check", "rsi:fail", 35, -4, 0.35), st("timing_check", "flow:pass", 45, 5, 0.68), st("timing_check", "flow:none", 60, -5, 0.2),
    st("timing_check", "position:warn", 10, -9, 0.1),            // 표본 부족 → 무시
    st("timing_score", "<1", 30, -3, 0.5), st("timing_score", "4~6", 30, 1.5, 0.6),   // 중간 성과 → 무시
    st("timing_check", "p:pass", 40, 9, 0.5),                    // 승률 미달 → 우수 아님
    st("timing_verdict", "high", 99, 9, 0.9, { scope: "pick" }), st("timing_verdict", "mid", 99, -9, 0.1, { horizon_days: 5 }),
  ];
  it("승률 낮은 구간은 제외, 좋은 구간은 우수 — 표본 부족·가장 좋은 단계는 제외하지 않음", () => {
    const p = derivePolicy(stats, PR, 20, "2026-11-30");
    expect(p).toMatchObject({ as_of: "2026-11-30", horizon: 20, basis: "excess", phase: null, applied: true, overall: { n: 120, hit_rate: 0.55, median_excess: 1 } });
    expect(p.exclude.map((x) => x.title)).toEqual(["매수 매력 ⚖️ 분할 접근", "매수 매력 ⏸️ 대기", "RSI 과열 탈락", "매수 매력 점수 <1"]);
    expect(p.prefer.map((x) => x.title)).toEqual(["매수 매력 🔥 매력 높음", "외국인·기관 수급 통과"]);
    expect(p.exclude[0].evidence).toBe("20거래일 뒤 승률 40% · 시장 대비 중앙값 -2.0% (50건) vs 후보 전체 20거래일 뒤 승률 55% · 시장 대비 중앙값 +1.0% (120건)");
    // 가장 좋은 단계가 나빠도 빼지 않는다(추천이 끊겨 학습이 멈추지 않게)
    const bad = derivePolicy([st("all", "all", 100, 3, 0.6), st("timing_verdict", "high", 40, -1, 0.4), st("timing_verdict", "mid", 40, -2, 0.3)], PR, 20, null);
    expect(bad.exclude.map((x) => x.bucket)).toEqual(["mid"]);
  });
  it("자료 없음·중앙값 없음 → 빈 기준, 자동 적용 끔", () => {
    expect(derivePolicy([], PR, 20, null)).toEqual({ as_of: null, horizon: 20, basis: "excess", phase: null, applied: true, overall: null, exclude: [], prefer: [] });
    expect(derivePolicy([st("all", "all", 3, null, null)], { ...PR, auto_apply: false }, 20, null)).toMatchObject({ applied: false, overall: { n: 3 }, exclude: [] });
  });
  it("구간 이름", () => {
    expect(bucketTitle("check", "zz:yy")).toBe("zz yy");
    expect(bucketTitle("verdict", "x")).toBe("매수 매력 x");
    expect(bucketTitle("check", "event:none")).toBe("가까운 상승 이벤트 해당 없음");
    expect(bucketTitle("path", "base")).toBe("주가 위치 B 조정 후 횡보");
    expect(bucketTitle("path", "zz")).toBe("주가 위치 zz");
  });
  it("절대 수익률 채점(D69) — 수익률 중앙값으로 비교, 주가 위치 경로도 학습(가장 좋은 경로는 보호)", () => {
    const abs = [
      st("all", "all", 100, -1, 0.6, { median_ret: 3 }),
      st("setup_path", "ma", 40, -2, 0.4, { median_ret: -1 }), st("setup_path", "base", 40, 0, 0.7, { median_ret: 6 }), st("setup_path", "none", 40, 0, 0.1, { median_ret: -9 }),
      st("timing_check", "base:pass", 40, 0, 0.7, { median_ret: null }),
    ];
    const p = derivePolicy(abs, PR, 20, "d", "absolute");
    expect(p.exclude.map((x) => x.title)).toEqual(["주가 위치 A 5·10일선 돌파"]);
    expect(p.prefer.map((x) => x.title)).toEqual(["주가 위치 B 조정 후 횡보"]);
    expect(p.exclude[0].evidence).toBe("20거래일 뒤 승률 40% · 수익률 중앙값 -1.0% (40건) vs 후보 전체 20거래일 뒤 승률 60% · 수익률 중앙값 +3.0% (100건)");
    expect(p.overall).toEqual({ n: 100, hit_rate: 0.6, median_excess: -1, median_ret: 3 });
    // 가장 좋은 경로는 나빠도 빼지 않는다
    const worst = derivePolicy([st("all", "all", 100, 0, 0.6, { median_ret: 5 }), st("setup_path", "ma", 40, 0, 0.3, { median_ret: -1 }), st("setup_path", "base", 40, 0, 0.2, { median_ret: -3 })], PR, 20, null, "absolute");
    expect(worst.exclude.map((x) => x.bucket)).toEqual(["base"]);
    expect(derivePolicy([st("all", "all", 5, 1, 0.5)], PR, 20, null, "absolute").exclude).toEqual([]);
  });
  it("시장 국면별 기준(D69) — 국면 표본이 충분할 때만, 없으면 전체 기준", () => {
    const stats = [
      st("all", "all", 120, 1, 0.55), st("timing_verdict", "mid", 50, -2, 0.4), st("timing_verdict", "high", 40, 4, 0.7),
      st("all", "all", 40, 2, 0.6, { scope: "pick_all@up" }), st("timing_verdict", "mid", 30, 5, 0.7, { scope: "pick_all@up" }),
      st("all", "all", 10, -2, 0.3, { scope: "pick_all@down" }),
    ];
    const set = derivePolicies(stats, PR, 20, "d", "excess");
    expect(Object.keys(set.by_phase)).toEqual(["up"]);
    expect(set.by_phase.up).toMatchObject({ phase: "up", overall: { n: 40 }, exclude: [] });
    expect(set.overall?.exclude.map((x) => x.bucket)).toEqual(["mid"]);
    expect(policyFor(set, "up")).toBe(set.by_phase.up);
    expect(policyFor(set, "down")).toBe(set.overall);
    expect(policyFor(set, null)).toBe(set.overall);
    expect(policyFor(set.overall, "up")).toBe(set.overall);
    expect(policyFor(null, "up")).toBeNull();
    expect(priorScope(stats, PR, 20, "up")).toBe("pick_all@up");
    expect(priorScope(stats, PR, 20, "down")).toBe("pick_all");
  });
});

describe("admits — TOP 추천 자격", () => {
  const t: Timing = { pullback: 1, score: 2, verdict: "mid", checks: [{ key: "rsi", mark: "fail", pts: -2, text: "" }, { key: "flow", mark: "pass", pts: 2, text: "" }], setup: { required: true, ok: true, why: [], path: "ma", parts: null } };
  const policy = derivePolicy([st("all", "all", 120, 1, 0.55), st("timing_check", "rsi:fail", 35, -4, 0.35), st("timing_verdict", "mid", 40, -3, 0.3), st("timing_verdict", "high", 40, 4, 0.7), st("timing_score", "1~4", 40, -3, 0.3)], PR, 20, "d");
  it("필수 조건(MACD 돌파 ∧ 주가 위치 A·B) 미충족 → 제외, 필수 아니면 통과 (D69)", () => {
    const bad = { ...t, setup: { required: true, ok: false, why: ["주가 위치: x", "MACD 시그널 상향 돌파 직전·직후 아님"], path: null, parts: null } };
    expect(admits(bad, null, PR, FR.timing_score_buckets)).toEqual({ ok: false, why: ["필수 조건: 주가 위치: x", "필수 조건: MACD 시그널 상향 돌파 직전·직후 아님"] });
    expect(admits({ ...bad, setup: { ...bad.setup, required: false } }, null, PR, FR.timing_score_buckets).ok).toBe(true);
  });
  it("비중 한도(D69) — 보유 비중이 허용 비중 이상이면 제외", () => {
    expect(admits(t, null, PR, FR.timing_score_buckets, { weight: 0.1, allowed_weight: 0.1 })).toEqual({ ok: false, why: ["비중 한도: 보유 10.0% ≥ 허용 10.0%"] });
    expect(admits(t, null, PR, FR.timing_score_buckets, { weight: 0.05, allowed_weight: 0.1 }).ok).toBe(true);
    expect(admits(t, null, PR, FR.timing_score_buckets, { weight: null, allowed_weight: 0.1 }).ok).toBe(true);
    expect(admits(t, null, PR, FR.timing_score_buckets, null).ok).toBe(true);
  });
  it("배운 기준 — 주가 위치 경로 제외", () => {
    const pol = derivePolicy([st("all", "all", 100, 3, 0.6), st("setup_path", "ma", 40, -1, 0.4), st("setup_path", "base", 40, 5, 0.7)], PR, 20, "d");
    expect(admits(t, pol, PR, FR.timing_score_buckets).why).toContain("사후 검증: 주가 위치 A 5·10일선 돌파 승률 낮음");
  });
  it("기본 기준: ⏸️ 대기 제외", () => {
    expect(admits({ ...t, verdict: "wait" }, null, PR, FR.timing_score_buckets)).toEqual({ ok: false, why: ["기본 기준: ⏸️ 대기"] });
    expect(admits(t, null, PR, FR.timing_score_buckets)).toEqual({ ok: true, why: [] });
  });
  it("배운 기준 적용 — 단계·항목·점수 구간", () => {
    expect(admits(t, policy, PR, FR.timing_score_buckets).why).toEqual(["사후 검증: 매수 매력 ⚖️ 분할 접근 승률 낮음", "사후 검증: RSI 과열 탈락 승률 낮음", "사후 검증: 매수 매력 점수 1~4 승률 낮음"]);
    expect(admits({ ...t, verdict: "high", score: 7, checks: [] }, policy, PR, FR.timing_score_buckets).ok).toBe(true);
    expect(admits(t, { ...policy, applied: false }, PR, FR.timing_score_buckets).ok).toBe(true);
  });
});

describe("assess — 브리핑·대시보드 공용 후보 평가", () => {
  const R = { buy_timing: TR, pick_policy: PR, feedback: FR };
  const ev = { families: ["sage", "heimdallr"], F: { grade: "★" }, next_event: "2026-10-14",
    idea: { thesis: null, growth: null, industry: null, events: [{ when: "10/14", title: "실적", source: "s" }], risk: null, flow: { kind: "proxy" as const, as_of: "d", pass: true, streak: 2 } } };
  it("타이밍·특징·자격·성과 가중", () => {
    const a = assess({ ev, p: 20, market: "US", l1: "1b", riskOff: false, today: "2026-10-04" }, R, null, []);
    expect(a.timing.score).toBe(2 + 1 + 1);
    expect(a.timing.verdict).toBe("high");
    expect(a.admit.ok).toBe(true);
    expect(a.features).toEqual({ families: ["heimdallr", "sage"], p: 20, grade: "★", market: "US", l1: "1b", timing: { score: 4, verdict: "high", checks: { p: "pass", position: "none", flow: "pass", event: "pass" }, path: null, pullback: 0 } });
    expect(assess({ ev, p: 20, market: "US", l1: "1b", riskOff: false, today: "2026-10-04", phase: "up" }, R, null, []).features.phase).toBe("up");
    expect(a.scope).toBe("buy");
    expect(a.prior.score).toBeNull();
    const b = assess({ ev: {}, p: null, market: "KR", l1: null, riskOff: true, today: "2026-10-04" }, R, null, []);
    expect(b.admit.ok).toBe(false);
    // 필수 조건을 켜면 가격 자료가 없는 후보는 제외
    const c = assess({ ev, p: 20, market: "US", l1: "1b", riskOff: false, today: "2026-10-04" }, { ...R, buy_timing: { ...TR, setup: { require: true, just_after_days: 3, base: { drawdown_min_pct: -20, drawdown_max_pct: -10, days_min: 10 } } } }, null, []);
    expect(c.admit).toEqual({ ok: false, why: ["필수 조건: 가격 자료 없음"] });
  });
  it("후보 전체 표본이 충분하면 그 성과로 가중", () => {
    const stats = [st("all", "all", 40, 1, 0.6, { median_ret: 2 }), st("market", "US", 40, 3, 0.6, { median_ret: 4 }), st("timing_check", "flow:pass", 40, 5, 0.7, { median_ret: 6 })];
    expect(priorScope(stats, PR, 20)).toBe("pick_all");
    expect(priorScope(stats, PR, 5)).toBe("buy");
    const a = assess({ ev, p: 20, market: "US", l1: "1b", riskOff: false, today: "2026-10-04" }, R, null, stats);
    expect(a.scope).toBe("pick_all");
    expect(a.prior.basis.map((x) => x.bucket)).toEqual(["US", "flow:pass"]);
  });
});

describe("candidatePool — 🎯 매수 검토 + 상승 초기 조건을 만족한 ⏳ 눌림 대기 (D66)", () => {
  const a = (ok: boolean) => ({ timing: { setup: { ok } } }) as unknown as Assessed;
  it("buy 는 전부, pullback_wait 은 setup 통과만, 그 외 큐는 제외", () => {
    const xs = [{ id: "b", queue: "buy", a: a(false) }, { id: "p1", queue: "pullback_wait", a: a(true) }, { id: "p2", queue: "pullback_wait", a: a(false) }, { id: "r", queue: "radar", a: a(true) }];
    expect(candidatePool(xs, PR.promote_from).map((x) => [x.id, x.promoted])).toEqual([["b", false], ["p1", true]]);
    expect(candidatePool(xs, []).map((x) => x.id)).toEqual(["b"]);
  });
});
