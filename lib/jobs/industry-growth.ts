/**
 * industry_growth_realized (PRD §7.3 M3 · §14 07:00·19:00) → jarvis.industry_heat
 *  ① 실적: Heimdallr quarterly_fundamentals(국내 시총 ≥ 1,000억, 확정치, 연결 우선) + HermesCall quarterly_metrics(watchlist)
 *  ② 미국 증권사: jarvis.industry_outlooks adopted(90일) + yaml 수동 broker 항목 → 증권사별 최신값 중앙값
 *  ③ yaml 전망
 * N·C 점수·센티먼트도 함께 기록(/radar). 바스켓 수익률은 P4.
 */
import { industryGrowthConfig, taxonomyConfig } from "@/lib/config/load";
import { dbSelectAll, dbUpsertBatched } from "@/lib/db";
import { realizedGrowth, type QuarterPoint } from "@/lib/engine/industry-growth";
import { m3ForL1, outlookPass, type BrokerAgg, type M3L1, type OutlookEntry } from "@/lib/engine/m3";
import { aggregateL1 } from "@/lib/engine/outlook/adopt";
import { read as heimdallr } from "@/lib/ingest/heimdallr";
import { read as hermes } from "@/lib/ingest/hermescall";
import { recordSource } from "@/lib/jobs";
import { kstDate } from "@/lib/time";
import { activeSignals, loadEntities, rules } from "./context";

const MIN_CAP_KRW = 100_000_000_000;   // PRD §7.3 ① "국내 시총 1,000억원 이상"

export async function industryGrowth(now = new Date()): Promise<{ date: string; l1: Record<string, unknown>[] }> {
  const R = rules().entry_core.M3_industry_high_growth;
  const tx = taxonomyConfig();
  const ig = industryGrowthConfig() as unknown as { industries: Record<string, OutlookEntry[]> };
  const ents = await loadEntities();
  const [qf, uni, qm, outs, signals] = await Promise.all([
    heimdallr<{ code: string; fiscal_year: number; fiscal_quarter: number; fs_div: string; revenue_yoy: number | null; op_yoy: number | null; is_estimate: boolean }>(
      "quarterly_fundamentals", { select: "code,fiscal_year,fiscal_quarter,fs_div,revenue_yoy,op_yoy,is_estimate", filters: { is_estimate: "eq.false" } }),
    heimdallr<{ code: string; market_cap_krw: number | null }>("krx_universe", { select: "code,market_cap_krw" }),
    hermes<{ symbol: string; fiscal_year: number; fiscal_quarter: number; revenue_yoy: number | null; op_yoy: number | null }>("quarterly_metrics", { select: "symbol,fiscal_year,fiscal_quarter,revenue_yoy,op_yoy" }),
    dbSelectAll<{ l1: string; broker: string; value_pct: number; published_date: string; adoption_rule: string }>("industry_outlooks",
      `select=l1,broker,value_pct,published_date,adoption_rule&status=eq.adopted&published_date=gte.${kstDate(new Date(now.getTime() - R.us_major_broker.max_published_age_days * 86400_000))}`),
    activeSignals(now),
  ]);
  await recordSource("heimdallr", qf.ok && uni.ok, qf.ok ? (uni.ok ? undefined : uni.reason) : qf.reason);

  const cap = new Map((uni.ok ? uni.data : []).map((u) => [u.code, u.market_cap_krw ?? 0]));
  const kr = new Map<string, QuarterPoint>();
  for (const r of qf.ok ? qf.data : []) {
    const e = ents.byId.get(`KR:${r.code}`);
    if (!e || (cap.get(r.code) ?? 0) < MIN_CAP_KRW) continue;
    const k = `${r.code}:${r.fiscal_year}Q${r.fiscal_quarter}`;
    if (kr.has(k) && r.fs_div !== "CFS") continue;                      // 연결 우선
    kr.set(k, { entity_id: e.id, market: "KR", l1_codes: e.l1_codes, fiscal: `${r.fiscal_year}Q${r.fiscal_quarter}`, revenue_yoy: r.revenue_yoy, op_yoy: r.op_yoy });
  }
  const us: QuarterPoint[] = (qm.ok ? qm.data : []).flatMap((r) => {
    const e = ents.byId.get(`US:${r.symbol}`);
    return e ? [{ entity_id: e.id, market: "US" as const, l1_codes: e.l1_codes, fiscal: `${r.fiscal_year}Q${r.fiscal_quarter}`, revenue_yoy: r.revenue_yoy, op_yoy: r.op_yoy }] : [];
  });
  const points = [...kr.values(), ...us];

  // ② 증권사별 최신 adopted (+ yaml 수동 broker 항목 = manual)
  const brokerBy = new Map<string, Map<string, { value: number; published: string; rule: string }>>();
  const put = (l1: string, broker: string, value: number, published: string, rule: string) => {
    const m = brokerBy.get(l1) ?? brokerBy.set(l1, new Map()).get(l1)!;
    const cur = m.get(broker);
    if (!cur || published > cur.published) m.set(broker, { value, published, rule });
  };
  for (const o of outs.ok ? outs.data : []) put(o.l1, o.broker, Number(o.value_pct), o.published_date, o.adoption_rule);
  const cut = kstDate(new Date(now.getTime() - R.us_major_broker.max_published_age_days * 86400_000));
  for (const [l1, list] of Object.entries(ig.industries ?? {})) for (const e of list ?? []) {
    if (e.source_type === "broker" && e.broker && e.value_pct !== undefined && e.published_date && e.published_date >= cut && e.url) put(l1, e.broker, e.value_pct, e.published_date, "manual");
  }

  const date = kstDate(now);
  const rowsOut: Record<string, unknown>[] = [];
  const summary: Record<string, unknown>[] = [];
  for (const row of tx.l1) {
    const l1 = row.code;
    const realized = realizedGrowth(l1, points, R.realized);
    const bm = brokerBy.get(l1);
    const broker: BrokerAgg | null = bm && bm.size ? {
      ...aggregateL1(Object.fromEntries([...bm].map(([b, v]) => [b, v.value])), R.us_major_broker.growth_min_pct),
      detail: [...bm].map(([b, v]) => ({ broker: b, value: v.value, published: v.published, rule: v.rule })),
    } : null;
    const outlook = outlookPass(ig.industries?.[l1] ?? [], R.outlook, now);
    const m: M3L1 = m3ForL1(l1, realized, broker, outlook, R);
    const mine = signals.filter((s) => s.entity_id === null && s.l1_codes.includes(l1));
    const nScore = Math.max(0, ...mine.filter((s) => (s.kind === "industry_narrative" || s.kind === "mentor_consensus") && s.direction === 1).map((s) => s.strength));
    const sent = mine.filter((s) => s.kind === "industry_sentiment").reduce((a, s) => a + s.direction * s.strength, 0);
    const inL1 = new Set([...ents.byId.values()].filter((e) => e.l1_codes.includes(l1)).map((e) => e.id));
    const cScore = Math.max(0, ...signals.filter((s) => s.kind === "earnings_catalyst" && s.entity_id && inL1.has(s.entity_id)).map((s) => s.strength));
    rowsOut.push({
      date, l1, n_score: nScore, c_score: cScore, sentiment: sent,
      m3_median_rev_yoy_q0: realized.median_rev_yoy_q0, m3_median_rev_yoy_q1: realized.median_rev_yoy_q1, m3_median_op_yoy: realized.median_op_yoy,
      m3_members: realized.members, m3_pass: m.pass,
      m3_basis: { bases: m.bases, realized: { sample: realized.sample, pass: realized.pass }, us_major_broker: broker, outlook },
    });
    summary.push({ l1, name: row.name, pass: m.pass, bases: Object.entries(m.bases).filter(([, v]) => v).map(([k]) => k), rev_q0: realized.median_rev_yoy_q0, members: realized.members });
  }
  const w = await dbUpsertBatched("industry_heat", rowsOut, "date,l1");
  if (!w.ok) throw new Error(w.reason);
  return { date, l1: summary };
}
