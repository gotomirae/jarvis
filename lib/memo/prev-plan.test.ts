import { describe, expect, it } from "vitest";
import { parsePrevPlan, scoreBuys } from "./prev-plan";

// 2026-W40 실제 메모 형식(요약)
const md = [
  "# 🏛️ JARVIS 주간 투자위원회 2026-W40",
  "## Ⅰ. 이번 주 증시 분석",
  "### 4. 매수 검토 리스트",
  "| 종목 | 단계 |",
  "|---|---|",
  "| 이번 주 분석 쪽 표는 무시 | x |",
  "## Ⅱ. 다음 주 투자 전략",
  "",
  "### 1. 기본 스탠스",
  "시장 국면 정상 · 권장 현금 비중 밴드 10~20% (규칙 기반 참고값)",
  "",
  "서술 문단",
  "### 2. 캘린더 (보유 종목 관련 우선)",
  "- 없음",
  "### 4. 매수 검토 리스트",
  "| 종목 | 단계 | 조건 ①②③④⑤ | 무효화선 | 1차 비중(🎯는 주가 반영도) |",
  "|---|---|---|---|---|",
  "| 한화에어로스페이스 | 🟢 진입 신호 | ✓✓✓✓✓ | 1,000,000원 | SnowBall 허용 비중의 1/3 |",
  "| 동방메디컬 | 🎯 매수 검토 | - | - | 10.2 |",
  "### 6. 시나리오",
  "| 시나리오 | 확률 | 전개 | 확인할 트리거 |",
  "|---|---|---|---|",
  "| Bull | 30% | 반도체 강세 | 진입 신호 유지 |",
  "| Base | 확률없음 | 횡보 | 이탈 0건 |",
  "### 6. 다음 주 실행 계획 (지난주 피드백 반영)",
  "- 메모리 1차 분할",
  "### 7. 내가 틀릴 수 있는 이유",
  "- 근거 없는 산업을 긍정 해석",
  "### 8. 결정할 것",
  "- 테슬라 비중 초과 결정",
  "- 없음",
  "## Ⅲ. 다른 장",
  "- 무시",
].join("\n");

describe("지난주 투자 전략 읽기 (D67)", () => {
  it("다음 주 투자 전략 부분만 — 스탠스 · 매수 검토 · 시나리오 · 틀릴 이유 · 결정할 것", () => {
    expect(parsePrevPlan("2026-W40", md)).toEqual({
      week: "2026-W40",
      stance: "시장 국면 정상 · 권장 현금 비중 밴드 10~20% (규칙 기반 참고값)",
      buy: [{ name: "한화에어로스페이스", stage: "🟢 진입 신호" }, { name: "동방메디컬", stage: "🎯 매수 검토" }],
      scenarios: [{ name: "Bull", probability: 30, view: "반도체 강세", trigger: "진입 신호 유지" }, { name: "Base", probability: null, view: "횡보", trigger: "이탈 0건" }],
      decisions: ["테슬라 비중 초과 결정"],
      wrong: ["근거 없는 산업을 긍정 해석"],
      actions: ["메모리 1차 분할"],
    });
  });
  it("전략 장이 없으면 null · 장은 있는데 항목이 없으면 빈 값", () => {
    expect(parsePrevPlan("w", "# 제목\n## Ⅰ. 분석")).toBeNull();
    expect(parsePrevPlan("w", "## Ⅱ. 다음 주 투자 전략\n### 1. 기본 스탠스\n")).toEqual({ week: "w", stance: "", buy: [], scenarios: [], decisions: [], wrong: [], actions: [] });
    expect(parsePrevPlan("w", "## Ⅲ. 다음 주 투자 전략\n머리말\n### 9. 기타\n- x")).toEqual({ week: "w", stance: "", buy: [], scenarios: [], decisions: [], wrong: [], actions: [] });
  });
  it("scoreBuys: 기준 지수보다 높으면 적중, 자료 없으면 채점 제외", () => {
    const s = scoreBuys([{ name: "A", stage: "🟢" }, { name: "B", stage: "🎯" }, { name: "C", stage: "🟡" }], (n) =>
      n === "A" ? { ret: 3, bench: 1, benchName: "KOSPI" } : n === "B" ? { ret: -2, bench: 1, benchName: "KOSPI" } : { ret: null, bench: 1, benchName: "S&P 500" });
    expect(s.rows.map((r) => [r.name, r.excess, r.hit])).toEqual([["A", 2, true], ["B", -3, false], ["C", null, null]]);
    expect([s.hits, s.scored]).toEqual([1, 2]);
  });
});
