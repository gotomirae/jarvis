/**
 * 지난주 투자 전략 읽기 (사용자 지정 2026-10-08, D67) — 지난주 메모(body_md, 표시값으로 렌더된 마크다운)에서
 * "다음 주 투자 전략" 부분의 기본 스탠스 · 매수 검토 리스트 · 시나리오 · 결정할 것 · 틀릴 수 있는 이유를 꺼낸다. 순수 함수.
 * 이번 주 메모는 이것을 숫자(매수 검토 종목의 이번 주 수익률 vs 시장)로 채점하고 서술로 복기한 뒤 다음 주 전략을 세운다.
 */
export type PrevPlan = {
  week: string;
  stance: string;
  buy: { name: string; stage: string }[];
  scenarios: { name: string; probability: number | null; view: string; trigger: string }[];
  decisions: string[];
  wrong: string[];
  actions: string[];   // "다음 주 실행 계획" (D67 이후 메모부터)
};

const cells = (line: string) => line.split("|").slice(1, -1).map((c) => c.trim());
const isRule = (line: string) => /^\|(\s*-+\s*\|)+$/.test(line.trim());

/** "다음 주 투자 전략" 아래 "### n. 제목" 단위로 나눈다 */
function sections(md: string): Map<string, string[]> {
  const lines = md.split("\n");
  const from = lines.findIndex((l) => /^## .*다음 주 투자 전략/.test(l));
  const out = new Map<string, string[]>();
  if (from < 0) return out;
  let cur: string[] | null = null;
  for (const l of lines.slice(from + 1)) {
    if (/^## /.test(l)) break;
    const h = /^### [\d~]+\.\s*(.+)$/.exec(l);
    if (h) { cur = []; out.set(h[1].trim(), cur); continue; }
    cur?.push(l);
  }
  return out;
}

const pick = (s: Map<string, string[]>, key: string) => [...s.entries()].find(([k]) => k.includes(key))?.[1] ?? [];
const tableRows = (ls: string[]) => ls.filter((l) => l.startsWith("|") && !isRule(l)).slice(1).map(cells);
const bullets = (ls: string[]) => ls.filter((l) => l.startsWith("- ")).map((l) => l.slice(2).trim()).filter((x) => x && x !== "없음" && x !== "자료 없음");

export function parsePrevPlan(week: string, md: string): PrevPlan | null {
  const s = sections(md);
  if (!s.size) return null;
  const stance = pick(s, "기본 스탠스").find((l) => l.trim()) ?? "";
  const buy = tableRows(pick(s, "매수 검토")).filter((r) => r.length >= 2).map((r) => ({ name: r[0], stage: r[1] }));
  const scenarios = tableRows(pick(s, "시나리오")).filter((r) => r.length >= 4).map((r) => {
    const p = /^(\d+)%$/.exec(r[1]);
    return { name: r[0], probability: p ? Number(p[1]) : null, view: r[2], trigger: r[3] };
  });
  return { week, stance: stance.trim(), buy, scenarios, decisions: bullets(pick(s, "결정할 것")), wrong: bullets(pick(s, "틀릴 수 있는 이유")), actions: bullets(pick(s, "실행 계획")) };
}

/** 매수 검토 채점 — 이번 주 수익률이 기준 지수보다 높으면 적중 */
export type BuyScore = { name: string; stage: string; ret: number | null; bench: number | null; benchName: string; excess: number | null; hit: boolean | null };

export function scoreBuys(buy: PrevPlan["buy"], retOf: (name: string) => { ret: number | null; bench: number | null; benchName: string }): { rows: BuyScore[]; hits: number; scored: number } {
  const rows = buy.map((b) => {
    const r = retOf(b.name);
    const excess = r.ret !== null && r.bench !== null ? r.ret - r.bench : null;
    return { name: b.name, stage: b.stage, ret: r.ret, bench: r.bench, benchName: r.benchName, excess, hit: r.ret === null ? null : r.ret > 0 };   // 채점 = 절대 수익률(D69), 지수 대비는 참고
  });
  return { rows, hits: rows.filter((r) => r.hit === true).length, scored: rows.filter((r) => r.hit !== null).length };
}
