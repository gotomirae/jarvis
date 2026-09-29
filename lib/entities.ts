/**
 * 종목 마스터 조립 (PRD §4.2) — 순수 함수. 네트워크는 scripts/entities_sync.ts 가 한다.
 * 원천: SnowBall(보유·관심, 최우선) → Heimdallr krx_universe → HermesCall watchlist. L1 은 resolveEntityL1 순서.
 */
import { resolveEntityL1, type Override, type TaxonomyRules } from "@/lib/taxonomy/match";

export type Market = "KR" | "US";

/** SnowBall market(거래소 코드)·HermesCall market → KR/US. 그 외(펀드 OTHER·JP 등)는 null */
export function marketOf(exchange: string | null | undefined): Market | null {
  const x = (exchange ?? "").toUpperCase();
  if (["KR", "KOSPI", "KOSDAQ", "KONEX"].includes(x)) return "KR";
  if (["US", "NASDAQ", "NYSE", "AMEX", "NYSEARCA", "NYSE ARCA", "BATS"].includes(x)) return "US";
  return null;
}

/** 국내 코드 정규화: "000660.KS" → "000660", 신형 ETF "0080G0" 허용. 형식 밖이면 null */
export function krCode(symbol: string | null | undefined): string | null {
  const s = (symbol ?? "").trim().toUpperCase().replace(/\.(KS|KQ|KN)$/, "");
  return /^[0-9A-Z]{6}$/.test(s) && /^\d/.test(s) ? s : null;
}

export function usSymbol(symbol: string | null | undefined): string | null {
  const s = (symbol ?? "").trim().toUpperCase();
  return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s) ? s : null;
}

/** 미국 종목명 꼬리 정리: "Lumentum Holdings Inc. - Common Stock" → "Lumentum Holdings" */
export function cleanUsName(name: string): string {
  const out = name
    .replace(/\s*[-–]\s*(?:Common Stock|Ordinary Shares|American Depositary Shares?|ADS|Class [A-C].*)$/i, "")
    .replace(/\s+(?:Common Stock|Ordinary Shares|Class [A-C] (?:Common Stock|Ordinary Shares|Shares))$/i, "")
    .replace(/,?\s+(?:Inc\.?|Incorporated|Corp\.?|Corporation|Co\.?|Ltd\.?|Limited|plc|N\.V\.|S\.A\.)$/i, "")
    .trim();
  return out || name;
}

export function entityId(market: Market, symbol: string): string {
  return `${market}:${symbol}`;
}

/** holdings_cache 에 남길 필드만 — 수량·평단·평가액은 버린다(불변 규칙 1, D26) */
export const HOLDING_KEEP = [
  "asset_id", "ticker", "name", "market", "region", "currency", "sector", "asset_class", "weight", "snapshot_date",
  "allowed_weight", "allowed_weight_date", "heat_score", "heat_breakdown", "indicator_date", "thesis_version",
  "conviction", "invalidation_1", "invalidation_2", "invalidation_3", "open_triggers", "last_decision_action", "last_decision_date",
] as const;

export function sanitizePosition(p: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of HOLDING_KEEP) if (k in p) out[k] = p[k];
  const m = marketOf(p.market as string);
  const sym = m === "KR" ? krCode(p.ticker as string) : m === "US" ? usSymbol(p.ticker as string) : null;
  out.entity_id = m && sym ? entityId(m, sym) : null;
  return out;
}

export type KrxRow = { code: string; name: string; sector?: string | null; products?: string | null };
export type HermesWatchRow = { symbol: string; name?: string | null; market: string; industries?: string[] | null; active?: boolean | null };
export type SnowballAsset = { asset_id: string; ticker: string; name: string; market: string; sector?: string | null; asset_class?: string | null };
export type HermesAnalysisRef = { analysis_id: number; symbol: string; market: string };
export type ExistingEntity = { id: string; naver_us_code: string | null; naver_us_checked_at: string | null };

export type EntityRow = {
  id: string; market: Market; symbol: string; name: string; aliases: string[]; primary_l1: string; l1_codes: string[];
  asset_class: string; snowball_asset_id: string | null; hermes_analysis_id: string | null;
  naver_us_code: string | null; naver_us_checked_at: string | null; updated_at: string; l1_basis: string;
};

type Draft = {
  market: Market; symbol: string; name: string; aliases: Set<string>; asset_class: string;
  snowball_asset_id: string | null; snowballSector: string | null; heimdallrSector: string | null; hermesIndustries: string[]; products: string | null;
};

export function buildEntities(
  src: { krx: KrxRow[]; hermesWatch: HermesWatchRow[]; snowball: SnowballAsset[]; hermesRefs: HermesAnalysisRef[]; existing: ExistingEntity[] },
  rules: TaxonomyRules,
  extraOverrides: Override[] = [],
  now: Date = new Date(),
): EntityRow[] {
  const drafts = new Map<string, Draft>();
  const get = (market: Market, symbol: string, name: string): Draft => {
    const id = entityId(market, symbol);
    let d = drafts.get(id);
    if (!d) {
      d = { market, symbol, name, aliases: new Set(), asset_class: "stock", snowball_asset_id: null, snowballSector: null, heimdallrSector: null, hermesIndustries: [], products: null };
      drafts.set(id, d);
    }
    return d;
  };

  for (const r of src.krx) {
    const code = krCode(r.code);
    if (!code) continue;
    const d = get("KR", code, r.name);
    d.heimdallrSector = r.sector ?? null;
    d.products = r.products ?? null;
  }
  for (const w of src.hermesWatch) {
    if (w.active === false) continue;
    const m = marketOf(w.market);
    const sym = m === "KR" ? krCode(w.symbol) : m === "US" ? usSymbol(w.symbol) : null;
    if (!m || !sym) continue;
    const d = get(m, sym, m === "US" && w.name ? cleanUsName(w.name) : w.name || sym);
    d.hermesIndustries = w.industries ?? [];
    if (w.name && w.name !== d.name) d.aliases.add(w.name);
  }
  for (const a of src.snowball) {
    const m = marketOf(a.market);
    const sym = m === "KR" ? krCode(a.ticker) : m === "US" ? usSymbol(a.ticker) : null;
    if (!m || !sym) continue;
    const d = get(m, sym, a.name);
    if (a.name && a.name !== d.name) { d.aliases.add(d.name); d.name = a.name; }   // SnowBall 이름 우선
    d.snowball_asset_id = a.asset_id;
    d.snowballSector = a.sector ?? null;
    d.asset_class = a.asset_class ?? d.asset_class;
  }

  const latest = new Map<string, number>();
  for (const h of src.hermesRefs) {
    const m = marketOf(h.market);
    const sym = m === "KR" ? krCode(h.symbol) : m === "US" ? usSymbol(h.symbol) : null;
    if (!m || !sym) continue;
    const id = entityId(m, sym);
    if ((latest.get(id) ?? -1) < h.analysis_id) latest.set(id, h.analysis_id);
  }
  const existing = new Map(src.existing.map((e) => [e.id, e]));
  const ts = now.toISOString();

  return [...drafts.entries()].map(([id, d]) => {
    const l1 = resolveEntityL1({
      override: d.asset_class === "etf" ? ["ETF"] : null,
      snowballSector: d.snowballSector, heimdallrSector: d.heimdallrSector, hermesIndustries: d.hermesIndustries, products: d.products,
    }, rules, extraOverrides);
    const ex = existing.get(id);
    d.aliases.delete(d.name);
    return {
      id, market: d.market, symbol: d.symbol, name: d.name, aliases: [...d.aliases].sort(), primary_l1: l1.primary_l1, l1_codes: l1.l1_codes,
      asset_class: d.asset_class, snowball_asset_id: d.snowball_asset_id, hermes_analysis_id: latest.has(id) ? String(latest.get(id)) : null,
      naver_us_code: ex?.naver_us_code ?? null, naver_us_checked_at: ex?.naver_us_checked_at ?? null, updated_at: ts, l1_basis: l1.basis,
    };
  });
}
