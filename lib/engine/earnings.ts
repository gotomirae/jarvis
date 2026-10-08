/**
 * 실적 필수 조건의 두 번째 경로 — 영업이익 턴어라운드(흑자 전환 + 매출 증가). 순수 함수. (사용자 지정 2026-10-08, D68)
 * 🎯 F축·🟢 M1 의 실적 조건 = ① 실적 증가·가속 **또는** ② 영업이익 턴어라운드.
 *  · ① 은 원 프로젝트 값(국내 Heimdallr 게이트·점수, 미국 HermesCall F3·F4 / M1 은 entry_checks)을 그대로 쓴다.
 *  · ② (F축용): 최근 확정 분기 영업이익 흑자 ∧ 전년 동기 영업이익 ≤ 0(국내는 Heimdallr 라벨 "흑전"도 인정) ∧ 매출 YoY > 하한.
 *    미국은 영업이익이 없으면 주당순이익으로 본다(HermesCall M1 과 같은 대체). 적자 축소는 아직 적자라 제외.
 *  · 🟢 M1 의 ② 는 원 프로젝트가 같은 정의로 계산한다(INTEGRATION_TASKS L, rules.yaml entry_core.M1 turnaround).
 */
export type TurnaroundRules = { revenue_yoy_min_pct: number; op_year_ago_max: number };

/** 분기 한 줄 (Heimdallr quarterly_fundamentals · HermesCall quarterly_metrics 공통 모양) */
export type QuarterRow = {
  fiscal_year: number; fiscal_quarter: number;
  revenue?: number | string | null; revenue_yoy?: number | string | null;
  op?: number | string | null; eps?: number | string | null;
  op_status_label?: string | null; unit?: string | null; is_estimate?: boolean | null;
};

export type Turnaround = {
  pass: boolean;
  quarter: string | null;            // 판정 분기 "2026Q2"
  basis: "op" | "eps" | null;        // 영업이익 · 주당순이익(미국 대체)
  rev_yoy: number | null;
  why: string | null;                // 미통과 사유(표시용)
};

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const idx = (r: QuarterRow) => r.fiscal_year * 4 + (r.fiscal_quarter - 1);

export function turnaroundOf(rows: QuarterRow[], r: TurnaroundRules): Turnaround {
  const by = new Map<number, QuarterRow>();
  for (const x of rows) if (!x.is_estimate && x.fiscal_quarter >= 1 && x.fiscal_quarter <= 4 && !by.has(idx(x))) by.set(idx(x), x);
  const t = Math.max(...by.keys());
  const cur = by.get(t);
  if (!cur) return { pass: false, quarter: null, basis: null, rev_yoy: null, why: "분기 실적 없음" };
  const prev = by.get(t - 4);
  const quarter = `${cur.fiscal_year}Q${cur.fiscal_quarter}`;
  const basis: Turnaround["basis"] = num(cur.op) !== null ? "op" : num(cur.eps) !== null ? "eps" : null;
  const now = basis ? num(cur[basis]) : null;
  const ago = basis && prev ? num(prev[basis]) : null;

  // 매출 YoY: 저장값 → 없으면 4분기 전 매출로 계산(같은 단위·양수일 때만)
  let rev = num(cur.revenue_yoy);
  if (rev === null && prev && (cur.unit ?? null) === (prev.unit ?? null)) {
    const a = num(cur.revenue), b = num(prev.revenue);
    if (a !== null && b !== null && b > 0) rev = (a / b - 1) * 100;
  }
  const base = { quarter, basis, rev_yoy: rev === null ? null : Math.round(rev * 100) / 100 };

  if (now === null) return { ...base, pass: false, why: "영업이익 데이터 없음" };
  if (now <= 0) return { ...base, pass: false, why: "최근 분기 영업 적자" };
  const turned = (basis === "op" && cur.op_status_label === "흑전") || (ago !== null && ago <= r.op_year_ago_max);
  if (!turned) return { ...base, pass: false, why: ago === null ? "전년 동기 영업이익 데이터 없음" : "흑자 전환 아님(전년 동기도 흑자)" };
  if (rev === null) return { ...base, pass: false, why: "매출 증가율 데이터 없음" };
  if (rev <= r.revenue_yoy_min_pct) return { ...base, pass: false, why: "매출 감소" };
  return { ...base, pass: true, why: null };
}
