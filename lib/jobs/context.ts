/**
 * 배치·라우트 공용 로더 (서버 전용). JARVIS DB 와 원천 어댑터에서 판정 입력을 모은다.
 * 원천 실패는 빈 값으로 견디고(불변 규칙 6) source_health 에 남긴다.
 */
import { loadYaml, taxonomyConfig } from "@/lib/config/load";
import { dbSelectAll } from "@/lib/db";
import { krCode, marketOf, usSymbol } from "@/lib/entities";
import type { AxesRules } from "@/lib/engine/axes";
import type { HoldingRules } from "@/lib/engine/holding-alerts";
import type { RealizedRules } from "@/lib/engine/industry-growth";
import type { M3Rules } from "@/lib/engine/m3";
import type { NormalizeRules } from "@/lib/engine/normalize";
import type { AdoptionRules } from "@/lib/engine/outlook/adopt";
import type { MacdRules, TechDisplayRules } from "@/lib/engine/technicals";
import type { PRules, QueueRules } from "@/lib/engine/queues";
import type { RegimeRules } from "@/lib/engine/regime";
import type { Signal } from "@/lib/engine/types";
import { classify, normalize as normLabel } from "@/lib/taxonomy/match";
import { confirmedOverrides } from "@/lib/taxonomy-store";

export type Rules = {
  normalize: NormalizeRules;
  axes: AxesRules & { P: PRules };
  regime: RegimeRules;
  queues: QueueRules & { holding_alert: HoldingRules; snowball_submit: { queues: string[]; max_per_day: number; dedupe_days: number } };
  entry_core: {
    M3_industry_high_growth: M3Rules & { realized: RealizedRules; us_major_broker: { growth_min_pct: number; max_published_age_days: number; horizon_end_max_years_ahead: number; adoption: AdoptionRules & { date_mismatch_max_days: number; tier_b_requires_meta_date: boolean } } };
    M2_macd_pre_cross: MacdRules;
    M4_catalyst_within_6m: { horizon_days: number; earnings_with_rising_consensus: { consensus_change_30d_min_pct: number } };
  };
  tech_display: TechDisplayRules;
  inbox: { max_per_day: number; hermescall: { stage: string; strength_min: number; or_filters_min: number }; heimdallr: { grades: string[] }; sage: { new_mentors_min: number } };
  market: { morning: MarketSym[]; us_sectors: MarketSym[]; evening: MarketSym[]; regime: { vix: string; kospi: string } };
  telegram: { realtime_max_per_day_excl_urgent: number };
};
export type MarketSym = { sym: string; label: string; level?: boolean };
export const rules = () => loadYaml<Rules>("rules.yaml");

export type EntityRow = { id: string; market: "KR" | "US"; symbol: string; name: string; aliases: string[]; primary_l1: string | null; l1_codes: string[]; asset_class: string | null; snowball_asset_id: string | null; hermes_analysis_id: string | null; naver_us_code: string | null };

export type EntityIndex = {
  byId: Map<string, EntityRow>;
  byAsset: Map<string, string>;
  resolveName: (name: string) => string | null;
  resolveSymbol: (sym: string, market?: string | null) => string | null;
  names: string[];
};

export async function loadEntities(): Promise<EntityIndex> {
  const r = await dbSelectAll<EntityRow>("entities", "select=id,market,symbol,name,aliases,primary_l1,l1_codes,asset_class,snowball_asset_id,hermes_analysis_id,naver_us_code");
  const rows = r.ok ? r.data : [];
  const byId = new Map(rows.map((e) => [e.id, e]));
  const byAsset = new Map(rows.filter((e) => e.snowball_asset_id).map((e) => [e.snowball_asset_id as string, e.id]));
  const key = (s: string) => s.replace(/[\s()㈜·.,]/g, "").toLowerCase();
  const nameMap = new Map<string, string>();
  for (const e of rows) for (const n of [e.name, ...(e.aliases ?? [])]) if (n && key(n).length >= 2 && !nameMap.has(key(n))) nameMap.set(key(n), e.id);
  return {
    byId, byAsset,
    resolveName: (name) => nameMap.get(key(name)) ?? null,
    resolveSymbol: (sym, market) => {
      const m = marketOf(market ?? (/^\d/.test(sym) ? "KR" : "US"));
      const s = m === "KR" ? krCode(sym) : m === "US" ? usSymbol(sym) : null;
      return m && s && byId.has(`${m}:${s}`) ? `${m}:${s}` : null;
    },
    names: rows.map((e) => e.name),
  };
}

/** 산업 라벨 → L1 코드 (taxonomy, 확정 overrides 포함). ETC·특수 라벨은 빈 배열 */
export async function labelToL1(project: string): Promise<(label: string) => string[]> {
  const tx = taxonomyConfig();
  const extra = await confirmedOverrides();
  const cache = new Map<string, string[]>();
  return (label: string) => {
    const k = normLabel(label, tx.matching.normalize_strip);
    if (!cache.has(k)) cache.set(k, classify(label, project, tx, new Set(), extra).l1_codes.filter((c) => /^[0-9][a-z]$/.test(c)));
    return cache.get(k)!;
  };
}

/** FlyWheel L2 이름 → L1 코드 */
export function l2ToL1(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of taxonomyConfig().l1) for (const l2 of r.l2) out[l2] = r.code;
  return out;
}

export async function activeSignals(now: Date): Promise<Signal[]> {
  const r = await dbSelectAll<Signal>("signals", `select=source,source_ref,kind,entity_id,l1_codes,direction,strength,observed_at,market_date,expires_at,evidence,dedupe_key&or=(expires_at.is.null,expires_at.gt.${now.toISOString()})`);
  return r.ok ? r.data : [];
}

export type HoldingSnap = { asset_id: string; ticker: string; name: string; market: string; entity_id: string | null; asset_class: string; sector?: string | null; weight: number | null; allowed_weight: number | null; heat_score: number | null; invalidation_1?: string | null; invalidation_2?: string | null; invalidation_3?: string | null; open_triggers?: number };

export async function latestHoldings(): Promise<{ snapshot_at: string | null; positions: HoldingSnap[] }> {
  const r = await dbSelectAll<{ snapshot_at: string; payload: { positions: HoldingSnap[] } }>("holdings_cache", "select=snapshot_at,payload&order=snapshot_at.desc&limit=1");
  const row = r.ok ? r.data[0] : undefined;
  return { snapshot_at: row?.snapshot_at ?? null, positions: row?.payload?.positions ?? [] };
}

export const l1Name = (code: string) => taxonomyConfig().l1.find((r) => r.code === code)?.name ?? code;
