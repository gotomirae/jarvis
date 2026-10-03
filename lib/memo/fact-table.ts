/**
 * 주간 메모 사실표 (PRD §10.4 ①, SC9) — 순수 함수. 결정론적 잡이 모은 모든 수치·날짜에 F### 번호를 붙인다.
 * 표·목록은 이 사실표의 표시값으로만 그리고, LLM 은 숫자를 [[F012]] 표식으로만 인용한다(lib/memo/grounding.ts 가 검사).
 */
export type FactFormat = "pct_signed" | "pct" | "pctp" | "num" | "int" | "text" | "krw" | "usd" | "eok";
export type Fact = { id: string; group: string; label: string; value: number | string | null; format: FactFormat; display: string };

const NO = "자료 없음";

export function formatFact(value: number | string | null, format: FactFormat, digits = 1): string {
  if (value === null || value === undefined || (typeof value === "number" && !Number.isFinite(value))) return NO;
  if (typeof value === "string" || format === "text") return String(value);
  switch (format) {
    case "pct_signed": return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
    case "pct": return `${value.toFixed(digits)}%`;
    case "pctp": return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%p`;
    case "int": return Math.round(value).toLocaleString("en-US");
    case "krw": return `${Math.round(value).toLocaleString("en-US")}원`;
    case "eok": return `${Math.round(value).toLocaleString("en-US")}억원`;
    case "usd": return `$${value.toFixed(2)}`;
    default: return value.toLocaleString("en-US", { maximumFractionDigits: digits });
  }
}

export type FactBook = { facts: Fact[]; add: (group: string, label: string, value: number | string | null, format: FactFormat, digits?: number) => string; display: (id: string) => string };

export function factBook(): FactBook {
  const facts: Fact[] = [];
  const byId = new Map<string, Fact>();
  return {
    facts,
    add(group, label, value, format, digits = 1) {
      const id = `F${String(facts.length + 1).padStart(3, "0")}`;
      const f: Fact = { id, group, label, value, format, display: formatFact(value, format, digits) };
      facts.push(f);
      byId.set(id, f);
      return id;
    },
    display: (id) => byId.get(id)?.display ?? NO,
  };
}

/** LLM 에 줄 사실표 텍스트: 한 줄에 하나 "F012 | 그룹 | 항목 | 표시값" */
export function factLines(facts: Fact[]): string {
  return facts.map((f) => `${f.id} | ${f.group} | ${f.label} | ${f.display}`).join("\n");
}
