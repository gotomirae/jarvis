/**
 * M3 ① 실제 실적 (PRD §7.3): L1 소속 기업 매출 YoY 중앙값 ≥ 15%, 최근 2개 분기 연속, 영업이익 YoY 중앙값 > 0.
 * 표본: 국내(시총 기준은 호출부가 거른다) + 미국 HermesCall watchlist. 최소 5개 — 국내 부족하면 국내+미국 합산, 그래도 부족하면 판단 불가.
 * 임계값은 rules.yaml entry_core.M3_industry_high_growth.realized.
 */
export type RealizedRules = { median_revenue_yoy_min_pct: number; consecutive_quarters: number; median_op_yoy_min_pct: number; min_members: number };

export type QuarterPoint = { entity_id: string; market: "KR" | "US"; l1_codes: string[]; fiscal: string; revenue_yoy: number | null; op_yoy: number | null };

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** "2026Q2" 정렬용 */
const fiscalKey = (f: string) => { const m = f.match(/^(\d{4})Q([1-4])$/); return m ? Number(m[1]) * 10 + Number(m[2]) : 0; };

/** 종목별 최근 N개 분기 (최신 먼저) */
export function latestQuarters(points: QuarterPoint[], n: number): Map<string, QuarterPoint[]> {
  const by = new Map<string, QuarterPoint[]>();
  for (const p of points) (by.get(p.entity_id) ?? by.set(p.entity_id, []).get(p.entity_id)!).push(p);
  for (const [k, xs] of by) by.set(k, xs.sort((a, b) => fiscalKey(b.fiscal) - fiscalKey(a.fiscal)).slice(0, n));
  return by;
}

export type RealizedResult = {
  l1: string; pass: boolean | null;       // null = 판단 불가(표본 부족)
  members: number; sample: "KR" | "KR+US" | "insufficient";
  median_rev_yoy_q0: number | null; median_rev_yoy_q1: number | null; median_op_yoy: number | null;
};

export function realizedGrowth(l1: string, points: QuarterPoint[], r: RealizedRules): RealizedResult {
  const inL1 = points.filter((p) => p.l1_codes.includes(l1));
  const pick = (markets: ("KR" | "US")[]) => {
    const q = latestQuarters(inL1.filter((p) => markets.includes(p.market)), r.consecutive_quarters);
    // 최근 N개 분기가 모두 있고 매출 YoY 가 있는 종목만 표본
    return [...q.values()].filter((xs) => xs.length === r.consecutive_quarters && xs.every((x) => x.revenue_yoy !== null));
  };
  let members = pick(["KR"]);
  let sample: RealizedResult["sample"] = "KR";
  if (members.length < r.min_members) { members = pick(["KR", "US"]); sample = "KR+US"; }
  if (members.length < r.min_members) {
    return { l1, pass: null, members: members.length, sample: "insufficient", median_rev_yoy_q0: null, median_rev_yoy_q1: null, median_op_yoy: null };
  }
  const q0 = median(members.map((xs) => xs[0].revenue_yoy as number));
  const q1 = median(members.map((xs) => xs[1]?.revenue_yoy ?? (xs[0].revenue_yoy as number)));
  const opVals = members.map((xs) => xs[0].op_yoy).filter((x): x is number => x !== null);
  const op = median(opVals);
  const revOk = [q0, q1].slice(0, r.consecutive_quarters).every((m) => m !== null && m >= r.median_revenue_yoy_min_pct);
  const opOk = op !== null && op > r.median_op_yoy_min_pct;
  return { l1, pass: revOk && opOk, members: members.length, sample, median_rev_yoy_q0: q0, median_rev_yoy_q1: q1, median_op_yoy: op };
}
