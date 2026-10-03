/**
 * 숫자 grounding gate (PRD §10.4 ③, D6, SC9) — 순수 함수.
 * LLM 서술에는 숫자를 직접 쓸 수 없다. 숫자는 사실표 표식 [[F012]] 로만 인용하고, 저장 전에 표식을 표시값으로 바꾼다(단위 환산 금지).
 *  · 없는 표식(F999) → 위반
 *  · 표식 밖의 숫자(아라비아·전각) → 위반. 단, 숫자가 원래 들어간 고유명사(산업명 "2차 전지", 지수 "S&P 500", 용어 "1차 비중")는
 *    허용 목록(allow)으로 먼저 지우고 검사한다 — 10/3 첫 실행에서 이 이름들 때문에 서술이 거부됨
 *  · 시나리오 확률은 서술이 아니라 별도 정수 필드로 받고 0~100·합계 100 을 따로 검사한다
 * 위반이 있으면 1회 재생성, 그래도 실패하면 서술 없이 표·목록만 발행한다(lib/jobs/weekly.ts).
 */
const MARK = /\[\[(F\d{3,4})\]\]/g;
const DIGIT = /[0-9０-９]/;

export type Grounding = { ok: boolean; violations: string[] };

export function checkText(text: string, ids: Set<string>, allow: string[] = []): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(MARK)) if (!ids.has(m[1])) out.push(`없는 사실 표식 ${m[1]}`);
  let bare = text.replace(MARK, "");
  for (const a of [...allow].filter(Boolean).sort((x, y) => y.length - x.length)) bare = bare.split(a).join(" ");
  const i = bare.search(DIGIT);
  if (i >= 0) out.push(`표식 없는 숫자: "${bare.slice(Math.max(0, i - 12), i + 12).trim()}"`);
  return out;
}

export function checkAll(texts: string[], ids: Set<string>, allow: string[] = []): Grounding {
  const violations = texts.flatMap((t) => checkText(t, ids, allow));
  return { ok: violations.length === 0, violations };
}

/** 시나리오 확률: 정수 0~100, 합계 100 */
export function checkProbabilities(ps: number[]): string[] {
  const out: string[] = [];
  if (ps.some((p) => !Number.isInteger(p) || p < 0 || p > 100)) out.push("확률은 0~100 정수여야 함");
  const sum = ps.reduce((a, b) => a + b, 0);
  if (sum !== 100) out.push(`확률 합계 ${sum} ≠ 100`);
  return out;
}

/** 표식 → 표시값 (검사를 통과한 문장에만 쓴다) */
export function render(text: string, display: (id: string) => string): string {
  return text.replace(MARK, (_, id: string) => display(id));
}
