/**
 * 🦾 포트폴리오 정책 표시 (사용자 지정 2026-10-08, D67) — SnowBall D-71 과 같은 값(rules.yaml portfolio_policy).
 * 동적 허용 비중 계산은 SnowBall 몫이다(불변 규칙 2). JARVIS 는 보유 비중을 읽어 해외 비중이 밴드 안인지만 표시·전략 참고에 쓴다. 순수 함수.
 */
export type PortfolioPolicy = {
  tier_caps: { global_top20: number; us: number; kr: number };
  overseas_band: { low: number; high: number; target: number };
  domestic_markets: string[];
  global_top20_tickers?: string[];
};

export type Tier = "global_top20" | "us" | "kr";
export const TIER_NAME: Record<Tier, string> = { global_top20: "글로벌 20위", us: "미국", kr: "국내" };

/** 종목 등급(표시용, SnowBall positionTier 와 같은 규칙) — 글로벌 20위가 국적보다 먼저. 국내 = domestic_markets, 그 외 해외 = 미국 상한 */
export function tierOf(a: { ticker: string; market: string }, p: PortfolioPolicy): { tier: Tier; cap: number } {
  const t = a.ticker.trim().toUpperCase().replace(/\.(KS|KQ)$/, "").replace("-", ".");
  const tier: Tier = (p.global_top20_tickers ?? []).map(String).includes(t) ? "global_top20" : p.domestic_markets.includes(a.market) ? "kr" : "us";
  return { tier, cap: p.tier_caps[tier] };
}

export type RegionMix = { overseas: number; domestic: number; status: "within" | "over" | "under" } | null;

/** 해외 비중 = 해외 비중 합 ÷ 전체 비중 합 (국내 = domestic_markets 에 속한 시장). 비중 합이 0 이면 null */
export function regionMix(rows: { market: string; weight: number | null }[], p: PortfolioPolicy): RegionMix {
  const xs = rows.filter((r): r is { market: string; weight: number } => typeof r.weight === "number" && r.weight > 0);
  const total = xs.reduce((s, r) => s + r.weight, 0);
  if (total <= 0) return null;
  const overseas = xs.filter((r) => !p.domestic_markets.includes(r.market)).reduce((s, r) => s + r.weight, 0) / total;
  const b = p.overseas_band;
  return { overseas, domestic: 1 - overseas, status: overseas > b.high ? "over" : overseas < b.low ? "under" : "within" };
}

/** 한 줄 — "🌏 해외 52.3% · 국내 47.7% (목표 해외 50~60%) ✓ 범위 안" */
export function regionLine(m: RegionMix, p: PortfolioPolicy): string {
  const band = `목표 해외 ${Math.round(p.overseas_band.low * 100)}~${Math.round(p.overseas_band.high * 100)}%`;
  if (!m) return `🌏 해외 비중 자료 없음 (${band})`;
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const st = m.status === "within" ? "✓ 범위 안" : m.status === "over" ? `▲ ${pct(m.overseas - p.overseas_band.high)}p 초과 → 국내 비중 확대 검토` : `▼ ${pct(p.overseas_band.low - m.overseas)}p 미달 → 해외 비중 확대 검토`;
  return `🌏 해외 ${pct(m.overseas)} · 국내 ${pct(m.domestic)} (${band}) ${st}`;
}
