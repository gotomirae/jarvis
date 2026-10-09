/**
 * 레짐 게이트 (PRD §6.3): risk_off = SnowBall REGIME = −1 또는 (VIX ≥ 25 그리고 KOSPI < 60일선). 임계값은 rules.yaml `regime`.
 */
export type RegimeRules = { risk_off_if: { snowball_regime: number; or_all: { vix_min: number; kospi_below_ma: number } } };

export function movingAverage(closes: number[], n: number): number | null {
  if (closes.length < n) return null;
  const xs = closes.slice(-n);
  return xs.reduce((a, b) => a + b, 0) / n;
}

export type RegimeInput = { snowballRegime: number | null; vix: number | null; kospiCloses: number[] };
export type Regime = { risk_off: boolean; reasons: string[]; kospi_ma: number | null };

export function regime(inp: RegimeInput, rules: RegimeRules): Regime {
  const r = rules.risk_off_if;
  const reasons: string[] = [];
  if (inp.snowballRegime === r.snowball_regime) reasons.push(`SnowBall REGIME ${inp.snowballRegime}`);
  const ma = movingAverage(inp.kospiCloses, r.or_all.kospi_below_ma);
  const last = inp.kospiCloses.length ? inp.kospiCloses[inp.kospiCloses.length - 1] : null;
  if (inp.vix !== null && inp.vix >= r.or_all.vix_min && ma !== null && last !== null && last < ma) {
    reasons.push(`VIX ${inp.vix} ≥ ${r.or_all.vix_min} & KOSPI < ${r.or_all.kospi_below_ma}일선`);
  }
  return { risk_off: reasons.length > 0, reasons, kospi_ma: ma };
}

/**
 * 시장 국면 (D69, 사후 검증 학습 단위) — 지수 종가 기준 결정론 규칙. 순수 함수.
 *  📈 상승장 = 종가 > 장기선 ∧ 단기선이 slope_days 전보다 높음 · 📉 하락장 = 종가 < 장기선 ∧ 단기선이 낮아짐 · ↔️ 횡보장 = 그 외
 * 추천 기준은 국면마다 성과가 다르다 → 국면별 표본이 충분하면 그 국면의 성과로 배운 기준을 쓴다(pick-policy).
 */
export type MarketPhase = "up" | "down" | "side";
export type PhaseRules = { ma_long: number; ma_short: number; slope_days: number };
export const MARKET_PHASE_NAME: Record<MarketPhase, string> = { up: "📈 상승장", down: "📉 하락장", side: "↔️ 횡보장" };

export function marketPhase(closes: number[], r: PhaseRules): MarketPhase | null {
  const long = movingAverage(closes, r.ma_long);
  const short = movingAverage(closes, r.ma_short);
  const before = movingAverage(closes.slice(0, closes.length - r.slope_days), r.ma_short);
  if (long === null || short === null || before === null) return null;
  const last = closes[closes.length - 1];
  if (last > long && short > before) return "up";
  if (last < long && short < before) return "down";
  return "side";
}
