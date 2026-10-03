import { describe, expect, it } from "vitest";
import { briefOf, composeMemo, mdTable, mdToNotion, type MemoData, type NarrativeText } from "./compose";
import { factBook, factLines, formatFact } from "./fact-table";
import { checkAll, checkProbabilities, checkText, render } from "./grounding";

describe("fact-table", () => {
  it("형식별 표시값", () => {
    expect(formatFact(null, "num")).toBe("자료 없음");
    expect(formatFact(Number.NaN, "pct")).toBe("자료 없음");
    expect(formatFact("10/28", "text")).toBe("10/28");
    expect(formatFact(1.234, "pct_signed")).toBe("+1.2%");
    expect(formatFact(-1.25, "pct_signed", 2)).toBe("-1.25%");
    expect(formatFact(0, "pct_signed")).toBe("0.0%");
    expect(formatFact(12.3, "pct")).toBe("12.3%");
    expect(formatFact(0.87, "pctp", 2)).toBe("+0.87%p");
    expect(formatFact(-0.1, "pctp")).toBe("-0.1%p");
    expect(formatFact(12345.6, "int")).toBe("12,346");
    expect(formatFact(1000000, "krw")).toBe("1,000,000원");
    expect(formatFact(-89888, "eok")).toBe("-89,888억원");
    expect(formatFact(12.345, "usd")).toBe("$12.35");
    expect(formatFact(7003.744, "num", 2)).toBe("7,003.74");
    expect(formatFact(5, "text")).toBe("5");
  });
  it("번호 부여·조회·LLM 용 줄", () => {
    const fb = factBook();
    expect(fb.add("시장", "KOSPI 주간", -1.1, "pct_signed")).toBe("F001");
    expect(fb.add("시장", "날짜", "10/02", "text")).toBe("F002");
    expect(fb.display("F001")).toBe("-1.1%");
    expect(fb.display("F999")).toBe("자료 없음");
    expect(factLines(fb.facts)).toBe("F001 | 시장 | KOSPI 주간 | -1.1%\nF002 | 시장 | 날짜 | 10/02");
  });
});

describe("grounding gate", () => {
  const ids = new Set(["F001", "F002"]);
  it("표식만 쓰면 통과, 없는 표식·표식 밖 숫자는 위반", () => {
    expect(checkText("코스피는 [[F001]] 하락", ids)).toEqual([]);
    expect(checkText("코스피 [[F009]]", ids)).toEqual(["없는 사실 표식 F009"]);
    expect(checkText("코스피는 -1.1% 하락했다", ids)[0]).toMatch(/^표식 없는 숫자: "코스피는 -1/);
    expect(checkText("전각 숫자 ３", ids)).toHaveLength(1);
  });
  it("허용 목록(숫자가 원래 든 고유명사)은 지우고 검사", () => {
    expect(checkText("2차 전지와 S&P 500 은 [[F001]]", ids, ["2차 전지", "S&P 500", ""])).toEqual([]);
    expect(checkText("2차 전지 3개", ids, ["2차 전지"])).toHaveLength(1);
    expect(checkAll(["[[F001]]", "x 7"], ids, [])).toEqual({ ok: false, violations: [expect.stringMatching(/^표식 없는 숫자/)] });
    expect(checkAll(["[[F002]]"], ids)).toEqual({ ok: true, violations: [] });
  });
  it("시나리오 확률", () => {
    expect(checkProbabilities([30, 45, 25])).toEqual([]);
    expect(checkProbabilities([30, 45, 20])).toEqual(["확률 합계 95 ≠ 100"]);
    expect(checkProbabilities([110, -10, 0])).toEqual(["확률은 0~100 정수여야 함"]);
    expect(checkProbabilities([33.5, 33.5, 33])).toEqual(["확률은 0~100 정수여야 함"]);
  });
  it("render: 표식 → 표시값", () => {
    expect(render("코스피 [[F001]], 기준일 [[F002]]", (id) => (id === "F001" ? "-1.1%" : "10/02"))).toBe("코스피 -1.1%, 기준일 10/02");
  });
});

describe("compose", () => {
  const t = { head: ["지표", "주간"], rows: [["KOSPI", "[[F001]]"], ["A|B", "x"]] };
  const d: MemoData = {
    week: "2026-W40", range: "09-28 ~ 10-02", asOf: "2026-10-03 09:30", flywheel: "FlyWheel 주간 리포트 도착",
    market: t, flows: null, industries: { kr: t, us: { head: ["a"], rows: [] } }, earnings: ["MU 실적"], macro: [], sage: ["반도체 — 강세 멘토"],
    portfolio: t, contrib: t, regime: "정상", review: [], failDist: t, stance: "정상", calendar: [], industryView: t, noBasis: [], outlooks: [],
    buyList: t, holdings: ["⚠️ 테슬라"],
  };
  const n: NarrativeText = { market_view: "시장 해석", industry_causes: "원인", portfolio_view: "평가", stance: "스탠스", industry_view: "의견",
    scenarios: [{ name: "Bull", probability: 30, view: "v", trigger: "t" }], wrong_reasons: ["w1"], decisions: ["d1"] };
  it("mdTable: 파이프 치환·빈 표", () => {
    expect(mdTable(t)).toEqual(["| 지표 | 주간 |", "|---|---|", "| KOSPI | [[F001]] |", "| A/B | x |"]);
    expect(mdTable({ head: ["a"], rows: [] })).toEqual(["- 자료 없음"]);
  });
  it("서술 있음: 고정 순서 + 시나리오·이유·결정", () => {
    const md = composeMemo({ ...d, noBasis: ["여행"], flows: t }, n, null);
    expect(md).toContain("# 🏛️ JARVIS 주간 투자위원회 2026-W40");
    expect(md.indexOf("## Ⅰ.")).toBeLessThan(md.indexOf("## Ⅱ."));
    expect(md).toContain("시장 해석");
    expect(md).toContain("| Bull | 30% | v | t |");
    expect(md).toContain("- w1");
    expect(md).toContain("성장 근거 없음: 여행");
    expect(md).not.toContain("⚠️ 서술");
  });
  it("서술 없음: 경고·표만", () => {
    const md = composeMemo(d, null, null);
    expect(md).toContain("> ⚠️ 서술 없이 표·목록만 발행합니다.");
    expect(md).toContain("- 서술 검증을 통과하지 못해 이번 주는 생략");
    expect(md).toContain("### 2. 수급 (주간 순매수)\n- 자료 없음");
    expect(md).toContain("성장 근거 없음: 없음");
    expect(composeMemo(d, null, "숫자 검증 실패")).toContain("> ⚠️ 숫자 검증 실패");
  });
  it("노션 블록 변환", () => {
    const b = mdToNotion("# 제목\n## 큰\n### 작은\n- **글머리**\n> 인용\n| a | b |\n|---|---|\n\n문단");
    expect(b.map((x) => x.type)).toEqual(["heading_1", "heading_2", "heading_3", "bulleted_list_item", "quote", "paragraph", "paragraph"]);
    expect(JSON.stringify(b[3])).toContain("글머리");
    expect(JSON.stringify(b[5])).toContain("a · b");
  });
  it("briefOf: 표·목록 평문", () => {
    const s = briefOf({ ...d, flows: t, outlooks: ["채택"], calendar: ["일정"] });
    expect(s).toContain("[시장] 지표 | 주간");
    expect(s).toContain("[수급]");
    expect(s).toContain("[캘린더] 일정");
    expect(briefOf(d)).toContain("[매크로] 없음");
  });
});
