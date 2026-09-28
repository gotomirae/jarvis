/**
 * entities_sync (PRD §4.2, 일 03:00 + 수동): SnowBall 보유·관심 + Heimdallr krx_universe + HermesCall watchlist → jarvis.entities.
 * L1 = resolveEntityL1(overrides → SnowBall sector → Heimdallr 섹터 → HermesCall industries → 제품 설명).
 * HermesCall 최신 분석 id(링크용)와 네이버 미국 코드(30일 캐시, links.yaml)를 채운다.
 */
import { linksConfig, taxonomyConfig } from "@/lib/config/load";
import { dbSelectAll, dbUpsertBatched } from "@/lib/db";
import { buildEntities, type ExistingEntity, type HermesAnalysisRef, type HermesWatchRow, type KrxRow, type SnowballAsset } from "@/lib/entities";
import { read as heimdallr } from "@/lib/ingest/heimdallr";
import { read as hermes } from "@/lib/ingest/hermescall";
import { resolveNaverUs } from "@/lib/ingest/naver";
import { exportPositions, exportWatchlist } from "@/lib/ingest/snowball";
import { recordSource, runJob, slotOf } from "@/lib/jobs";
import { naverCacheFresh } from "@/lib/links";
import { confirmedOverrides } from "@/lib/taxonomy-store";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function entitiesSyncJob(args: Record<string, string>): Promise<void> {
  await runJob("entities_sync", slotOf(args), async () => {
    const [krx, watch, bene, pos, wl, existing] = await Promise.all([
      heimdallr<KrxRow>("krx_universe", { select: "code,name,sector,products" }),
      hermes<HermesWatchRow>("watchlist", { select: "symbol,name,market,industries,active" }),
      hermes<{ analysis_id: number; source_symbol: string; beneficiary_symbol: string; beneficiary_market: string }>("beneficiaries", { select: "analysis_id,source_symbol,beneficiary_symbol,beneficiary_market" }),
      exportPositions(),
      exportWatchlist(),
      dbSelectAll<ExistingEntity>("entities", "select=id,naver_us_code,naver_us_checked_at&market=eq.US"),
    ]);
    await recordSource("heimdallr", krx.ok, krx.ok ? undefined : krx.reason);
    await recordSource("hermescall", watch.ok && bene.ok, [watch, bene].filter((r) => !r.ok).map((r) => (r.ok ? "" : r.reason)).join("; "));
    await recordSource("snowball", pos.ok, pos.ok ? undefined : pos.reason);
    if (!krx.ok && !watch.ok && !pos.ok) throw new Error("모든 원천 실패");

    const hermesRefs: HermesAnalysisRef[] = [];
    for (const b of bene.ok ? bene.data : []) {
      hermesRefs.push({ analysis_id: b.analysis_id, symbol: b.beneficiary_symbol, market: b.beneficiary_market });
      hermesRefs.push({ analysis_id: b.analysis_id, symbol: b.source_symbol, market: "US" });   // 발표 기업(source)은 미국 실적
    }
    const snowball: SnowballAsset[] = [
      ...(pos.ok ? (pos.data as unknown as SnowballAsset[]) : []),
      ...(wl.ok ? (((wl.data as { watch_assets?: SnowballAsset[] }).watch_assets) ?? []) : []),
    ];
    const rows = buildEntities({
      krx: krx.ok ? krx.data : [], hermesWatch: watch.ok ? watch.data : [], snowball, hermesRefs, existing: existing.ok ? existing.data : [],
    }, taxonomyConfig(), await confirmedOverrides());

    // 네이버 미국 코드 (30일 캐시, 1회 최대 150건, 0.3초 간격)
    const lc = linksConfig();
    const naverCfg = lc.stock.naver as unknown as { us_resolve_api: string; us_suffixes: string[] };
    const now = new Date();
    let resolved = 0, failed = 0, tried = 0;
    for (const r of rows) {
      if (r.market !== "US" || naverCacheFresh(r.naver_us_checked_at, now, lc.layout.naver_us_code_cache_days) || tried >= Number(args.naver_max ?? 150)) continue;
      tried++;
      const code = await resolveNaverUs(r.symbol, naverCfg);
      r.naver_us_code = code;
      r.naver_us_checked_at = now.toISOString();
      if (code) resolved++; else failed++;
      await sleep(300);
    }

    const w = await dbUpsertBatched("entities", rows as unknown as Record<string, unknown>[], "id");
    if (!w.ok) throw new Error(w.reason);
    const byL1 = rows.reduce<Record<string, number>>((m, r) => ((m[r.primary_l1] = (m[r.primary_l1] ?? 0) + 1), m), {});
    const byBasis = rows.reduce<Record<string, number>>((m, r) => ((m[r.l1_basis] = (m[r.l1_basis] ?? 0) + 1), m), {});
    const detail = {
      entities: rows.length, KR: rows.filter((r) => r.market === "KR").length, US: rows.filter((r) => r.market === "US").length,
      with_snowball: rows.filter((r) => r.snowball_asset_id).length, with_hermes_analysis: rows.filter((r) => r.hermes_analysis_id).length,
      naver: { tried, resolved, failed }, by_l1: byL1, by_basis: byBasis,
      sources: { krx: krx.ok ? krx.data.length : krx.reason, hermes_watch: watch.ok ? watch.data.length : watch.reason, snowball: snowball.length },
    };
    console.log(JSON.stringify(detail, null, 1));
    return detail;
  });
}
