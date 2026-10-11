import { describe, expect, it } from "vitest";
import { buyReasons, cleanThesis, consensusOf, ideaCard, rankBuy, techLine, type IdeaEvidence } from "./idea";
import type { ChartRef } from "./technicals";
import type { Timing } from "./timing";

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
    // 지금 매수 매력 점수가 계열 수보다 먼저 (D53)
    expect(rankBuy([{ ...xs[0], timing: 5 }, { ...xs[1], timing: 2 }, { ...xs[2], timing: null }]).map((x) => x.entity_id)).toEqual(["a", "b", "c"]);
  });

  it("편집 흔적 정리·길이 제한", () => {
    expect(cleanThesis("A는 [검증 불가 수치 삭제] 넘게 올랐다")).toBe("A는 넘게 올랐다");
    expect(cleanThesis("가".repeat(300), 10)).toBe("가".repeat(9) + "…");
    expect(cleanThesis("매출 급증(YoY +90.2%, [[F 218.8억]])으로 확대됐지만 주가는 -11.4% 하락([[F announcement_return_pct -11.375]])하며 정체"))
      .toBe("매출 급증(YoY +90.2%, 218.8억)으로 확대됐지만 주가는 -11.4% 하락하며 정체");
  });

  it("🏢 좋은 기업인가 ①~③ (가속 표시·등급·산업 근거) — 주가·가격은 ⏱️ 로 분리", () => {
    const r = buyReasons({ idea, consensus: ["FlyWheel 반도체 흐름 5/5", "Sage 멘토 5명 강세(산업 전체)"], grade: "★", score: 82.3 });
    expect(r).toEqual([
      "① 실적 가속: 매출 +159% · 영업이익 +347% (2026Q2, 전년 대비) ← 직전 2026Q1 +67% · +147% · Heimdallr ★ 82점",
      "② 산업 고성장 ✅: 반도체 (실적 중앙값 +31% · 뱅크오브아메리카 연평균 18% · SK hynix 연평균 30%)",
      "③ 신호 합의: FlyWheel 반도체 흐름 5/5 · Sage 멘토 5명 강세(산업 전체)",
    ]);
  });

  it("① 영업이익 턴어라운드 (D68)", () => {
    const g = { ...idea.growth!, rev_yoy: 21.4, op_yoy: null, turnaround: true };
    expect(buyReasons({ idea: { ...idea, growth: g, industry: null }, consensus: [], grade: "△", score: 61 })).toEqual(["① 영업이익 턴어라운드: 매출 +21% · 영업이익 흑자 전환 (2026Q2, 전년 대비) · Heimdallr △ 61점"]);
    expect(buyReasons({ idea: { ...idea, growth: { ...g, rev_yoy: null, op_yoy: 5, op_label: "주당순이익" }, industry: null }, consensus: [] })).toEqual(["① 영업이익 턴어라운드: 주당순이익 흑자 전환 (2026Q2, 전년 대비)"]);
  });

  it("근거 일부만 있을 때", () => {
    const g = { ...idea.growth!, op_yoy: null, prev_rev_yoy: 200, prev_op_yoy: null, prev_fiscal: "2026Q1" };
    expect(buyReasons({ idea: { ...idea, growth: g, industry: null }, consensus: [] })).toEqual(["① 실적: 매출 +159% (2026Q2, 전년 대비) ← 직전 2026Q1 +200%"]);
    expect(buyReasons({ idea: { ...idea, growth: null, industry: { ...idea.industry!, pass: false, realized_median: null, brokers: [], outlook: [] } }, consensus: [], grade: "○", score: null }))
      .toEqual(["① 실적: Heimdallr ○", "② 산업 성장 근거 부족: 반도체"]);
    expect(buyReasons({ idea: { ...idea, growth: { ...g, rev_yoy: null, op_yoy: null } }, consensus: [], grade: "★", score: 90 })[0]).toBe("① 실적: Heimdallr ★ 90점");
    expect(buyReasons({ idea: { ...idea, growth: { ...g, prev_fiscal: null } }, consensus: [] })[0]).toBe("① 실적: 매출 +159% (2026Q2, 전년 대비)");
    expect(buyReasons({ idea: { ...idea, growth: null }, consensus: [] })).toHaveLength(1);
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
    expect(ideaCard(4, { name: "x", symbol: "x", market: "KR", industry: "" }, { ...idea, risk: { text: "unused", watch: "unused", source: "s" } }, [], null, "").risk).toBeNull();
    expect(ideaCard(4, { name: "x", symbol: "x", market: "KR", industry: "" }, { ...idea, risk: { text: "위험", watch: " N/A ", source: "s" } }, [], null, "").risk).toBe("위험");
    expect(ideaCard(5, { name: "x", symbol: "x", market: "KR", industry: "" }, { ...idea, risk: { text: "위험", watch: "...", source: "s" }, events: [{ when: "11/30", title: "가".repeat(100), source: "s" }] }, [], null, "")).toMatchObject({ risk: "위험", events: [`11/30 ${"가".repeat(69)}… (s)`] });
    expect(techLine({ source: "s", as_of: null, rsi: null, rsi_note: null, macd_note: null, price_note: "하락 중 반등" })).toBe("가격 하락 중 반등");
    expect(techLine({ source: "s", as_of: null, rsi: null, rsi_note: null, macd_note: null, price_note: null })).toBeNull();
    expect(techLine(null)).toBeNull();
  });

  it("⏱️ 타이밍·추천 이력이 카드에 — 일봉 지표가 있으면 기술 참고 줄 생략", () => {
    const c = { as_of: "2026-09-30", close: 1, currency: "KRW", high: { value: 1, date: "2026-09-30", drawdown_pct: 0, days: 0 }, ma: null, macd: null, rsi: null } as ChartRef;
    const t: Timing = { pullback: 1, score: 5, verdict: "high", checks: [{ key: "p", mark: "pass", pts: 2, text: "주가 반영도 20/100" }], setup: { required: true, ok: true, why: [], path: "ma", parts: { pullback: true, ma: "pre", base: false, macd: "post" } } };
    const k = ideaCard(1, { name: "x", symbol: "x", market: "KR", industry: "" }, { ...idea, chart: c }, [], { source: "s", as_of: null, rsi: 50, rsi_note: null, macd_note: null, price_note: null }, "", null, { timing: t, history: "🆕 첫 추천" });
    expect(k).toMatchObject({ tech: null, verdict: "🔥 지금 매수 매력 높음 (점수 +5)", timing: ["✅ 상승 초기 조건 — ✅ 주가 위치 A 5·10일선 돌파 직전 · ✅ MACD 돌파 직후", "✅ 주가 반영도 20/100"], history: "🆕 첫 추천" });
    expect(ideaCard(1, { name: "x", symbol: "x", market: "KR", industry: "" }, idea, [], null, "", null, { timing: { ...t, score: -1, verdict: "wait" } }).verdict).toBe("⏸️ 좋은 기업이지만 지금은 대기 (점수 -1)");
    expect(ideaCard(1, { name: "x", symbol: "x", market: "KR", industry: "" }, idea, [], null, "")).toMatchObject({ verdict: null, timing: [], history: null });
  });
});
