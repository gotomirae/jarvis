/**
 * catalysts (M4, PRD §7.3): SnowBall 트리거 · HermesCall 타임라인 · Heimdallr ★○ 분석 트리거 · 국내 실적(컨센 상향) · yaml → jarvis.catalyst_events.
 * 미국 "실적일 + 30일 컨센 상향"은 HermesCall 에 컨센서스 시계열이 없어 P2 에서는 계산하지 않는다(D34). catalyst_watch(CU)는 연계 작업 C 이후.
 */
import { loadYaml } from "@/lib/config/load";
import { dbUpsertBatched } from "@/lib/db";
import { fromEarnings, fromHeimdallr, fromHermes, fromSnowball, fromYaml, type CatalystEvent, type EarningsHint, type HdAnalysis, type SbTrigger, type YamlEvent } from "@/lib/engine/catalysts";
import { read as heimdallr } from "@/lib/ingest/heimdallr";
import { read as hermes } from "@/lib/ingest/hermescall";
import { exportTriggers } from "@/lib/ingest/snowball";
import { recordSource } from "@/lib/jobs";
import { loadEntities, rules } from "./context";

/** 국내 분기 보고 기한(분기말 + 45일)으로 다음 실적 예상일 */
export function nextKrReportDate(fy: number, fq: number): string {
  const qEnd = new Date(Date.UTC(fy, fq * 3, 0));
  return new Date(qEnd.getTime() + 45 * 86400_000).toISOString().slice(0, 10);
}

export async function collectCatalysts(now = new Date()): Promise<Record<string, unknown>> {
  const R = rules().entry_core.M4_catalyst_within_6m;
  const ents = await loadEntities();
  const events: CatalystEvent[] = [];
  const report: Record<string, number | string> = {};

  const t = await exportTriggers(3650);
  if (t.ok) { const e = fromSnowball(t.data as unknown as SbTrigger[], (a) => ents.byAsset.get(a) ?? null); events.push(...e); report.snowball = e.length; }
  else { report.snowball = `실패: ${t.reason}`; await recordSource("snowball", false, t.reason); }

  const [bene, an] = await Promise.all([
    hermes<{ id: number; analysis_id: number; beneficiary_symbol: string; beneficiary_market: string; triggers_timeline: Record<string, unknown> | null; target_price_direction: { direction?: string } | null }>(
      "beneficiaries", { select: "id,analysis_id,beneficiary_symbol,beneficiary_market,triggers_timeline,target_price_direction" }),
    hermes<{ id: number; created_at: string }>("analyses", { select: "id,created_at" }),
  ]);
  if (bene.ok && an.ok) {
    const at = new Map(an.data.map((a) => [a.id, a.created_at]));
    const e = fromHermes(bene.data.filter((b) => at.has(b.analysis_id)).map((b) => ({
      analysis_id: b.analysis_id, beneficiary_id: b.id, entity_id: ents.resolveSymbol(b.beneficiary_symbol, b.beneficiary_market), created_at: at.get(b.analysis_id)!,
      timeline: b.triggers_timeline, direction: b.target_price_direction?.direction ?? null,
    })));
    events.push(...e);
    report.hermescall = e.length;
  } else report.hermescall = `실패: ${[bene, an].filter((r) => !r.ok).map((r) => (r.ok ? "" : r.reason)).join("; ")}`;

  const [ha, grades, cons] = await Promise.all([
    heimdallr<{ id: number; code: string; fiscal_year: number; fiscal_quarter: number; created_at: string; payload: { triggers?: Record<string, unknown> } | null }>("analyses", { select: "id,code,fiscal_year,fiscal_quarter,created_at,payload" }),
    heimdallr<{ code: string; fiscal_year: number; fiscal_quarter: number; grade: string | null }>("screen_results", { select: "code,fiscal_year,fiscal_quarter,grade" }),
    heimdallr<{ code: string; fiscal_year: number; fiscal_quarter: number; op_est: number | null; snapshot_at: string }>("consensus_snapshots", {
      select: "code,fiscal_year,fiscal_quarter,op_est,snapshot_at", filters: { snapshot_at: `gte.${new Date(now.getTime() - 45 * 86400_000).toISOString()}` } }),
  ]);
  if (ha.ok && grades.ok) {
    const g = new Map(grades.data.map((x) => [`${x.code}:${x.fiscal_year}Q${x.fiscal_quarter}`, x.grade]));
    const e = fromHeimdallr(ha.data.map((a): HdAnalysis => ({ id: a.id, code: a.code, created_at: a.created_at, grade: g.get(`${a.code}:${a.fiscal_year}Q${a.fiscal_quarter}`) ?? null, triggers: a.payload?.triggers ?? null })), ["★", "○"]);
    events.push(...e.filter((x) => ents.byId.has(x.entity_id as string)));
    report.heimdallr = e.length;
  } else report.heimdallr = `실패: ${[ha, grades].filter((r) => !r.ok).map((r) => (r.ok ? "" : r.reason)).join("; ")}`;

  if (cons.ok) {
    // 같은 종목·분기의 가장 최신 op_est vs 30일 전 무렵(가장 오래된) 값
    const by = new Map<string, { first: { v: number; at: string }; last: { v: number; at: string }; fy: number; fq: number }>();
    for (const c of cons.data) {
      if (c.op_est === null) continue;
      const k = `${c.code}:${c.fiscal_year}Q${c.fiscal_quarter}`;
      const cur = by.get(k);
      if (!cur) { by.set(k, { first: { v: c.op_est, at: c.snapshot_at }, last: { v: c.op_est, at: c.snapshot_at }, fy: c.fiscal_year, fq: c.fiscal_quarter }); continue; }
      if (c.snapshot_at < cur.first.at) cur.first = { v: c.op_est, at: c.snapshot_at };
      if (c.snapshot_at > cur.last.at) cur.last = { v: c.op_est, at: c.snapshot_at };
    }
    const today = now.toISOString().slice(0, 10);
    const hints: EarningsHint[] = [];
    for (const [k, v] of by) {
      const code = k.split(":")[0];
      const next = nextKrReportDate(v.fy, v.fq);
      if (!ents.byId.has(`KR:${code}`) || next < today || v.first.at === v.last.at || v.first.v === 0) continue;
      hints.push({ entity_id: `KR:${code}`, next_date: next, estimated: true, consensus_change_30d_pct: ((v.last.v - v.first.v) / Math.abs(v.first.v)) * 100, source: `Heimdallr 컨센서스(${v.fy}Q${v.fq} 영업이익)` });
    }
    const e = fromEarnings(hints, R.earnings_with_rising_consensus.consensus_change_30d_min_pct);
    events.push(...e);
    report.earnings = e.length;
  } else report.earnings = `실패: ${cons.reason}`;

  const y = fromYaml((loadYaml<{ events?: YamlEvent[] }>("catalyst_calendar.yaml").events ?? []));
  events.push(...y);
  report.yaml = y.length;

  const rows = [...new Map(events.map((e) => [e.dedupe_key, e])).values()]
    .filter((e) => !e.entity_id || ents.byId.has(e.entity_id))          // FK: 마스터에 없는 종목(yaml 오타 등)은 제외
    .map((e) => ({ ...e, expires_at: e.date ?? e.window_end }));
  const w = await dbUpsertBatched("catalyst_events", rows, "dedupe_key");
  if (!w.ok) throw new Error(w.reason);
  return { events: rows.length, by_source: report };
}
