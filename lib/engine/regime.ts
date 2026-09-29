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
