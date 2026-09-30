import { describe, expect, it } from "vitest";
import { buyReasons, chartLines, cleanThesis, consensusOf, ideaCard, rankBuy, techLine, type IdeaEvidence } from "./idea";
import type { ChartRef } from "./technicals";

const idea: IdeaEvidence = {
  thesis: { text: "반도체 습도제어 과점 공급사로 2Q 영업이익이 급증했으나 주가는 이미 [검증 불가 수치 삭제] 넘게 올랐다.", source: "Heimdallr 분석", as_of: "2026Q2" },
  growth: { fiscal: "2026Q2", rev_yoy: 159.4, op_yoy: 346.5, prev_fiscal: "2026Q1", prev_rev_yoy: 66.7, prev_op_yoy: 147.4, op_label: "영업이익", source: "Heimdallr 분기 실적" },
  industry: { name: "반도체", pass: true, realized_median: 30.6, brokers: [{ broker: "BofA Securities", value: 18 }], outlook: [{ source: "SK hynix", cagr: 30 }] },
  events: [{ when: "11/30", title: "3Q OPM 확인", source: "Heimdallr 분석" }, { when: "12/31", title: "b", source: "s" }, { when: "~01/31", title: "c", source: "s" }],
  risk: { text: "2Q 급증이 일회성일 가능성", watch: "3Q 매출 QoQ", source: "Heimdallr 분석" },
};

describe("매수 검토 추천 — 순위·근거·카드", () => {
  it("순위: 계열 수 → 낮은 반영도 → 산업 성장률 → 가까운 이벤트, 최대 n개", () => {
    const xs = [
      { entity_id: "a", families: 2, p: 10, industryGrowth: 30, nextEvent: "2026-11-01" },
      { entity_id: "b", families: 3, p: 33, industryGrowth: 10, nextEvent: null },
      { entity_id: "c", families: 3, p: 13, industryGrowth: null, nextEvent: null },
      { entity_id: "d", families: 3, p: 13, industryGrowth: 20, nextEvent: null },
      { entity_id: "e", families: 3, p: 13, industryGrowth: 20, nextEvent: "2026-10-01" },
      { entity_id: "f", families: 3, p: null, industryGrowth: 20, nextEvent: null },
      { entity_id: "g", families: 3, p: 13, industryGrowth: 20, nextEvent: "2026-10-01" },
    ];
    expect(rankBuy(xs, 5).map((x) => x.entity_id)).toEqual(["e", "g", "d", "c", "b"]);
    expect(rankBuy(xs).length).toBe(5);
  });

  it("편집 흔적 정리·길이 제한", () => {
    expect(cleanThesis("A는 [검증 불가 수치 삭제] 넘게 올랐다")).toBe("A는 넘게 올랐다");
    expect(cleanThesis("가".repeat(300), 10)).toBe("가".repeat(9) + "…");
    expect(cleanThesis("매출 급증(YoY +90.2%, [[F 218.8억]])으로 확대됐지만 주가는 -11.4% 하락([[F announcement_return_pct -11.375]])하며 정체"))
      .toBe("매출 급증(YoY +90.2%, 218.8억)으로 확대됐지만 주가는 -11.4% 하락하며 정체");
  });

  it("매수 근거 ①~④ (가속 표시·등급·산업 근거)", () => {
    const r = buyReasons({ idea, p: 33, consensus: ["FlyWheel 반도체 흐름 5/5", "Sage 멘토 5명 강세(산업 전체)"], grade: "★", score: 82.3 });
    expect(r).toEqual([
      "① 실적 가속: 매출 +159% · 영업이익 +347% (2026Q2, 전년 대비) ← 직전 2026Q1 +67% · +147% · Heimdallr ★ 82점",
      "② 주가 덜 반영: 반영도 33/100 — 실적에 비해 주가가 아직 덜 올랐음",
      "③ 산업 고성장 ✅: 반도체 (실적 중앙값 +31% · BofA Securities 연평균 18% · SK hynix 연평균 30%)",
      "④ 신호 합의: FlyWheel 반도체 흐름 5/5 · Sage 멘토 5명 강세(산업 전체)",
    ]);
  });

  it("근거 일부만 있을 때", () => {
    const g = { ...idea.growth!, op_yoy: null, prev_rev_yoy: 200, prev_op_yoy: null, prev_fiscal: "2026Q1" };
    expect(buyReasons({ idea: { ...idea, growth: g, industry: null }, p: 70, consensus: [] })).toEqual([
      "① 실적: 매출 +159% (2026Q2, 전년 대비) ← 직전 2026Q1 +200%",
      "② 주가 많이 반영: 반영도 70/100 — 실적에 비해 주가가 이미 반영됨",
    ]);
    expect(buyReasons({ idea: { ...idea, growth: null, industry: { ...idea.industry!, pass: false, realized_median: null, brokers: [], outlook: [] } }, p: null, consensus: [], grade: "○", score: null }))
      .toEqual(["① 실적: Heimdallr ○", "③ 산업 성장 근거 부족: 반도체"]);
    expect(buyReasons({ idea: { ...idea, growth: { ...g, rev_yoy: null, op_yoy: null } }, p: null, consensus: [], grade: "★", score: 90 })[0]).toBe("① 실적: Heimdallr ★ 90점");
    expect(buyReasons({ idea: { ...idea, growth: { ...g, prev_fiscal: null } }, p: null, consensus: [] })[0]).toBe("① 실적: 매출 +159% (2026Q2, 전년 대비)");
    expect(buyReasons({ idea: { ...idea, growth: null }, p: null, consensus: [] })).toHaveLength(1);
  });

  it("신호 합의 문장", () => {
    expect(consensusOf({ N: [{ kind: "industry_narrative", strength: 8, detail: "FlyWheel 반도체 흐름 4/5" }, { kind: "mentor_consensus", strength: 6 }], C: { catalyst: { strength: 7 }, us_filters: [] } }))
      .toEqual(["FlyWheel 반도체 흐름 4/5", "Sage 멘토 ?명 강세", "실적 촉매 수혜 강도 7/10"]);
    expect(consensusOf({ C: { catalyst: { strength: 7, detail: "HermesCall NVDA 수혜" }, us_filters: [] } })).toEqual(["HermesCall NVDA 수혜"]);
    expect(consensusOf({})).toEqual([]);
  });

  it("카드·기술적 참고", () => {
    const c = ideaCard(1, { name: "저스템", symbol: "417840", market: "KR", industry: "반도체" }, idea, ["r"], { source: "s", as_of: null, rsi: 70, rsi_note: null, macd_note: "시그널 아래", price_note: null }, "🔗 x");
    expect(c).toMatchObject({ rank: 1, flag: "🇰🇷", events: ["11/30 3Q OPM 확인 (Heimdallr 분석)", "12/31 b (s)"], risk: "2Q 급증이 일회성일 가능성 → 확인: 3Q 매출 QoQ", tech: "MACD 시그널 아래 · RSI 70(과열권)" });
    expect(c.thesis).toBe("반도체 습도제어 과점 공급사로 2Q 영업이익이 급증했으나 주가는 이미 넘게 올랐다. (Heimdallr 분석 2026Q2)");
    const u = ideaCard(2, { name: "GE Vernova", symbol: "GEV", market: "US", industry: "전력인프라" }, { ...idea, thesis: { ...idea.thesis!, as_of: null }, risk: { ...idea.risk!, watch: null } }, [], null, "");
    expect(u).toMatchObject({ flag: "🇺🇸", tech: null, risk: "2Q 급증이 일회성일 가능성" });
    expect(u.thesis?.endsWith("(Heimdallr 분석)")).toBe(true);
    expect(ideaCard(3, { name: "x", symbol: "x", market: "KR", industry: "" }, { ...idea, thesis: null, risk: null }, [], null, "")).toMatchObject({ thesis: null, risk: null });
    expect(ideaCard(4, { name: "x", symbol: "x", market: "KR", industry: "" }, { ...idea, risk: { text: "...", watch: "...", source: "s" } }, [], null, "").risk).toBeNull();
    expect(ideaCard(5, { name: "x", symbol: "x", market: "KR", industry: "" }, { ...idea, risk: { text: "위험", watch: "...", source: "s" }, events: [{ when: "11/30", title: "가".repeat(100), source: "s" }] }, [], null, "")).toMatchObject({ risk: "위험", events: [`11/30 ${"가".repeat(69)}… (s)`] });
    expect(techLine({ source: "s", as_of: null, rsi: null, rsi_note: null, macd_note: null, price_note: "하락 중 반등" })).toBe("가격 하락 중 반등");
    expect(techLine({ source: "s", as_of: null, rsi: null, rsi_note: null, macd_note: null, price_note: null })).toBeNull();
    expect(techLine(null)).toBeNull();
  });

  it("⑤~⑧ 고점 대비·5일선/20일선·MACD·RSI (참고 지표)", () => {
    const c: ChartRef = {
      as_of: "2026-09-30", close: 10880, currency: "KRW",
      high: { value: 17440, date: "2026-03-12", drawdown_pct: -37.6, days: 140 },
      ma: { n: [5, 20], fast: 10800, slow: 10850, state: "near", gap_pct: -0.46, streak: 3 },
      macd: { state: "near", gap_pct: 0.12, bars_to_cross: 2, streak: 3, improving: true },
      rsi: { value: 56.4, prev: 48.2, days: 3, dir: "up" },
    };
    expect(chartLines(c)).toEqual([
      "⑤ 고점 대비: -37.6% (52주 최고 17,440원 · 26/03/12, 현재 10,880원)",
      "⑥ 5일선·20일선: 상향 통과 직전 ✅ (5일선이 20일선 아래 0.5%, 3일째 좁혀짐)",
      "⑦ MACD: 시그널 상향 통과 직전 ✅ (격차 종가의 0.12%, 약 2일 후 예상)",
      "⑧ RSI 56 ↗ 상승 (3일 전 48 · 중립)",
      "※ ⑤~⑧ 가격·기술 지표는 참고용 — 매수 검토 판정 조건 아님 (26/09/30 종가 기준)",
    ]);
    const u: ChartRef = { ...c, currency: "USD", close: 101.5, high: { ...c.high, value: 101.5, days: 0 },
      ma: { ...c.ma!, state: "cross_today" }, macd: { ...c.macd!, state: "cross_today" }, rsi: { ...c.rsi!, value: 72, dir: "down" } };
    expect(chartLines(u).slice(0, 4)).toEqual([
      "⑤ 고점 대비: 52주 최고가 경신 중 (현재 $101.50)",
      "⑥ 5일선·20일선: 오늘 상향 통과 ✅",
      "⑦ MACD: 오늘 시그널 상향 통과 ✅",
      "⑧ RSI 72 ↘ 하락 (3일 전 48 · 과열권)",
    ]);
    const a: ChartRef = { ...c, ma: { ...c.ma!, state: "above", gap_pct: 2.14, streak: 7 }, macd: { ...c.macd!, state: "above", streak: 5 }, rsi: { ...c.rsi!, dir: "flat" } };
    expect(chartLines(a).slice(1, 4)).toEqual(["⑥ 5일선·20일선: 이미 위 (7일째, 20일선보다 +2.1%)", "⑦ MACD: 이미 시그널 위 (5일째)", "⑧ RSI 56 → 보합 (3일 전 48 · 중립)"]);
    const b: ChartRef = { ...c, ma: { ...c.ma!, state: "below", gap_pct: -3.2, streak: 0 }, macd: { ...c.macd!, state: "below", gap_pct: 0.8, improving: false, bars_to_cross: null } };
    expect(chartLines(b).slice(1, 3)).toEqual(["⑥ 5일선·20일선: 아래 (20일선보다 -3.2%, 벌어지는 중) — 통과 직전 아님", "⑦ MACD: 시그널 아래 (격차 종가의 0.80%, 벌어지는 중) — 통과 직전 아님"]);
    const b2: ChartRef = { ...b, ma: { ...b.ma!, streak: 2 }, macd: { ...b.macd!, improving: true, state: "near", bars_to_cross: null } };
    expect(chartLines(b2).slice(1, 3)).toEqual(["⑥ 5일선·20일선: 아래 (20일선보다 -3.2%, 2일째 좁혀지는 중) — 통과 직전 아님", "⑦ MACD: 시그널 상향 통과 직전 ✅ (격차 종가의 0.80%)"]);
    expect(chartLines({ ...c, ma: null, macd: null, rsi: null })).toHaveLength(2);
    // 매수 근거에 이어 붙고, 기술 참고 줄은 생략
    expect(buyReasons({ idea: { ...idea, chart: c }, p: 33, consensus: [] }).slice(-5)[0]).toMatch(/^⑤ /);
    expect(ideaCard(1, { name: "x", symbol: "x", market: "KR", industry: "" }, { ...idea, chart: c }, [], { source: "s", as_of: null, rsi: 50, rsi_note: null, macd_note: null, price_note: null }, "").tech).toBeNull();
  });
});
