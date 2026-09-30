/**
 * JARVIS 공개 JSON API (PRD §5.7) — 다른 프로젝트(FlyWheel·Heimdallr·HermesCall)가 읽는다. 민감정보 없음.
 * 순수 함수: 응답 모양만 만든다. 인증(X-Jarvis-Token)·DB 조회는 app/api/public/* 라우트가 한다.
 */

/** 비중 구간 — 금액·정확한 비중은 내보내지 않는다(D1·D26) */
export function weightBucket(w: number | null | undefined): "없음" | "<2%" | "2~5%" | "5~10%" | "≥10%" {
  if (w === null || w === undefined || !Number.isFinite(w) || w <= 0) return "없음";
  const pct = w * 100;
  if (pct < 2) return "<2%";
  if (pct < 5) return "2~5%";
  if (pct < 10) return "5~10%";
  return "≥10%";
}

export type HoldingLite = { entity_id: string | null; ticker: string; name: string; market: string; asset_class: string; l1: string[]; l1_names: string[]; weight_bucket: ReturnType<typeof weightBucket> };

export function holdingsLite(
  positions: { entity_id: string | null; ticker: string; name: string; market: string; asset_class: string; weight: number | null }[],
  l1Of: (entityId: string | null) => string[],
  l1Name: (code: string) => string,
): HoldingLite[] {
  return positions.map((p) => {
    const l1 = l1Of(p.entity_id);
    return { entity_id: p.entity_id, ticker: p.ticker, name: p.name, market: p.market, asset_class: p.asset_class, l1, l1_names: l1.map(l1Name), weight_bucket: weightBucket(p.weight) };
  });
}

export type HeatRow = {
  l1: string; n_score: number | null; c_score: number | null; sentiment: number | null; m3_pass: boolean | null;
  m3_median_rev_yoy_q0: number | null; m3_median_rev_yoy_q1: number | null; m3_members: number | null;
  m3_basis: { bases?: Record<string, boolean>; realized?: { sample?: string }; us_major_broker?: { median: number | null; detail: { broker: string; value: number; published: string; rule: string }[] } | null; outlook?: { segment: string; cagr: number; source: string; as_of: string }[] };
};

/** 산업별 N·C 점수 + M3 통과 여부와 근거 3종 (PRD §5.7) */
export function industryHeat(date: string, rows: HeatRow[], l1Name: (c: string) => string) {
  return {
    date,
    industries: rows.map((r) => ({
      l1: r.l1, name: l1Name(r.l1), narrative_score: r.n_score, catalyst_score: r.c_score, sentiment: r.sentiment,
      high_growth: r.m3_pass === true,
      bases: {
        realized: { pass: r.m3_basis?.bases?.realized === true, median_revenue_yoy_latest: r.m3_median_rev_yoy_q0, median_revenue_yoy_prev: r.m3_median_rev_yoy_q1, members: r.m3_members, sample: r.m3_basis?.realized?.sample ?? null },
        us_major_broker: { pass: r.m3_basis?.bases?.us_major_broker === true, median: r.m3_basis?.us_major_broker?.median ?? null, brokers: r.m3_basis?.us_major_broker?.detail ?? [] },
        outlook: { pass: r.m3_basis?.bases?.outlook === true, items: r.m3_basis?.outlook ?? [] },
      },
    })),
  };
}

/** 헤더 토큰 비교 (상수 시간에 가깝게) */
export function tokenOk(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  let d = given.length ^ expected.length;
  for (let i = 0; i < Math.max(given.length, expected.length); i++) d |= (given.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  return d === 0;
}
