/**
 * 주간 투자위원회 메모 조립 (PRD §10.2 고정 순서) — 순수 함수.
 * 표·목록은 사실표 표시값으로 이미 채워진 셀을 받는다. 서술(narrative)은 grounding 을 통과해 표식이 표시값으로 바뀐 것만 받는다.
 * 서술이 없으면(검증 실패·LLM 미사용) 표·목록만 발행한다(§10.4 ③).
 */
export type Table = { head: string[]; rows: string[][] };

export type MemoData = {
  week: string; range: string; asOf: string;
  flywheel: string;                                // FlyWheel 주간 리포트 상태
  market: Table; flows: Table | null;
  industries: { kr: Table; us: Table };
  earnings: string[]; macro: string[]; sage: string[];
  portfolio: Table; contrib: Table; regime: string;
  review: string[]; failDist: Table;
  stance: string; calendar: string[];
  industryView: Table; noBasis: string[]; outlooks: string[];
  buyList: Table; holdings: string[];
};

export type NarrativeText = {
  market_view: string; industry_causes: string; portfolio_view: string; stance: string; industry_view: string;
  scenarios: { name: string; probability: number; view: string; trigger: string }[];
  wrong_reasons: string[]; decisions: string[];
};

const pipe = (s: string) => s.replace(/\|/g, "/");

export function mdTable(t: Table): string[] {
  if (!t.rows.length) return ["- 자료 없음"];
  return [`| ${t.head.map(pipe).join(" | ")} |`, `|${t.head.map(() => "---").join("|")}|`, ...t.rows.map((r) => `| ${r.map(pipe).join(" | ")} |`)];
}

const list = (xs: string[], empty = "없음") => (xs.length ? xs.map((x) => `- ${x}`) : [`- ${empty}`]);
const para = (s: string | undefined) => (s ? [s, ""] : []);

export function composeMemo(d: MemoData, n: NarrativeText | null, groundingNote: string | null): string {
  const out: string[] = [
    `# 🏛️ JARVIS 주간 투자위원회 ${d.week}`,
    `대상 기간 ${d.range} · 기준 ${d.asOf} KST · ${d.flywheel}`,
    "> 매수 확정 신호가 아닙니다. 최종 판단·입력은 SnowBall에서.",
  ];
  if (!n) out.push("", `> ⚠️ ${groundingNote ?? "서술 없이 표·목록만 발행합니다."}`);
  out.push("", "## Ⅰ. 이번 주 증시 분석", "", ...para(n?.market_view),
    "### 1. 시장 요약", ...mdTable(d.market), "",
    "### 2. 수급 (주간 순매수)", ...(d.flows ? mdTable(d.flows) : ["- 자료 없음"]), "",
    "### 3. 산업 성과 순위 (동일가중 바스켓)", "**국내**", ...mdTable(d.industries.kr), "", "**미국**", ...mdTable(d.industries.us), "", ...para(n?.industry_causes),
    "### 4. 이번 주 실적 결과", ...list(d.earnings), "",
    "### 5. 매크로 이벤트", ...list(d.macro), "",
    "### 6. 멘토 컨센서스 변화 (Sage)", ...list(d.sage), "",
    "### 7. 내 포트폴리오", ...mdTable(d.portfolio), "", "**기여 상위·하위**", ...mdTable(d.contrib), "", `시장 국면: ${d.regime}`, "", ...para(n?.portfolio_view),
    "### 8. 신호 복기", ...list(d.review), "", "**조건별 탈락 분포 (실적 조건 ① 통과 종목 중)**", ...mdTable(d.failDist), "",
    "## Ⅱ. 다음 주 투자 전략", "",
    "### 1. 기본 스탠스", d.stance, "", ...para(n?.stance),
    "### 2. 캘린더 (보유 종목 관련 우선)", ...list(d.calendar), "",
    "### 3. 산업 비중 의견 근거", ...mdTable(d.industryView), "", `성장 근거 없음: ${d.noBasis.length ? d.noBasis.join(", ") : "없음"}`, "",
    "**이번 주 새로 채택·만료된 미국 증권사 근거**", ...list(d.outlooks), "", ...para(n?.industry_view),
    "### 4. 매수 검토 리스트", ...mdTable(d.buyList), "",
    "### 5. 보유 대응", ...list(d.holdings), "");
  if (n) {
    out.push("### 6. 시나리오", ...mdTable({ head: ["시나리오", "확률", "전개", "확인할 트리거"], rows: n.scenarios.map((s) => [s.name, `${s.probability}%`, s.view, s.trigger]) }), "",
      "### 7. 내가 틀릴 수 있는 이유", ...list(n.wrong_reasons), "",
      "### 8. 결정할 것", ...list(n.decisions), "");
  } else {
    out.push("### 6~8. 시나리오 · 틀릴 수 있는 이유 · 결정할 것", "- 서술 검증을 통과하지 못해 이번 주는 생략", "");
  }
  return out.join("\n");
}

/** 노션 블록 변환 — 제목(#·##·###)·글머리(- )·인용(> )·표 행(| |)·문단. 표는 행을 문단으로 펼친다(노션 표 API 생략) */
export type NotionBlock = Record<string, unknown>;
const rt = (s: string) => [{ type: "text", text: { content: s.slice(0, 1900) } }];

export function mdToNotion(md: string): NotionBlock[] {
  const out: NotionBlock[] = [];
  for (const line of md.split("\n")) {
    if (!line.trim() || /^\|(-+\|)+$/.test(line.trim())) continue;
    const bold = line.replace(/\*\*/g, "");
    if (line.startsWith("### ")) out.push({ object: "block", type: "heading_3", heading_3: { rich_text: rt(bold.slice(4)) } });
    else if (line.startsWith("## ")) out.push({ object: "block", type: "heading_2", heading_2: { rich_text: rt(bold.slice(3)) } });
    else if (line.startsWith("# ")) out.push({ object: "block", type: "heading_1", heading_1: { rich_text: rt(bold.slice(2)) } });
    else if (line.startsWith("- ")) out.push({ object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: rt(bold.slice(2)) } });
    else if (line.startsWith("> ")) out.push({ object: "block", type: "quote", quote: { rich_text: rt(bold.slice(2)) } });
    else if (line.startsWith("|")) out.push({ object: "block", type: "paragraph", paragraph: { rich_text: rt(bold.split("|").map((c) => c.trim()).filter(Boolean).join(" · ")) } });
    else out.push({ object: "block", type: "paragraph", paragraph: { rich_text: rt(bold) } });
  }
  return out;
}

/** 서술 검증·LLM 에 줄 요약: 표·목록을 평문으로 (숫자는 이미 표시값 — LLM 에는 표식 버전을 따로 준다) */
export function briefOf(d: MemoData): string {
  const t = (name: string, x: Table) => [`[${name}] ${x.head.join(" | ")}`, ...x.rows.map((r) => `  ${r.join(" | ")}`)];
  return [
    ...t("시장", d.market), ...(d.flows ? t("수급", d.flows) : []), ...t("국내 산업", d.industries.kr), ...t("미국 산업", d.industries.us),
    `[실적] ${d.earnings.join(" / ") || "없음"}`, `[매크로] ${d.macro.join(" / ") || "없음"}`, `[멘토] ${d.sage.join(" / ") || "없음"}`,
    ...t("포트폴리오", d.portfolio), ...t("기여", d.contrib), `[국면] ${d.regime}`, `[신호 복기] ${d.review.join(" / ") || "없음"}`, ...t("탈락 분포", d.failDist),
    `[스탠스] ${d.stance}`, `[캘린더] ${d.calendar.join(" / ") || "없음"}`, ...t("산업 근거", d.industryView), `[성장 근거 없음] ${d.noBasis.join(", ") || "없음"}`,
    `[증권사 근거 변화] ${d.outlooks.join(" / ") || "없음"}`, ...t("매수 검토", d.buyList), `[보유 대응] ${d.holdings.join(" / ") || "없음"}`, `[FlyWheel] ${d.flywheel}`,
  ].join("\n");
}
