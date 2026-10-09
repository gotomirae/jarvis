/**
 * 대시보드 그래프 데이터 (서버 전용, 표시 전용 — D56). 외부 시세는 어댑터(lib/ingest)를 거치고 cache_minutes 동안 캐시한다.
 * 실패한 시계열은 빈 배열로 견딘다(불변 규칙 6) — 화면은 "자료 없음"으로 표시.
 */
import { unstable_cache } from "next/cache";
import { loadYaml, taxonomyConfig } from "@/lib/config/load";
import { cycleOf, flowPhaseOf, type Cycle, type CycleRules, type LensRules, type Phase } from "@/lib/engine/cycle";
import { addColumns, alignForward, attachQuarterly, correlation, indicatorSeries, monthReturn, monthsAgo, periodReturn, pickSeries, rebaseMerge, weekWindow, type Bar, type PickPoint, type Point } from "@/lib/engine/series";
import { fearGreed, type FgPoint } from "@/lib/ingest/feargreed";
import { read as heimdallr } from "@/lib/ingest/heimdallr";
import { read as hermes } from "@/lib/ingest/hermescall";
import { fredSeries } from "@/lib/ingest/fred";
import { chart, naverDaily, naverStockFlowLong } from "@/lib/ingest/market";
import { rules } from "@/lib/jobs/context";
import { kstDate } from "@/lib/time";

type Src = "naver" | "yahoo";
export type DashboardConfig = {
  lookback_months: number; cache_minutes: number;
  indices: { sym: string; label: string; source: Src; color: string }[];
  vix: { sym: string; label: string; calm_below: number; fear_above: number };
  fear_greed: { color: string; bands: { extreme_fear: number; fear: number; greed: number; extreme_greed: number } };
  sector_proxies: Record<string, { sym: string; source: Src; name: string; indicator?: Indicator }>;
  cycle: CycleRules;
  lenses: LensRules & { flow: LensRules["flow"] & { pages: number } };
  entry_chart: { rsi_overbought: number; rsi_oversold: number };
  pick_chart: { months: number; ma: number[] };
};
export type Indicator = { sym: string; source: "yahoo" | "fred"; name: string; why: string; invert: boolean; rate?: boolean };
export const dashboardConfig = () => loadYaml<DashboardConfig>("dashboard.yaml");
const TTL = () => dashboardConfig().cache_minutes * 60;

/** 일봉 — 네이버(국내 공식 종가, 개수) · 야후(범위) */
async function rawBars(sym: string, source: Src, days: number): Promise<Bar[]> {
  if (source === "naver") { const r = await naverDaily(sym, days); return r.ok ? r.data : []; }
  const r = await chart(sym, days > 500 ? "5y" : "2y");
  return r.ok ? r.data.closes : [];
}
const bars = (sym: string, source: Src, days: number) => unstable_cache(rawBars, ["jarvis-bars-v1"], { revalidate: TTL() })(sym, source, days);

export type MarketCharts = {
  from: string;
  indices: Point[];   // 지수(첫날 = 100) + fg(공포·탐욕) + vix(변동성지수) — 날짜 합집합 하나로, 세 그래프가 같은 x축을 쓴다
  lines: { key: string; label: string; color: string; ret: number | null; mtd: number | null; wtd: number | null; week: { start: string; end: string } | null; last: number | null; last_date: string | null }[];
  vix: { date: string; value: number }[]; fg: FgPoint[];
};

export async function marketCharts(): Promise<MarketCharts> {
  const C = dashboardConfig();
  const from = monthsAgo(kstDate(), C.lookback_months);
  const series = await Promise.all(C.indices.map((i) => bars(i.sym, i.source, 300)));
  const [vix, fg] = await Promise.all([bars(C.vix.sym, "yahoo", 300), unstable_cache(async (d: string) => { const r = await fearGreed(d); return r.ok ? r.data : []; }, ["jarvis-fg-v1"], { revalidate: TTL() })(from)]);
  const keyed = Object.fromEntries(C.indices.map((i, k) => [`s${k}`, series[k]]));
  const vx = vix.filter((b) => b.date >= from).map((b) => ({ date: b.date, value: Math.round(b.close * 100) / 100 }));
  const fgs = fg.filter((x) => x.date >= from);
  return {
    from,
    indices: addColumns(rebaseMerge(keyed, from), { fg: fgs, vix: vx }, from),
    lines: C.indices.map((i, k) => {
      const last = series[k][series[k].length - 1];
      const w = weekWindow(series[k]);
      return { key: `s${k}`, label: i.label, color: i.color, ret: periodReturn(series[k], from), mtd: monthReturn(series[k]), wtd: w?.change_pct ?? null, week: w ? { start: w.start, end: w.end } : null, last: last?.close ?? null, last_date: last?.date ?? null };
    }),
    vix: vx, fg: fgs,
  };
}

export type SectorFlow = { phase: Phase; short: number; long: number; unit: "억원" | "백만달러"; basis: string } | null;
export type SectorChart = {
  code: string; name: string; proxy: string; market: "KR" | "US";
  points: { date: string; close: number; macd: number; signal: number; hist: number; ind: number | null }[]; week: ReturnType<typeof weekWindow>; ret12m: number | null; cycle: Cycle | null;
  flow: SectorFlow;
  indicator: (Omit<Indicator, "sym" | "source"> & { corr: number | null; last: number | null; last_date: string | null; ret12m: number | null }) | null;
};

/** 핵심 지표 시계열 — 야후(일봉) · FRED(일·월). 실패하면 빈 배열(불변 규칙 6) */
async function rawIndicator(sym: string, source: "yahoo" | "fred", from: string): Promise<Bar[]> {
  if (source === "fred") { const r = await fredSeries(sym, from); return r.ok ? r.data : []; }
  const r = await chart(sym, "2y");
  return r.ok ? r.data.closes : [];
}
const indicatorBars = (sym: string, source: "yahoo" | "fred", from: string) => unstable_cache(rawIndicator, ["jarvis-ind-v1"], { revalidate: TTL() })(sym, source, from);

/** 대표 ETF 일별 순매수 금액 — 국내 = (외국인 + 기관 순매수 주) × 종가 ÷ 1억 · 미국 = 종가 방향 × 거래량 × 종가 ÷ 100만(투자자별 수급 미공개 대용, D15 와 같은 취지) */
async function rawFlow(sym: string, source: Src, pages: number): Promise<{ net: number[]; unit: "억원" | "백만달러"; basis: string }> {
  if (source === "naver") {
    const r = await naverStockFlowLong(sym, pages);
    return { net: r.ok ? r.data.filter((x) => x.close).map((x) => ((x.foreign + x.institution) * (x.close as number)) / 1e8) : [], unit: "억원", basis: "외국인 + 기관 순매수" };
  }
  const q = await chart(sym, "1y");
  if (!q.ok) return { net: [], unit: "백만달러", basis: "거래량 대용" };
  const c = q.data.closes, v = q.data.volumes ?? [];
  const net = c.slice(1).map((b, i) => Math.sign(b.close - c[i].close) * (v[i + 1] ?? 0) * b.close / 1e6);
  return { net, unit: "백만달러", basis: "상승일 거래대금 − 하락일 거래대금(대용)" };
}
const flowOf = (sym: string, source: Src, pages: number) => unstable_cache(rawFlow, ["jarvis-flow-v1"], { revalidate: TTL() })(sym, source, pages);

export async function sectorCharts(): Promise<SectorChart[]> {
  const C = dashboardConfig();
  const R = rules();
  const from = monthsAgo(kstDate(), C.lookback_months);
  const indFrom = monthsAgo(kstDate(), C.lookback_months + 2);
  return Promise.all(taxonomyConfig().l1.map(async (l) => {
    const p = C.sector_proxies[l.code];
    const [xs, ind, fl] = await Promise.all([
      p ? bars(p.sym, p.source, 520) : Promise.resolve([] as Bar[]),
      p?.indicator ? indicatorBars(p.indicator.sym, p.indicator.source, indFrom) : Promise.resolve([] as Bar[]),
      p ? flowOf(p.sym, p.source, C.lenses.flow.pages) : Promise.resolve(null),
    ]);
    const pts = xs.filter((b) => b.date >= from);
    const series = indicatorSeries(xs, from, R.entry_core.M2_macd_pre_cross.params, R.tech_display.rsi_period);
    const aligned = alignForward(series.map((x) => ({ date: x.date, close: x.close })), ind);
    const indIn = ind.filter((b) => b.date >= from);
    const fp = fl ? flowPhaseOf(fl.net, C.lenses.flow) : null;
    const r1 = (x: number) => Math.round(x);
    return {
      code: l.code, name: l.name, proxy: p?.name ?? "대표 ETF 없음", market: p?.source === "naver" ? "KR" : "US",
      // MACD 는 1년 이전 봉까지 넣어 예열한 뒤 기간 안만 (10/8 사용자 요청 — 주가 바로 아래 MACD) · ind = 핵심 지표(같은 날 또는 직전 값, D69)
      points: series.map((x, i) => ({ date: x.date, close: x.close, macd: x.macd, signal: x.signal, hist: x.hist, ind: aligned[i] })), week: weekWindow(pts), ret12m: periodReturn(xs, from),
      cycle: cycleOf(xs.map((b) => b.close), C.cycle),
      flow: fp && fl ? { phase: fp.phase, short: r1(fp.short), long: r1(fp.long), unit: fl.unit, basis: fl.basis } : null,
      indicator: p?.indicator ? { name: p.indicator.name, why: p.indicator.why, invert: p.indicator.invert, corr: correlation(series.map((x) => x.close), aligned), last: indIn[indIn.length - 1]?.close ?? null, last_date: indIn[indIn.length - 1]?.date ?? null, ret12m: p.indicator.rate ? (indIn.length ? Math.round((indIn[indIn.length - 1].close - indIn[0].close) * 100) / 100 : null) : periodReturn(ind, from) } : null,
    } as SectorChart;
  }));
}

/** 🚦 진입 보드 종목 그래프 — 🎯 와 같은 조건(최근 N개월 주가 · 5·10·20일선 · MACD · RSI, 10/8·D69) + 분기 영업이익(미국은 없으면 주당순이익) 전년 대비 증가율 */
export async function stockCharts(ids: string[]): Promise<Map<string, { points: PickPoint[]; op_label: string }>> {
  const C = dashboardConfig();
  const R = rules();
  const from = monthsAgo(kstDate(), C.pick_chart.months);
  const kr = ids.filter((i) => i.startsWith("KR:")).map((i) => i.slice(3));
  const us = ids.filter((i) => i.startsWith("US:")).map((i) => i.slice(3));
  const fy = String(Number(from.slice(0, 4)) - 1);
  type Qf = { code?: string; symbol?: string; fiscal_year: number; fiscal_quarter: number; op_yoy: number | null; eps_yoy?: number | null; is_estimate?: boolean | null };
  const [qk, qu] = await Promise.all([
    kr.length ? heimdallr<Qf>("quarterly_fundamentals", { select: "code,fiscal_year,fiscal_quarter,op_yoy,is_estimate", filters: { code: `in.(${kr.join(",")})`, fiscal_year: `gte.${fy}` } }) : null,
    us.length ? hermes<Qf>("quarterly_metrics", { select: "symbol,fiscal_year,fiscal_quarter,op_yoy,eps_yoy", filters: { symbol: `in.(${us.join(",")})`, fiscal_year: `gte.${fy}` } }) : null,
  ]);
  const qs = new Map<string, Qf[]>();
  for (const q of [...(qk?.ok ? qk.data : []), ...(qu?.ok ? qu.data : [])]) {
    if (q.is_estimate) continue;
    const k = q.code ? `KR:${q.code}` : `US:${q.symbol}`;
    qs.set(k, [...(qs.get(k) ?? []), q]);
  }
  const out = new Map<string, { points: PickPoint[]; op_label: string }>();
  await Promise.all(ids.map(async (id) => {
    const [m, sym] = id.split(":");
    const xs = await bars(m === "US" ? sym.replace(/\./g, "-") : sym, m === "US" ? "yahoo" : "naver", 820);
    if (!xs.length) return;
    const quarters = qs.get(id) ?? [];
    const useEps = m === "US" && quarters.length > 0 && quarters.every((q) => q.op_yoy === null);
    const pts = pickSeries(xs, from, R.entry_core.M2_macd_pre_cross.params, R.tech_display.rsi_period, C.pick_chart.ma);
    out.set(id, { points: attachQuarterly(pts, quarters.map((q) => ({ fy: q.fiscal_year, fq: q.fiscal_quarter, op_yoy: useEps ? q.eps_yoy ?? null : q.op_yoy }))), op_label: useEps ? "주당순이익 증가율" : "영업이익 증가율" });
  }));
  return out;
}

/** 🎯 지금 사기 좋은 종목 그래프 — 최근 N개월 주가 + 이동평균 2개 + MACD + RSI, 그리고 추천 후 수익률 계산용 일봉 (국내 네이버 공식 종가 · 미국 야후) */
export async function pickCharts(ids: string[]): Promise<Map<string, { points: PickPoint[]; bars: Bar[] }>> {
  const C = dashboardConfig();
  const R = rules();
  const from = monthsAgo(kstDate(), C.pick_chart.months);
  const out = new Map<string, { points: PickPoint[]; bars: Bar[] }>();
  await Promise.all(ids.map(async (id) => {
    const [m, sym] = id.split(":");
    const xs = await bars(m === "US" ? sym.replace(/\./g, "-") : sym, m === "US" ? "yahoo" : "naver", 400);
    if (xs.length) out.set(id, { points: pickSeries(xs, from, R.entry_core.M2_macd_pre_cross.params, R.tech_display.rsi_period, C.pick_chart.ma), bars: xs.filter((b) => b.date >= from) });
  }));
  return out;
}
