/** 신호 표준 형식 (PRD §6.1, jarvis.signals) */
export type SignalKind =
  | "industry_narrative" | "company_mention_fw" | "mentor_consensus" | "earnings_catalyst" | "earnings_quality_us"
  | "industry_sentiment" | "accel_grade" | "price_reflection" | "entry_check" | "breakout_watch" | "holding_risk";

export type Signal = {
  source: "flywheel" | "sage" | "hermescall" | "heimdallr" | "snowball";
  source_ref: string;
  kind: SignalKind;
  entity_id: string | null;       // null = 산업 신호
  l1_codes: string[];
  direction: -1 | 0 | 1;
  strength: number;               // 0~10
  observed_at: string;            // ISO
  market_date?: string | null;
  expires_at: string | null;
  evidence: Record<string, unknown>;
  dedupe_key: string;
};

/** 신호 계열 — 🎯 "서로 다른 계열 2개 이상 합의"(PRD §6.4)에 쓴다 */
export const FAMILY: Record<SignalKind, string> = {
  industry_narrative: "flywheel", company_mention_fw: "flywheel", mentor_consensus: "sage",
  earnings_catalyst: "hermescall", earnings_quality_us: "hermescall", industry_sentiment: "hermescall",
  accel_grade: "heimdallr", price_reflection: "heimdallr", entry_check: "entry", breakout_watch: "entry", holding_risk: "snowball",
};

export const DAY = 86400_000;
export const addDays = (iso: string, days: number) => new Date(new Date(iso).getTime() + days * DAY).toISOString();
export const clamp10 = (x: number) => Math.max(0, Math.min(10, Math.round(x * 100) / 100));
