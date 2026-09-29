/**
 * ingest_all (PRD §14 07:10·19:10): 5개 소스 → 정규화 → jarvis.signals (dedupe_key UNIQUE, 재실행 시 값 갱신).
 * 소스별 실패는 격리하고 source_health 에 남긴다(2회 연속 실패 → 🔧).
 */
import { dbUpsertBatched } from "@/lib/db";
import {
  flywheelMentions, flywheelNarrative, hermesCatalyst, hermesQuality, hermesSentiment, heimdallrGrade, heimdallrPri, sageConsensus, snowballRisk,
  type BeneficiaryRow, type MentionRow, type QuarterlyMetricRow, type ScreenRow, type SentimentRow,
} from "@/lib/engine/normalize";
import type { Signal } from "@/lib/engine/types";
import { latestLinkedSyntheses, wikiSince } from "@/lib/ingest/flywheel";
import { read as heimdallr } from "@/lib/ingest/heimdallr";
import { read as hermes } from "@/lib/ingest/hermescall";
import { read as sage } from "@/lib/ingest/sage";
import { exportRiskAlerts } from "@/lib/ingest/snowball";
import { recordSource } from "@/lib/jobs";
import { l2ToL1, labelToL1, loadEntities, rules } from "./context";

/** 코드별 최신 스크린(가장 최근 분기, 같은 분기면 computed_at 최신) */
export function latestScreens(rows: ScreenRow[]): ScreenRow[] {
  const by = new Map<string, ScreenRow>();
  for (const r of rows) {
    const cur = by.get(r.code);
    const k = (x: ScreenRow) => `${x.fiscal_year}${x.fiscal_quarter}${x.computed_at}`;
    if (!cur || k(r) > k(cur)) by.set(r.code, r);
  }
  return [...by.values()];
}

export async function ingestAll(now = new Date()): Promise<Record<string, unknown>> {
  const R = rules().normalize;
  const ents = await loadEntities();
  const sageToL1 = await labelToL1("sage");
  const hermesToL1 = await labelToL1("hermescall");
  const signals: Signal[] = [];
  const report: Record<string, unknown> = {};
  const note = async (source: string, ok: boolean, count: number | string, err?: string) => {
    report[source] = ok ? count : `실패: ${err}`;
    await recordSource(source, ok, err);
  };

  // FlyWheel — 연계종합(산업 서사) + WiKi 수혜 기업
  const linked = await latestLinkedSyntheses();
  if (linked.ok) { const s = flywheelNarrative(linked.data, l2ToL1(), R); signals.push(...s); await note("flywheel", true, s.length); }
  else await note("flywheel", false, 0, linked.reason);
  const wiki = await wikiSince(R.company_mention_fw.ttl_days);
  if (wiki.ok) { const s = flywheelMentions(wiki.data, ents.resolveName, now, R); signals.push(...s); report.flywheel_wiki = s.length; }
  else report.flywheel_wiki = `실패: ${wiki.reason}`;

  // Sage — 멘토 컨센서스 (최신 스코어카드 sage_score)
  const since30 = new Date(now.getTime() - R.mentor_consensus.ttl_days * 86400_000).toISOString();
  const [mentions, cards] = await Promise.all([
    sage<MentionRow>("mentions", { select: "mentor_id,stance,value,mention_type,published_at", filters: { published_at: `gte.${since30}`, mention_type: "in.(company,sector)" } }),
    sage<{ mentor_scores: { mentor_id: string; sage_score: number; qualified: boolean }[] }>("mentor_scorecards", { select: "mentor_scores", order: "id.desc", limit: 1 }),
  ]);
  if (mentions.ok && cards.ok) {
    const scores = Object.fromEntries((cards.data[0]?.mentor_scores ?? []).filter((m) => m.qualified !== false).map((m) => [m.mentor_id, m.sage_score]));
    const s = sageConsensus(mentions.data, scores, (m) => {
      if (m.mention_type === "company") return ents.resolveName(m.value);
      const l1 = sageToL1(m.value);
      return l1.length === 1 ? `L1:${l1[0]}` : null;
    }, now, R);
    signals.push(...s);
    await note("sage", true, s.length);
  } else await note("sage", false, 0, [mentions, cards].filter((r) => !r.ok).map((r) => (r.ok ? "" : r.reason)).join("; "));

  // HermesCall — 수혜 강도 · F1~F4 · 산업 센티먼트
  const [bene, analyses, qm] = await Promise.all([
    hermes<Omit<BeneficiaryRow, "created_at">>("beneficiaries", { select: "id,analysis_id,beneficiary_symbol,beneficiary_market,strength,industry,source_symbol" }),
    hermes<{ id: number; created_at: string; deep_analysis: { industry_sentiment?: { sentiment?: string }; beneficiary_industries?: { industry?: string }[] } | null }>("analyses", { select: "id,created_at,deep_analysis" }),
    hermes<QuarterlyMetricRow & { id: number }>("quarterly_metrics", { select: "id,symbol,fiscal_year,fiscal_quarter,f1_surprise,f2_guidance_up,f3_acceleration,f4_opm_up" }),
  ]);
  if (bene.ok && analyses.ok && qm.ok) {
    const at = new Map(analyses.data.map((a) => [a.id, a.created_at]));
    const bRows: BeneficiaryRow[] = bene.data.filter((b) => at.has(b.analysis_id)).map((b) => ({ ...b, created_at: at.get(b.analysis_id)! }));
    const cut = now.getTime() - R.earnings_catalyst.ttl_days * 86400_000;
    signals.push(...hermesCatalyst(bRows.filter((b) => new Date(b.created_at).getTime() >= cut), (s, m) => ents.resolveSymbol(s, m), R));
    const latestQ = new Map<string, QuarterlyMetricRow>();
    for (const q of qm.data) { const cur = latestQ.get(q.symbol); if (!cur || q.fiscal_year * 10 + q.fiscal_quarter > cur.fiscal_year * 10 + cur.fiscal_quarter) latestQ.set(q.symbol, q); }
    signals.push(...hermesQuality([...latestQ.values()], (s) => ents.resolveSymbol(s, "US"), now.toISOString(), R));
    const sent: SentimentRow[] = analyses.data.filter((a) => a.deep_analysis?.industry_sentiment).map((a) => ({
      analysis_id: a.id, created_at: a.created_at, sentiment: a.deep_analysis!.industry_sentiment!.sentiment ?? null,
      industries: (a.deep_analysis!.beneficiary_industries ?? []).map((b) => b.industry ?? "").filter(Boolean),
    }));
    signals.push(...hermesSentiment(sent, hermesToL1, now, R));
    await note("hermescall", true, bRows.length);
  } else await note("hermescall", false, 0, [bene, analyses, qm].filter((r) => !r.ok).map((r) => (r.ok ? "" : r.reason)).join("; "));

  // Heimdallr — 가속 등급 · PRI
  const sr = await heimdallr<ScreenRow>("screen_results", { select: "code,fiscal_year,fiscal_quarter,grade,gate_passed,score_final,score_delta,pri,base_effect_warning,computed_at" });
  if (sr.ok) {
    const latest = latestScreens(sr.data).filter((s) => ents.byId.has(`KR:${s.code}`));
    signals.push(...heimdallrGrade(latest, R), ...heimdallrPri(latest, now));
    await note("heimdallr", true, latest.length);
  } else await note("heimdallr", false, 0, sr.reason);

  // SnowBall — 미확인 경보 7일
  const ra = await exportRiskAlerts(new Date(now.getTime() - 7 * 86400_000).toISOString());
  if (ra.ok) {
    const s = snowballRisk(ra.data as never, (asset, ticker) => (asset && ents.byAsset.get(asset)) || (ticker ? ents.resolveSymbol(ticker) : null));
    signals.push(...s);
    await note("snowball", true, s.length);
  } else await note("snowball", false, 0, ra.reason);

  // 같은 dedupe_key 는 마지막 것만 (배치 upsert 는 한 번에 같은 키 두 번을 거부)
  const uniq = [...new Map(signals.map((s) => [s.dedupe_key, s])).values()];
  const w = await dbUpsertBatched("signals", uniq.map((s) => ({ ...s, market_date: s.market_date ?? null })), "dedupe_key");
  if (!w.ok) throw new Error(w.reason);
  const byKind = uniq.reduce<Record<string, number>>((m, s) => ((m[s.kind] = (m[s.kind] ?? 0) + 1), m), {});
  return { signals: uniq.length, by_kind: byKind, sources: report };
}
