import { describe, expect, it } from "vitest";
import type { ChartRef } from "./technicals";
import { checkLines, checkMarks, crossPhase, daysUntil, flowCheck, issues, qty, setupLine, streakOf, timingOf, type FlowRef, type TimingRules } from "./timing";

const TR: TimingRules = {
  p: { great_max: 25, good_max: 40 },
  p_weight: 1,
  setup: { require: true, just_after_days: 3 },
  position: { chase_above_pct: -5, deep_below_pct: -40 },
  rsi: { overheat_min: 70, near_hot_min: 65, rebound_max: 45 },
  flow_days: 2,
  event_within_days: 90,
  points: { p_great: 2, p_good: 1, p_high: -1, pullback: 1, chase: -1, deep: -1, rsi_hot: -2, rsi_rebound: 1, cross: 1, trend_down: -1, flow_buy: 2, flow_proxy: 1, flow_sell: -1, event: 1, risk_off: -1 },
  verdict: { high_min: 4, mid_min: 1 },
};

const chart: ChartRef = {
  as_of: "2026-09-30", close: 10880, currency: "KRW",
  high: { value: 13600, date: "2026-03-12", drawdown_pct: -20, days: 140 },
  ma: { n: [5, 20], fast: 10800, slow: 10850, state: "near", gap_pct: -0.46, streak: 3 },
  macd: { state: "near", gap_pct: 0.12, bars_to_cross: 2, streak: 3, improving: true },
  rsi: { value: 42, prev: 38, days: 3, dir: "up" },
};
const buy: FlowRef = { kind: "investor", as_of: "2026-10-02", dates: ["a", "b", "c"], foreign: [-5, 12000, 300], institution: [1, -1, -2] };

describe("수급 연속일·수량 표기", () => {
  it("streakOf: 최신일부터 같은 부호", () => {
    expect(streakOf([-1, 2, 3])).toBe(2);
    expect(streakOf([1, -2, -3, -4])).toBe(-3);
    expect(streakOf([5, 0])).toBe(0);
    expect(streakOf([])).toBe(0);
  });
  it("qty", () => {
    expect(qty(614278)).toBe("+61.4만");
    expect(qty(-980)).toBe("-980");
    expect(qty(0)).toBe("0");
  });
});

describe("flowCheck — 외국인 또는 기관 2일 연속 순매수 (사용자 지정 매수 근거)", () => {
  it("외국인 연속 순매수 ✅ +2", () => {
    const c = flowCheck(buy, TR);
    expect(c).toMatchObject({ mark: "pass", pts: 2 });
    expect(c.text).toBe("외국인 2일 연속 순매수 — 외국인 -5·+1.2만·+300주 / 기관 +1·-1·-2주 (최근 3일, 26/10/02 기준)");
    expect(flowCheck({ ...buy, foreign: [1, 1], institution: [3, 4] }, TR).text).toMatch(/^외국인 2일·기관 2일 연속 순매수/);
  });
  it("둘 다 연속 순매도 ❌ −1 · 그 외 ➖ · 자료 없음", () => {
    expect(flowCheck({ ...buy, foreign: [-1, -2], institution: [-1, -3] }, TR)).toMatchObject({ mark: "fail", pts: -1 });
    expect(flowCheck({ ...buy, foreign: [1, 0], institution: [-1, -2] }, TR)).toMatchObject({ mark: "none", pts: 0, text: expect.stringContaining("연속 순매수 아님 (외국인 보합 · 기관 2일 연속 순매도)") });
    expect(flowCheck({ ...buy, foreign: [-1, 1], institution: [0, 0] }, TR).text).toContain("외국인 1일 연속 순매수 · 기관 보합");
    expect(flowCheck(null, TR)).toMatchObject({ mark: "none", text: "외국인·기관 수급 자료 없음" });
  });
  it("미국 매집일 대용", () => {
    expect(flowCheck({ kind: "proxy", as_of: "d", pass: true, streak: 3 }, TR)).toMatchObject({ mark: "pass", pts: 1 });
    expect(flowCheck({ kind: "proxy", as_of: "d", pass: false, streak: 0 }, TR)).toMatchObject({ mark: "none", pts: 0 });
  });
});

describe("timingOf — 좋은 기업과 지금 사기 좋은 주식 구분", () => {
  it("눌림 + 반등 + 추세 전환 직전 + 수급 + 이벤트 → 🔥 매력 높음", () => {
    const t = timingOf({ p: 20, chart, flow: buy, eventDays: 30, eventTitle: "3Q 실적", riskOff: false }, TR);
    expect(t.verdict).toBe("high");
    expect(t.score).toBe(2 + 1 + 1 + 1 + 1 + 2 + 1);
    expect(checkLines(t)).toEqual([
      "✅ 주가 반영도 20/100 — 실적에 비해 주가가 크게 덜 오름",
      "✅ 고점 대비 -20.0% 눌림 — 싸게 살 구간 (52주 최고 13,600원 · 26/03/12, 현재 10,880원)",
      "✅ RSI 42 ↗ 낮은 곳에서 반등 시작 (3일 전 38)",
      "✅ MACD가 시그널선 상향 돌파 직전 — 추세 전환 임박",
      "✅ 5일선이 20일선 상향 돌파 직전 — 추세 전환 임박",
      expect.stringMatching(/^✅ 외국인 2일 연속 순매수/),
      "✅ 상승 이벤트 D-30 (3Q 실적)",
    ]);
    expect(checkMarks(t)).toMatchObject({ p: "pass", flow: "pass", event: "pass" });
  });
  it("신고가·과열·추세 이탈·위험 회피 → ⏸️ 대기", () => {
    const hot: ChartRef = { ...chart, currency: "USD", close: 101.5, high: { ...chart.high, value: 101.5, days: 0, drawdown_pct: 0 }, rsi: { ...chart.rsi!, value: 75, dir: "flat" },
      macd: { ...chart.macd!, state: "below", improving: false }, ma: { ...chart.ma!, state: "below", streak: 0 } };
    const t = timingOf({ p: 55, chart: hot, flow: null, eventDays: null, riskOff: true }, TR);
    expect(t.verdict).toBe("wait");
    expect(checkLines(t)).toEqual([
      "❌ 주가 반영도 55/100 — 이미 많이 반영됨",
      "⚠️ 52주 최고가 경신 중 (현재 $101.50) — 추격 매수 주의",
      "❌ RSI 75 → 과열권 — 단기 급등, 식은 뒤 접근",
      "❌ MACD가 시그널선 아래로 벌어지는 중 — 하락 추세",
      "❌ 5일선이 20일선 아래로 벌어지는 중 — 하락 추세",
      "➖ 외국인·기관 수급 자료 없음",
      "➖ 90일 안 상승 이벤트 없음",
      "⚠️ 시장 위험 회피 국면 — 나눠서 적게",
    ]);
  });
  it("고점 근처·깊은 낙폭·중립 상태·자료 없음 → ⚖️ 분할 접근 등", () => {
    const near: ChartRef = { ...chart, high: { ...chart.high, drawdown_pct: -3 }, rsi: { ...chart.rsi!, value: 55, dir: "down" },
      macd: { ...chart.macd!, state: "above", streak: 10 }, ma: { ...chart.ma!, state: "below", streak: 2 } };
    const t = timingOf({ p: 30, chart: near, flow: null, eventDays: 120, riskOff: false }, TR);
    expect(checkLines(t).slice(1, 5)).toEqual([
      "⚠️ 고점 대비 -3.0% — 고점 근처, 추격 매수 주의 (52주 최고 13,600원 · 26/03/12, 현재 10,880원)",
      "➖ RSI 55 ↘ 과열 아님",
      "➖ MACD가 시그널선 이미 위 — 상승 추세 유지",
      "➖ 5일선이 20일선 아래지만 좁혀지는 중",
    ]);
    expect(t).toMatchObject({ score: 0, verdict: "wait" });
    expect(issues(t)).toBe("고점 대비 -3.0%");
    // RSI 69.6 은 "69"(내림)로 · 65 이상은 과열 근접(표시만, 0점) · 긴 이벤트 제목은 줄임
    const nearHot = timingOf({ p: 30, chart: { ...near, rsi: { ...near.rsi!, value: 69.6 } }, flow: null, eventDays: 5, eventTitle: "가".repeat(50), riskOff: false }, TR);
    expect(checkLines(nearHot)).toContain("⚠️ RSI 69 ↘ 과열 근접 (70 이상 과열) — 급하게 따라 사지 않기");
    expect(checkLines(nearHot)).toContain(`✅ 상승 이벤트 D-5 (${"가".repeat(39)}…)`);
    expect(issues(nearHot)).toBe("고점 대비 -3.0% · RSI 69 ↘ 과열 근접");
    const deep = timingOf({ p: 30, chart: { ...chart, high: { ...chart.high, drawdown_pct: -45 }, ma: { ...chart.ma!, state: "cross_today" }, macd: null, rsi: null }, flow: null, eventDays: 0, riskOff: false }, TR);
    expect(checkLines(deep)).toContain("⚠️ 고점 대비 -45.0% — 낙폭이 커 하락 추세 확인 필요 (52주 최고 13,600원 · 26/03/12, 현재 10,880원)");
    expect(checkLines(deep)).toContain("✅ 5일선이 20일선 오늘 상향 돌파 — 추세 전환");
    expect(checkLines(deep)).toContain("✅ 상승 이벤트 D-0");
    expect(deep.verdict).toBe("mid");
    const none = timingOf({ p: null, chart: null, flow: null, eventDays: -3, riskOff: false }, TR);
    expect(checkLines(none)).toEqual(["➖ 주가 반영도 계산 전", "➖ 가격 자료 없음", "➖ 외국인·기관 수급 자료 없음", "➖ 90일 안 상승 이벤트 없음"]);
    expect(none).toMatchObject({ score: 0, verdict: "wait" });
  });
  it("🎯 필수 조건 — 눌림 + 5·20일선 · MACD 상향 돌파 직전·오늘·직후 (10/8)", () => {
    const ok = timingOf({ p: 20, chart, flow: null, eventDays: null, riskOff: false }, TR);
    expect(ok.setup).toEqual({ required: true, ok: true, why: [], parts: { pullback: true, ma: "pre", macd: "pre" } });
    expect(setupLine(ok)).toBe("✅ 상승 초기 조건 — ✅ 눌림 · ✅ 5·20일선 돌파 직전 · ✅ MACD 돌파 직전");
    // 돌파 2일째(직후) = ✅ 상승 초기 · 4일째 = 이미 위(필수 조건 탈락)
    const post = timingOf({ p: 20, chart: { ...chart, macd: { ...chart.macd!, state: "above", streak: 2 }, ma: { ...chart.ma!, state: "cross_today", streak: 1 } }, flow: null, eventDays: null, riskOff: false }, TR);
    expect(checkLines(post)).toContain("✅ MACD가 시그널선 상향 돌파 2일째 — 상승 초기");
    expect(post.setup.parts).toEqual({ pullback: true, ma: "today", macd: "post" });
    const late = timingOf({ p: 20, chart: { ...chart, high: { ...chart.high, drawdown_pct: -3 }, macd: { ...chart.macd!, state: "above", streak: 4 }, ma: { ...chart.ma!, state: "below", streak: 0 } }, flow: null, eventDays: null, riskOff: false }, TR);
    expect(late.setup).toMatchObject({ ok: false, why: ["고점 대비 눌림 아님(-3.0%)", "5·20일선 상향 돌파 직전·직후 아님", "MACD 시그널 상향 돌파 직전·직후 아님"] });
    expect(setupLine(late)).toBe("❌ 상승 초기 조건 — ❌ 눌림 · ❌ 5·20일선 아님 · ❌ MACD 아님");
    const newHigh = timingOf({ p: 20, chart: { ...chart, high: { ...chart.high, days: 0, drawdown_pct: 0 }, ma: null, macd: null }, flow: null, eventDays: null, riskOff: false }, TR);
    expect(newHigh.setup.why).toEqual(["고점 대비 눌림 아님(신고가)", "이동평균선 상향 돌파 직전·직후 아님", "MACD 시그널 상향 돌파 직전·직후 아님"]);
    const none = timingOf({ p: 20, chart: null, flow: null, eventDays: null, riskOff: false }, TR);
    expect(none.setup).toEqual({ required: true, ok: false, why: ["가격 자료 없음"], parts: null });
    expect(setupLine(none)).toBe("❌ 상승 초기 조건 — 가격 자료 없음");
    expect(crossPhase(null, 3)).toBe("no");
  });
  it("주가 반영도 점수 배율(p_weight) — 보정 중이라 작게", () => {
    const half = { ...TR, p_weight: 0.5 };
    const pts = (p: number) => timingOf({ p, chart: null, flow: null, eventDays: null, riskOff: false }, half).checks[0].pts;
    expect([pts(20), pts(30), pts(60)]).toEqual([1, 0.5, -0.5]);
  });
  it("daysUntil", () => {
    expect(daysUntil("2026-10-14", "2026-10-04")).toBe(10);
    expect(daysUntil("2026-10-01T00:00:00Z", "2026-10-04")).toBe(-3);
    expect(daysUntil(null, "2026-10-04")).toBeNull();
  });
});
