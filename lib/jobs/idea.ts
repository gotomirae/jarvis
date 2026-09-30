/**
 * 🎯 매수 검토 종목의 투자 아이디어·매수 근거 수집 (표시 전용 — 판정 미사용). 파이프라인이 axes_daily.evidence.idea 로 저장하고
 * 브리핑·대시보드는 DB 만 읽는다(PRD §8). JARVIS 는 LLM 을 부르지 않는다 — 논지 문장은 원 프로젝트 분석을 출처와 함께 인용한다.
 *  · 논지: Heimdallr analyses.one_line_thesis (국내) → HermesCall beneficiaries.investment_idea (국내·미국 수혜주)
 *  · 실적: Heimdallr quarterly_fundamentals (국내) · HermesCall quarterly_metrics (미국) — 최근 2개 분기 전년 대비
 *  · 산업: industry_heat (M3 ① 실적 중앙값 · ② 미국 증권사 · ③ 전망) · 이벤트: catalyst_events · 리스크: Heimdallr analyses.risks
 */
import { taxonomyConfig } from "@/lib/config/load";
import { dbSelectAll } from "@/lib/db";
import { hasText, type IdeaEvidence } from "@/lib/engine/idea";
import { chartRef, type ChartRef } from "@/lib/engine/technicals";
import { read as heimdallr } from "@/lib/ingest/heimdallr";
import { read as hermes } from "@/lib/ingest/hermescall";
import { chart } from "@/lib/ingest/market";
import { kstDate } from "@/lib/time";
import { rules, type EntityIndex } from "./context";

type HdRisk = { risk?: string; impact?: string; likelihood?: string; watch_metric?: string };
type HdAnalysis = { code: string; fiscal_year: number; fiscal_quarter: number; payload: { one_line_thesis?: string; risks?: HdRisk[] } | null; created_at: string };
type Qf = { code?: string; symbol?: string; fiscal_year: number; fiscal_quarter: number; revenue_yoy: number | null; op_yoy: number | null; eps_yoy?: number | null; is_estimate?: boolean | null };
type Benef = { source_symbol: string; beneficiary_symbol: string; strength: number | null; investment_idea: string | null; created_at?: string };
type Heat = { l1: string; m3_pass: boolean | null; m3_median_rev_yoy_q0: number | null; m3_basis: { us_major_broker?: { detail?: { broker: string; value: number }[] }; outlook?: { source: string; cagr: number }[] } | null };

const RANK: Record<string, number> = { 큼: 3, 높음: 3, 중간: 2, 작음: 1, 낮음: 1 };
const q = (fy: number, fq: number) => `${fy}Q${fq}`;
const inList = (xs: string[]) => `in.(${xs.map((x) => `"${x}"`).join(",")})`;

export type IdeaExtra = { idea: IdeaEvidence; industryGrowth: number | null; nextEvent: string | null };

export async function ideaEvidence(ids: string[], ents: EntityIndex, now = new Date()): Promise<Map<string, IdeaExtra>> {
  const out = new Map<string, IdeaExtra>();
  const list = ids.map((id) => ents.byId.get(id)).filter((e): e is NonNullable<typeof e> => !!e);
  if (!list.length) return out;
  const kr = list.filter((e) => e.market === "KR").map((e) => e.symbol);
  const us = list.filter((e) => e.market === "US").map((e) => e.symbol);
  const today = kstDate(now);
  const fySince = String(now.getUTCFullYear() - 2);

  // 국내 거래소 구분(.KS/.KQ)은 Heimdallr krx_universe 에서 — 코스닥 종목을 .KS 로 조회하면 하루 늦은 시세가 온다(실측)
  const krx = kr.length ? await heimdallr<{ code: string; symbol: string | null }>("krx_universe", { select: "code,symbol", filters: { code: `in.(${kr.join(",")})` } }) : null;
  const yahoo = new Map((krx?.ok ? krx.data : []).filter((r) => r.symbol).map((r) => [r.code, r.symbol as string]));
  const [charts, an, qf, qm, bf, heat, cal] = await Promise.all([
    chartRefs(list.map((e) => ({ id: e.id, market: e.market, symbols: e.market === "US" ? [e.symbol] : yahoo.has(e.symbol) ? [yahoo.get(e.symbol)!] : [`${e.symbol}.KQ`, `${e.symbol}.KS`] }))),
    kr.length ? heimdallr<HdAnalysis>("analyses", { select: "code,fiscal_year,fiscal_quarter,payload,created_at", filters: { code: `in.(${kr.join(",")})` }, order: "created_at.desc" }) : null,
    kr.length ? heimdallr<Qf>("quarterly_fundamentals", { select: "code,fiscal_year,fiscal_quarter,revenue_yoy,op_yoy,is_estimate", filters: { code: `in.(${kr.join(",")})`, fiscal_year: `gte.${fySince}` } }) : null,
    us.length ? hermes<Qf>("quarterly_metrics", { select: "symbol,fiscal_year,fiscal_quarter,revenue_yoy,op_yoy,eps_yoy", filters: { symbol: `in.(${us.join(",")})`, fiscal_year: `gte.${fySince}` } }) : null,
    hermes<Benef>("beneficiaries", { select: "source_symbol,beneficiary_symbol,strength,investment_idea", filters: { beneficiary_symbol: `in.(${[...kr.flatMap((c) => [`${c}.KS`, `${c}.KQ`]), ...us].join(",")})` } }),
    dbSelectAll<Heat & { date: string }>("industry_heat", `select=date,l1,m3_pass,m3_median_rev_yoy_q0,m3_basis&date=gte.${kstDate(new Date(now.getTime() - 3 * 86400_000))}&order=date.desc`),
    dbSelectAll<{ entity_id: string; title: string; date: string | null; window_end: string | null; source: string }>("catalyst_events", `select=entity_id,title,date,window_end,source&entity_id=${inList(list.map((e) => e.id))}&or=(date.gte.${today},window_end.gte.${today})`),
  ]);

  const analysis = new Map<string, HdAnalysis>();
  for (const a of an?.ok ? an.data : []) if (!analysis.has(a.code) && a.payload) analysis.set(a.code, a);
  const quarters = new Map<string, Qf[]>();
  for (const r of [...(qf?.ok ? qf.data : []), ...(qm?.ok ? qm.data : [])]) {
    if (r.is_estimate) continue;
    const k = (r.code ?? r.symbol) as string;
    const arr = quarters.get(k) ?? [];
    if (!arr.some((x) => x.fiscal_year === r.fiscal_year && x.fiscal_quarter === r.fiscal_quarter)) arr.push(r);
    quarters.set(k, arr);
  }
  const benef = new Map<string, Benef>();
  for (const b of bf.ok ? bf.data : []) {
    const k = b.beneficiary_symbol.replace(/\.(KS|KQ)$/i, "");
    if (b.investment_idea && (!benef.has(k) || (b.strength ?? 0) > (benef.get(k)!.strength ?? 0))) benef.set(k, b);
  }
  const heatBy = new Map<string, Heat>();
  for (const h of heat.ok ? heat.data : []) if (!heatBy.has(h.l1)) heatBy.set(h.l1, h);
  const l1Name = new Map(taxonomyConfig().l1.map((r) => [r.code, r.name]));
  const events = new Map<string, { when: string; title: string; source: string; sort: string }[]>();
  for (const c of cal.ok ? cal.data : []) {
    const d = (c.date ?? c.window_end) as string;
    const arr = events.get(c.entity_id) ?? [];
    arr.push({ when: `${c.date ? "" : "~"}${d.slice(5, 7)}/${d.slice(8, 10)}`, title: c.title, source: c.source, sort: d });
    events.set(c.entity_id, arr);
  }

  for (const e of list) {
    const a = e.market === "KR" ? analysis.get(e.symbol) : undefined;
    const b = benef.get(e.symbol);
    const thesis = a?.payload?.one_line_thesis
      ? { text: a.payload.one_line_thesis, source: "Heimdallr 분석", as_of: q(a.fiscal_year, a.fiscal_quarter) }
      : b?.investment_idea ? { text: b.investment_idea, source: `HermesCall ${b.source_symbol} 실적 수혜`, as_of: null } : null;

    const qs = (quarters.get(e.symbol) ?? []).sort((x, y) => y.fiscal_year - x.fiscal_year || y.fiscal_quarter - x.fiscal_quarter);
    const [q0, q1] = qs;
    const useEps = e.market === "US" && q0 && q0.op_yoy === null && q0.eps_yoy !== null && q0.eps_yoy !== undefined;
    const op = (r: Qf | undefined) => (r ? (useEps ? r.eps_yoy ?? null : r.op_yoy) : null);
    const growth = q0 ? {
      fiscal: q(q0.fiscal_year, q0.fiscal_quarter), rev_yoy: q0.revenue_yoy, op_yoy: op(q0),
      prev_fiscal: q1 ? q(q1.fiscal_year, q1.fiscal_quarter) : null, prev_rev_yoy: q1?.revenue_yoy ?? null, prev_op_yoy: op(q1),
      op_label: useEps ? "주당순이익" : "영업이익", source: e.market === "KR" ? "Heimdallr 분기 실적" : "HermesCall 분기 실적",
    } : null;

    const heats = e.l1_codes.map((c) => heatBy.get(c)).filter((h): h is Heat => !!h)
      .sort((x, y) => Number(!!y.m3_pass) - Number(!!x.m3_pass) || (y.m3_median_rev_yoy_q0 ?? -1e9) - (x.m3_median_rev_yoy_q0 ?? -1e9));
    const h = heats[0];
    const industry = h ? {
      name: l1Name.get(h.l1) ?? h.l1, pass: h.m3_pass === true, realized_median: h.m3_median_rev_yoy_q0 === null ? null : Number(h.m3_median_rev_yoy_q0),
      brokers: (h.m3_basis?.us_major_broker?.detail ?? []).map((d) => ({ broker: d.broker, value: Number(d.value) })),
      outlook: (h.m3_basis?.outlook ?? []).map((o) => ({ source: o.source, cagr: Number(o.cagr) })),
    } : null;

    const ev = (events.get(e.id) ?? []).sort((x, y) => x.sort.localeCompare(y.sort));
    const risks = [...(a?.payload?.risks ?? [])].filter((r) => hasText(r.risk))
      .sort((x, y) => (RANK[y.impact ?? ""] ?? 0) - (RANK[x.impact ?? ""] ?? 0) || (RANK[y.likelihood ?? ""] ?? 0) - (RANK[x.likelihood ?? ""] ?? 0));
    const risk = risks[0] ? { text: risks[0].risk as string, watch: risks[0].watch_metric ?? null, source: "Heimdallr 분석" } : null;

    out.set(e.id, {
      idea: { thesis, growth, industry, events: ev.map(({ when, title, source }) => ({ when, title, source })), risk, chart: charts.get(e.id) ?? null },
      industryGrowth: industry?.realized_median ?? null,
      nextEvent: ev[0]?.sort ?? null,
    });
  }
  return out;
}

/** 일봉 1년 → 가격·기술 지표(⑤~⑧). 심볼 후보를 순서대로 시도, 실패한 종목은 비운다(불변 규칙 6) */
async function chartRefs(xs: { id: string; market: "KR" | "US"; symbols: string[] }[]): Promise<Map<string, ChartRef>> {
  const R = rules();
  const out = new Map<string, ChartRef>();
  await Promise.all(xs.map(async (x) => {
    for (const sym of x.symbols) {
      const q = await chart(sym, "1y");
      if (!q.ok) continue;
      const c = chartRef(q.data.closes, x.market === "KR" ? "KRW" : "USD", R.tech_display, R.entry_core.M2_macd_pre_cross);
      if (c) out.set(x.id, c);
      return;
    }
  }));
  return out;
}
