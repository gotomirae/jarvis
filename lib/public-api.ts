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

// ── 종목 맥락 (D61) — Claude kairos-deck 심층 분석이 읽는다. SnowBall 훼손조건·확신도·최근 결정 + JARVIS 진입 판정·추천 이력 ──
export type StockContextInput = {
  entity: { id: string; name: string; symbol: string; market: string; l1_names: string[] };
  holding: { weight: number | null; heat_score: number | null; conviction?: number | null; thesis_version?: number | null;
    invalidation_1?: string | null; invalidation_2?: string | null; invalidation_3?: string | null; open_triggers?: number;
    last_decision_action?: string | null; last_decision_date?: string | null } | null;
  entry: { date: string; level: string; m1: boolean; m2: boolean; m3: boolean; m4: boolean; m5: boolean; tag: string | null; invalidation_price: number | null } | null;
  picks: string[];                                   // 이 종목이 🎯 추천에 오른 브리핑 발송 시각(ISO, 오름차순)
};

/** 금액·수량·원가·정확한 비중은 담지 않는다(D1·D26). 훼손조건은 사용자가 쓴 문장 그대로 */
export function stockContext(x: StockContextInput) {
  const h = x.holding;
  return {
    entity: x.entity,
    snowball: h ? {
      held: true, weight_bucket: weightBucket(h.weight), heat_score: h.heat_score ?? null, conviction: h.conviction ?? null, thesis_version: h.thesis_version ?? null,
      invalidation: [h.invalidation_1, h.invalidation_2, h.invalidation_3].filter((s): s is string => !!s && !!s.trim()),
      open_triggers: h.open_triggers ?? 0, last_decision: h.last_decision_action ? { action: h.last_decision_action, date: h.last_decision_date ?? null } : null,
    } : { held: false },
    entry: x.entry ? { date: x.entry.date, level: x.entry.level, conditions: { M1: x.entry.m1, M2: x.entry.m2, M3: x.entry.m3, M4: x.entry.m4, M5: x.entry.m5 }, tag: x.entry.tag, invalidation_price: x.entry.invalidation_price } : null,
    recommendations: { count: x.picks.length, first_at: x.picks[0] ?? null, last_at: x.picks[x.picks.length - 1] ?? null },
    note: "매수 확정 신호가 아님. 훼손조건·확신도는 SnowBall 원장 기준(읽기 전용).",
  };
}
