/**
 * 성과 요약 (PRD §12) — 순수 함수. 신호 종류(태그)·시장·기간별 표본 수, 초과수익 중앙값·평균, 적중률.
 * 적중 = 매수 쪽은 초과수익 > 0, 매도 쪽(⚠️·💰)은 초과수익 < 0(경고 후 시장보다 약했음).
 * 표본 30건 미만은 참고용이다(rules.yaml outcomes.min_samples_for_calibration) — 규칙 보정 근거로 쓰지 않는다.
 */
import type { Side } from "./ledger";

export type ScoreInput = { event_type: string; tag: string; level: Side; market: string; horizon_days: number; ret_pct: number; excess_pct: number | null };
export type ScoreRow = {
  event_type: string; tag: string; market: string; horizon_days: number;
  n: number; median_ret: number; median_excess: number | null; mean_excess: number | null; hit_rate: number | null; enough: boolean;
};

const r2 = (x: number) => Math.round(x * 100) / 100;

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function scorecard(rows: ScoreInput[], minSamples: number): ScoreRow[] {
  const groups = new Map<string, ScoreInput[]>();
  for (const r of rows) {
    const k = [r.event_type, r.tag, r.market, r.horizon_days].join("|");
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out: ScoreRow[] = [];
  for (const g of groups.values()) {
    const ex = g.map((r) => r.excess_pct).filter((x): x is number => x !== null);
    const hits = ex.filter((x) => (g[0].level === "sell" ? x < 0 : x > 0)).length;
    const me = median(ex);
    out.push({
      event_type: g[0].event_type, tag: g[0].tag, market: g[0].market, horizon_days: g[0].horizon_days,
      n: g.length, median_ret: r2(median(g.map((r) => r.ret_pct)) as number),
      median_excess: me === null ? null : r2(me),
      mean_excess: ex.length ? r2(ex.reduce((a, b) => a + b, 0) / ex.length) : null,
      hit_rate: ex.length ? r2(hits / ex.length) : null,
      enough: g.length >= minSamples,
    });
  }
  return out.sort((a, b) => a.event_type.localeCompare(b.event_type) || a.tag.localeCompare(b.tag) || a.market.localeCompare(b.market) || a.horizon_days - b.horizon_days);
}
