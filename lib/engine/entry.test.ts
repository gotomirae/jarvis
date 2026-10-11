import { describe, expect, it } from "vitest";
import { conds, entryLevel, entryTag, freshOrStale, invalidationPrice, missing, normalizeCheck, passOf, type Conds } from "./entry";
import { armedOn, fromH1, fromK1, ymd } from "./breakout";
import { condLines, m1Text, m2Text, m5Text, priceText } from "./entry-view";
import { gateDecision, rankGreen, selectToSend, tradingDaysAhead, tradingDaysBack, type GateRules } from "./gate";
import { percentile, priUsLite, priUsParts } from "./pri-us-lite";

const OPEN = { allowed: true, reasons: [] };
const SHUT = { allowed: false, reasons: ["x"] };

describe("SC6 — 🟢 는 M1~M5 전부 true + 게이트 허용일 때만 (32개 조합 전수)", () => {
  const combos = Array.from({ length: 32 }, (_, i) => ({ m1: !!(i & 1), m2: !!(i & 2), m3: !!(i & 4), m4: !!(i & 8), m5: !!(i & 16) }));
  it.each(combos)("%o", (c) => {
    const all = c.m1 && c.m2 && c.m3 && c.m4 && c.m5;
    expect(entryLevel(c, OPEN) === "green").toBe(all);
    expect(entryLevel(c, SHUT)).not.toBe("green");                      // 게이트는 거부만 할 수 있다
    const yellow = c.m1 && c.m2 && [c.m3, c.m4, c.m5].filter(Boolean).length >= 2;
    expect(entryLevel(c, SHUT)).toBe(yellow ? "yellow" : "none");
    if (!all) expect(entryLevel(c, OPEN)).toBe(yellow ? "yellow" : "none");
  });
  it("진리값이 아닌 값으로 우회 불가", () => {
    const truthy = { m1: 1, m2: "y", m3: true, m4: true, m5: true } as unknown as Parameters<typeof entryLevel>[0];
    expect(entryLevel(truthy, OPEN)).not.toBe("green");
    expect(entryLevel({ m1: true, m2: true, m3: true, m4: true, m5: true }, { allowed: 1 } as unknown as typeof OPEN)).not.toBe("green");
  });
});

describe("normalizeCheck · freshOrStale", () => {
  const kr = { check_date: "2026-10-01", m1_pass: true, m2_pass: false, m5_pass: null, m1_detail: { price_state: "PB" }, m2_detail: { cross_today: true }, low_10d: 7800, low_20d: "7500", invalidation_price: "" };
  it("국내: 원천 값 그대로, 누락은 데이터 없음", () => {
    const c = normalizeCheck(kr, "KR");
    expect(c.m1.pass).toBe(true);
    expect(c.m2).toEqual({ pass: false, reason: "MACD 교차 직전 아님" });
    expect(c.m5).toEqual({ pass: false, reason: "데이터 없음(m5_pass)" });
    expect(c).toMatchObject({ price_state: "PB", cross_today: true, low_10d: 7800, low_20d: 7500, invalidation_price: null, check_date: "2026-10-01" });
    const bare = normalizeCheck({}, "KR");
    expect(bare).toMatchObject({ check_date: "", price_state: null, cross_today: false, low_10d: null, detail: { m1: null, m2: null, m5: null } });
    expect(bare.m1.reason).toBe("데이터 없음(m1_pass)");
    expect(normalizeCheck({ m1_pass: false }, "KR").m1.reason).toBe("실적·주가 조건 미충족");
  });
  it("미국: M1 은 pri_us_lite < 50 까지", () => {
    const us = { check_date: "2026-10-01", m1_pass: true, m2_pass: true, m5_pass: true, m1_detail: { price_state: "SW" } };
    expect(normalizeCheck(us, "US", 31).m1.pass).toBe(true);
    expect(normalizeCheck(us, "US", 55).m1.reason).toBe("주가 반영도 55 ≥ 50");
    expect(normalizeCheck(us, "US", null).m1.reason).toBe("데이터 없음(미국 주가 반영도)");
    expect(normalizeCheck({ ...us, m1_pass: false }, "US", 10).m1.pass).toBe(false);
  });
  it("원천 지연이면 M1·M2·M5 모두 false", () => {
    const c = normalizeCheck({ ...kr, m5_pass: true, m2_pass: true }, "KR");
    expect(freshOrStale(c, "2026-10-01")).toBe(c);
    expect(freshOrStale(c, null)).toBe(c);
    const s = freshOrStale(c, "2026-10-02");
    expect([s.m1.pass, s.m2.pass, s.m5.pass]).toEqual([false, false, false]);
    expect(s.m1.reason).toBe("원천 지연(2026-10-01 기준, 기대 2026-10-02)");
  });
});

describe("태그 · 무효화선 · 조건 묶음", () => {
  const src = { low_10d: 100, low_20d: 90, invalidation_price: 95 };
  it("태그 우선순위", () => {
    expect(entryTag({ armedBreakout: true, catalystWatch: true, priceState: "PB" })).toBe("PEAD_PB");
    expect(entryTag({ armedBreakout: false, catalystWatch: true, priceState: "PB" })).toBe("CU");
    expect(entryTag({ armedBreakout: false, catalystWatch: false, priceState: "SW" })).toBe("SW");
    expect(entryTag({ armedBreakout: false, catalystWatch: false, priceState: null })).toBeNull();
  });
  it("무효화선", () => {
    expect(invalidationPrice("PB", src, null)).toBe(100);
    expect(invalidationPrice("SW", src, null)).toBe(90);
    expect(invalidationPrice("CU", src, null)).toBe(95);
    expect(invalidationPrice("PEAD_PB", src, 80)).toBe(80);
    expect(invalidationPrice("PEAD_PB", src, null)).toBe(100);
    expect(invalidationPrice(null, { low_10d: null, low_20d: null, invalidation_price: 7 }, null)).toBe(7);
    expect(invalidationPrice("SW", { low_10d: null, low_20d: null, invalidation_price: 6 }, null)).toBe(6);
    expect(invalidationPrice("CU", { low_10d: 5, low_20d: null, invalidation_price: null }, null)).toBe(5);
  });
  it("conds · passOf · missing", () => {
    const c = normalizeCheck({ check_date: "d", m1_pass: true, m2_pass: true, m5_pass: false }, "KR");
    const all = conds(c, { pass: true, reason: null }, { pass: false, reason: "이벤트 없음" });
    expect(passOf(all)).toEqual({ m1: true, m2: true, m3: true, m4: false, m5: false });
    expect(missing(all)).toEqual(["M4", "M5"]);
  });
});

describe("게이트 (거부권만)", () => {
  const g: GateRules = { pri_hard_max: 50, risk_off_weight_multiplier: 0.5, first_tranche: 1 / 3, weight_capacity_required: true };
  const ro = { kr_grade: "★", us_filters_all: ["F1", "F3", "F4"] };
  const base = { market: "KR" as const, p: 30, riskOff: false, grade: "○", usFilters: [], holding: null };
  it("정상 → 허용, 허용 비중 없으면 1차 비중 null", () => {
    expect(gateDecision(base, g, ro)).toEqual({ allowed: true, reasons: [], first_weight_pct: null, weight_limited: false });
  });
  it("반영도·위험 회피·비중 한도", () => {
    expect(gateDecision({ ...base, p: null }, g, ro).reasons).toEqual(["주가 반영도 없음"]);
    expect(gateDecision({ ...base, p: 50 }, g, ro).reasons).toEqual(["주가 반영도 50 ≥ 50"]);
    expect(gateDecision({ ...base, riskOff: true }, g, ro).reasons[0]).toContain("등급 ★ 만 허용");
    const star = gateDecision({ ...base, riskOff: true, grade: "★", holding: { weight: 0.01, allowed_weight: 0.06 } }, g, ro);
    expect(star).toMatchObject({ allowed: true, first_weight_pct: 1 });
    expect(gateDecision({ ...base, market: "US", riskOff: true, usFilters: ["F1", "F3"] }, g, ro).reasons[0]).toContain("F1·F3·F4");
    expect(gateDecision({ ...base, market: "US", riskOff: true, usFilters: ["F1", "F3", "F4"] }, g, ro).allowed).toBe(true);
    const lim = gateDecision({ ...base, holding: { weight: 0.06, allowed_weight: 0.06 } }, g, ro);
    expect(lim).toMatchObject({ allowed: false, weight_limited: true, first_weight_pct: 2 });
    expect(gateDecision({ ...base, holding: { weight: null, allowed_weight: 0.06 } }, g, ro).allowed).toBe(true);
    expect(gateDecision({ ...base, holding: { weight: 0.1, allowed_weight: null } }, g, { ...ro })).toMatchObject({ allowed: true, weight_limited: false });
    expect(gateDecision({ ...base, holding: { weight: 0.1, allowed_weight: 0.06 } }, { ...g, weight_capacity_required: false }, ro).allowed).toBe(true);
  });
  it("거래일 근사(주말 제외)", () => {
    expect(tradingDaysBack("2026-10-05", 1)).toBe("2026-10-02");      // 월 → 금
    expect(tradingDaysBack("2026-10-16", 14)).toBe("2026-09-28");
    expect(tradingDaysAhead("2026-10-02", 1)).toBe("2026-10-05");
    expect(tradingDaysAhead("2026-10-01", 60)).toBe("2026-12-24");
  });
  it("발송 선택: 재발송 금지 → 상한 → 우선순위", () => {
    const c = (id: string, market: "KR" | "US", families: number, p: number | null, extra = {}) => ({ entity_id: id, market, families, p, m3Growth: null, nearestEvent: null, ...extra });
    const cands = [c("a", "KR", 2, 30), c("b", "KR", 3, 40), c("c", "KR", 3, 20), c("d", "US", 2, 10), c("e", "US", 2, 20), c("f", "KR", 4, 10)];
    const r = selectToSend(cands, new Map([["f", "2026-10-10"], ["a", "2026-09-01"]]), { KR: 0, US: 0 }, "2026-10-16", { KR: 2, US: 1 }, 14);
    expect(r.blocked.map((x) => x.entity_id)).toEqual(["f"]);
    expect(r.send.map((x) => x.entity_id)).toEqual(["c", "b", "d"]);
    expect(r.held.map((x) => x.entity_id)).toEqual(["e", "a"]);
    expect(selectToSend([c("x", "KR", 2, 1)], new Map(), { KR: 2, US: 0 }, "2026-10-16", { KR: 2, US: 1 }, 14).held).toHaveLength(1);
  });
  it("rankGreen: 성과 → 계열 → 반영도 → 산업 성장 → 이벤트 → id", () => {
    const b = { market: "KR" as const, families: 2, p: 30, m3Growth: null, nearestEvent: null };
    const xs = [
      { ...b, entity_id: "z" }, { ...b, entity_id: "y", perf: 1 }, { ...b, entity_id: "x", m3Growth: 20 },
      { ...b, entity_id: "w", nearestEvent: "2026-11-01" }, { ...b, entity_id: "v", p: null }, { ...b, entity_id: "u", perf: 2 },
    ];
    expect(rankGreen(xs).map((x) => x.entity_id)).toEqual(["u", "y", "x", "w", "z", "v"]);
  });
});

describe("🔵 실적 돌파", () => {
  it("ymd", () => {
    expect(ymd("20261001")).toBe("2026-10-01");
    expect(ymd("2026-10-01T09:00:00Z")).toBe("2026-10-01");
    expect(ymd("x")).toBeNull();
    expect(ymd(null)).toBeNull();
  });
  it("K1·H1 정규화 + 무장 판정", () => {
    const k = fromK1([{ code: "000660", payload: { d0: "20261001", d0_low: 1700000, grade: "★" } }, { code: "1", payload: { pass: false, d0: "20261001" } }, { code: "2", payload: null }], 60);
    expect(k).toEqual([{ entity_id: "KR:000660", source: "K1", d0: "2026-10-01", d0_low: 1700000, armed_until: "2026-12-24", evidence: { grade: "★", gap_pct: null, volume_mult: null } }]);
    const h = fromH1([{ symbol: "mu", signal: { d0: "2026-10-01", d0_low: "x", quarter: "FY26 Q4" }, role: "announcer" }, { symbol: "X", signal: null }], 60);
    expect(h[0]).toMatchObject({ entity_id: "US:MU", source: "H1", d0_low: null, evidence: { role: "announcer", source_symbol: null, quarter: "FY26 Q4" } });
    expect(fromH1([{ symbol: "Y", signal: { d0: "2026-09-01" } }], 60)[0].evidence.role).toBeNull();
    const all = [...k, ...h, { ...k[0], d0: "2026-08-01", armed_until: "2026-10-30" }];
    expect(armedOn(all, "KR:000660", "2026-10-15")?.d0).toBe("2026-10-01");
    expect(armedOn(all, "KR:000660", "2026-09-15")?.d0).toBe("2026-08-01");
    expect(armedOn(all, "KR:000660", "2027-01-15")).toBeNull();
  });
});

describe("표시 (entry-view)", () => {
  it("M1 줄: 매출·영업이익·주가 상태", () => {
    expect(m1Text(null)).toBe("");
    expect(m1Text({ rev_yoy: [23.14, 8.55], op_yoy: [103.3, 64.6], price_state: "PB", drawdown_from_post_earnings_high: -11.57, drawdown_from_52w_high: -34.7 }))
      .toBe("매출 전년 대비 +8.6→+23.1% · 영업이익 전년 대비 +64.6→+103.3% · 실적 발표 후 고점 대비 -11.6%");
    expect(m1Text({ op_yoy: [5, -2], profit_basis: "eps", price_state: "PB", drawdown_from_post_earnings_high: -1, drawdown_from_52w_high: -26.8 })).toBe("주당순이익 전년 대비 -2.0→+5.0% · 52주 고점 대비 -26.8%");
    expect(m1Text({ price_state: "PB" })).toBe("");
    expect(m1Text({ price_state: "SW", range_20d_pct: 4.8, ret_20d_pct: -3 })).toBe("20일 가격 범위 4.8% · 20일 수익률 -3.0%");
    expect(m1Text({ price_state: "SW", range_20d: 9 })).toBe("20일 가격 범위 9.0%");
    expect(m1Text({ price_state: "SW" })).toBe("");
    expect(m1Text({ rev_yoy: [1] })).toBe("");
    // 원 프로젝트가 영업이익 턴어라운드로 통과시킨 경우(D68)
    expect(m1Text({ earnings_path: "turnaround", rev_yoy: [14.2, -3], op_yoy: [null, null], price_state: "SW", range_20d_pct: 8 })).toBe("영업이익 흑자 전환(턴어라운드) · 매출 전년 대비 +14.2% · 20일 가격 범위 8.0%");
    expect(m1Text({ earnings_path: "turnaround", rev_yoy: [6.5, null], profit_basis: "eps" })).toBe("주당순이익 흑자 전환(턴어라운드) · 매출 전년 대비 +6.5%");
    expect(m1Text({ earnings_path: "turnaround" })).toBe("영업이익 흑자 전환(턴어라운드)");
  });
  it("M2·M5 줄", () => {
    expect(m2Text(null)).toBe("");
    expect(m2Text({ cross_today: true })).toBe("오늘 상향 교차");
    expect(m2Text({ gap_pct_of_close: -0.1834, hist_rising_bars: 3, projected_bars: 1.2 })).toBe("시그널까지 종가의 0.18% · 막대 3일 연속 개선 · 예상 교차 2봉 뒤");
    expect(m2Text({ hist_rising_bars: 0, hist_rising_2d: true })).toBe("막대 2일 연속 개선");
    expect(m2Text({ hist_rising_bars: 0 })).toBe("");
    expect(m5Text(null)).toBe("");
    expect(m5Text({ path: "institution", streak_days: 3 })).toBe("기관 3일 연속 순매수");
    expect(m5Text({ path: "combined" })).toBe("외국인+기관 3일 연속 순매수");
    expect(m5Text({ label: "수급 대용(미국)", streak_days: 2 })).toBe("수급 대용(미국) — 종가 상승·거래량 평균 이상 2일 연속");
    expect(m5Text({ label: "x" })).toBe("x — 종가 상승·거래량 평균 이상 3일 연속");
    expect(m5Text({ streak_days: 4 })).toBe("4일 연속");
    expect(m5Text({ path: "?" })).toBe("");
  });
  it("조건 줄: 통과는 근거, 미통과는 사유", () => {
    const c: Conds = { m1: { pass: true, reason: null }, m2: { pass: false, reason: "MACD 교차 직전 아님" }, m3: { pass: true, reason: null }, m4: { pass: true, reason: null }, m5: { pass: false, reason: null } };
    const l = condLines(c, { m1: { rev_yoy: [20, 10] }, m2: null, m5: null, m3_lines: ["①실적 반도체 +24%"], m4_events: [{ when: "11/20", title: "NVDA 실적", source: "HermesCall" }] });
    expect(l).toEqual([
      "✅ ① 실적 가속 또는 영익 턴어라운드, 주가 미반영 — 매출 전년 대비 +10.0→+20.0%",
      "❌ ② MACD 상향 교차 직전 — MACD 교차 직전 아님",
      "✅ ③ 산업 고성장 — ①실적 반도체 +24%",
      "✅ ④ 6개월 내 상승 이벤트 — 11/20 NVDA 실적 (HermesCall)",
      "❌ ⑤ 매수 수급 3일 연속",
    ]);
    expect(condLines(c, { m1: null, m2: null, m5: null })[2]).toBe("✅ ③ 산업 고성장");
  });
  it("priceText", () => {
    expect(priceText(null, "KR")).toBe("-");
    expect(priceText(238500, "KR")).toBe("238,500원");
    expect(priceText(12.345, "US")).toBe("$12.35");
  });
});

describe("pri_us_lite", () => {
  const w = { pos_52w: 0.3, rel_ret_3m_pctile: 0.25, rsi14: 0.2, ma50_gap: 0.15, post_earnings_reaction: 0.1 };
  const bars = Array.from({ length: 260 }, (_, i) => ({ date: new Date(Date.UTC(2025, 9, 1) + i * 86400_000).toISOString().slice(0, 10), close: 100 + (i % 20) - 10 + i * 0.1 }));
  const bench = bars.map((b, i) => ({ date: b.date, close: 1000 + i }));
  it("구성 요소 계산·결측", () => {
    const p = priUsParts(bars, bench, bars[200].date);
    expect(p.pos_52w).not.toBeNull();
    expect(p.rel_ret_3m).not.toBeNull();
    expect(p.rsi14).not.toBeNull();
    expect(p.ma50_gap_pct).not.toBeNull();
    expect(p.post_earnings_reaction_pct).not.toBeNull();
    const short = priUsParts(bars.slice(0, 10), null, "2099-01-01");
    expect(short).toEqual({ pos_52w: null, rel_ret_3m: null, rsi14: null, ma50_gap_pct: null, post_earnings_reaction_pct: null });
    expect(priUsParts(bars, [], null).rel_ret_3m).toBeNull();
    expect(priUsParts(bars, null, bars[0].date.replace(/\d$/, "0")).post_earnings_reaction_pct).toBeNull();
    const flat = priUsParts(bars.slice(0, 70).map((b) => ({ ...b, close: 5 })), null, null);
    expect(flat.pos_52w).toBeNull();
  });
  it("백분위·가중 평균·재가중", () => {
    expect(percentile(5, [5])).toBe(50);
    expect(percentile(1, [1, 2, 3])).toBe(0);
    expect(percentile(3, [1, 2, 3])).toBe(100);
    expect(percentile(2, [2, 2, 1])).toBe(75);
    expect(priUsLite({ pos_52w: null, rel_ret_3m: 1, rsi14: null, ma50_gap_pct: 0, post_earnings_reaction_pct: 0 }, [1], w)).toBeNull();
    expect(priUsLite({ pos_52w: 100, rel_ret_3m: 3, rsi14: 50, ma50_gap_pct: 40, post_earnings_reaction_pct: -40 }, [1, 2, 3], w)).toBe(80);
    // 52주 위치만 있음 → 그 값 그대로
    expect(priUsLite({ pos_52w: 20, rel_ret_3m: null, rsi14: null, ma50_gap_pct: null, post_earnings_reaction_pct: null }, [], w)).toBe(20);
  });
});
