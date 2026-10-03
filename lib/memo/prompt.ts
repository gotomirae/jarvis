/**
 * 주간 투자위원회 서술 요청 (PRD §10.2·§10.4 ②). LLM 은 서술·시나리오·확률만 쓰고 숫자는 [[F###]] 표식으로만 인용한다.
 * 판정(🟢·큐·M3 등)은 이미 결정론적으로 끝난 값이고, 서술은 그것을 해석·연결할 뿐이다.
 */
import { z } from "zod";

export const NarrativeSchema = z.object({
  market_view: z.string().describe("Ⅰ 이번 주 증시 해석 — 3~5문장"),
  industry_causes: z.string().describe("Ⅰ-3 산업 상위·하위의 원인을 근거 항목과 연결 — 2~4문장"),
  portfolio_view: z.string().describe("Ⅰ-7 내 포트폴리오 주간 평가 — 1~3문장"),
  stance: z.string().describe("Ⅱ-1 다음 주 기본 스탠스 설명 — 2~3문장"),
  industry_view: z.string().describe("Ⅱ-3 산업 비중 확대·축소 의견과 근거 — 2~4문장"),
  scenarios: z.array(z.object({
    name: z.enum(["Bull", "Base", "Bear"]),
    probability: z.number().int().describe("0~100 정수, 세 시나리오 합계 100"),
    view: z.string().describe("이 시나리오의 전개 — 1~2문장"),
    trigger: z.string().describe("다음 주 안에 숫자로 확인할 트리거 — 사실표 항목을 표식으로 인용"),
  })),
  wrong_reasons: z.array(z.string()).describe("내가 틀릴 수 있는 이유 3가지"),
  decisions: z.array(z.string()).describe("이번 주말에 결정할 것 3가지"),
});
export type Narrative = z.infer<typeof NarrativeSchema>;

export const SYSTEM = `당신은 개인 투자자의 주간 투자위원회 서기입니다. 결정론적 시스템(JARVIS)이 이미 계산한 사실표와 판정 결과를 읽고, 사람이 이해하기 쉬운 한국어 서술을 씁니다.

반드시 지킬 규칙:
1. 숫자(아라비아 숫자, 날짜, 퍼센트, 가격, 개수)를 직접 쓰지 않는다. 예외: 이름에 숫자가 원래 들어간 산업명·지수명(예: "2차 전지", "S&P 500", "Russell 2000")은 사실표·요약에 적힌 그대로 쓴다(음역·변형 금지). 기간·차수 표현(1개월·3개월·52주·10년물·1차·2차)도 써도 된다. 숫자가 필요하면 사실표의 표식을 [[F012]] 처럼 그대로 쓴다. 값이 0이거나 "자료 없음"이어도 숫자로 쓰지 말고 표식을 쓴다(예: "흐름 강도가 [[F120]]으로"). 표식은 사실표에 있는 번호만 쓴다. 표식을 새로 만들거나 계산·환산한 숫자를 쓰지 않는다.
2. 사실표에 없는 사실(가격 전망, 목표가, 실적 추정)을 지어내지 않는다. 모르면 "자료 없음"이라고 쓴다.
3. 매수·매도를 지시하지 않는다. "검토", "확인", "점검"으로 쓴다. 판정은 이미 끝났고 서술은 해석이다.
4. 시나리오 확률은 probability 정수 필드에만 쓰고, 문장 안에는 쓰지 않는다. 세 시나리오(Bull·Base·Bear) 합계는 100이다.
5. 표식을 인용할 때는 사실표의 그 항목 이름에 맞게 쓴다(예: "산업 흐름 강도" 표식을 "실적 근거"라고 부르지 않는다). "이번 주 실적(이미 발표)" 그룹은 이미 끝난 일이고, 다음 주 일정은 "캘린더" 그룹뿐이다.
6. 문장은 짧고 쉬운 말로. 약어(PRI, YoY, CAGR 등)는 풀어서 쓴다.`;

export function userPrompt(week: string, factText: string, brief: string): string {
  return [
    `대상 주: ${week}`,
    "",
    "## 사실표 (표식 | 그룹 | 항목 | 값)",
    factText,
    "",
    "## 판정·목록 요약 (숫자는 사실표 표식으로 이미 바뀌어 있음)",
    brief,
    "",
    "위 자료만으로 각 필드를 채우세요. 숫자는 반드시 [[F###]] 표식으로만 인용합니다.",
  ].join("\n");
}
