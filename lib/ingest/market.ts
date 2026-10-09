/**
 * 시세 어댑터 — Yahoo chart API (무료·무키, HermesCall price_history 실측 소스) · 네이버 일봉(국내 공식 종가).
 * 예외 없이 Result 반환(불변 규칙 6).
 * ※ 야후 국내 종가는 장 마감 동시호가 전 체결가라 거래소 공식 종가와 1~3% 다르다(10/1 실측, D47) → 성과 원장 국내 시세는 naverDaily.
 */
import { fail, ok, safeReason, type Result } from "./types";

export type Bar = { date: string; close: number };
export type Quote = { symbol: string; last: number | null; prev: number | null; change_pct: number | null; date: string | null; closes: Bar[]; volumes?: (number | null)[] };   // volumes = closes 와 같은 순서(📡 미국 섹터 수급 대용, D69)

/** 순수 함수: chart JSON → Quote (결측 종가 제외, 거래소 날짜는 exchangeTimezone 기준) */
export function parseChart(symbol: string, json: unknown): Quote | null {
  const r = (json as { chart?: { result?: unknown[] } })?.chart?.result?.[0] as
    | { meta?: { exchangeTimezoneName?: string }; timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[]; volume?: (number | null)[] }[] } }
    | undefined;
  if (!r?.timestamp || !r.indicators?.quote?.[0]?.close) return null;
  const tz = r.meta?.exchangeTimezoneName ?? "UTC";
  const closes: Bar[] = [];
  const volumes: (number | null)[] = [];
  r.timestamp.forEach((t, i) => {
    const c = r.indicators!.quote![0].close![i];
    if (c === null || c === undefined) return;
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t * 1000));
    closes.push({ date, close: c });
    volumes.push(r.indicators!.quote![0].volume?.[i] ?? null);
  });
  if (!closes.length) return null;
  const last = closes[closes.length - 1];
  const prev = closes.length > 1 ? closes[closes.length - 2].close : null;
  return { symbol, last: last.close, prev, change_pct: prev ? ((last.close - prev) / prev) * 100 : null, date: last.date, closes, volumes };
}

export async function chart(symbol: string, range = "5d", f: typeof fetch = fetch): Promise<Result<Quote>> {
  try {
    const res = await f(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; JARVIS-research)" }, signal: AbortSignal.timeout(15_000),
    });
    if (res.status !== 200) return fail(`${symbol}: HTTP ${res.status}`, res.status);
    const q = parseChart(symbol, await res.json());
    return q ? ok(q, 200) : fail(`${symbol}: 데이터 없음`);
  } catch (e) {
    return fail(`${symbol}: ${safeReason(e)}`);
  }
}

/** 기간 일봉 (YYYY-MM-DD ~ YYYY-MM-DD) — 📅 월간 전략 과거 사례 그래프용 (D63) */
export async function history(symbol: string, from: string, to: string, f: typeof fetch = fetch): Promise<Result<Bar[]>> {
  const ts = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 1000);
  try {
    const res = await f(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${ts(from)}&period2=${ts(to)}&interval=1d`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; JARVIS-research)" }, signal: AbortSignal.timeout(15_000),
    });
    if (res.status !== 200) return fail(`${symbol}: HTTP ${res.status}`, res.status);
    const q = parseChart(symbol, await res.json());
    return q ? ok(q.closes, 200) : fail(`${symbol}: 데이터 없음`);
  } catch (e) {
    return fail(`${symbol}: ${safeReason(e)}`);
  }
}

export async function charts(symbols: string[], range = "5d"): Promise<Record<string, Quote>> {
  const out: Record<string, Quote> = {};
  const rs = await Promise.all(symbols.map((s) => chart(s, range)));
  rs.forEach((r, i) => { if (r.ok) out[symbols[i]] = r.data; });
  return out;
}

/** 순수 함수: 네이버 fchart XML(`<item data="YYYYMMDD|시|고|저|종|거래량" />`) → 일봉 (날짜 오름차순) */
export function parseNaverDaily(xml: string): Bar[] {
  const out: Bar[] = [];
  for (const m of xml.matchAll(/data="(\d{8})\|[^|]*\|[^|]*\|[^|]*\|([\d.]+)\|/g)) {
    const close = Number(m[2]);
    if (close > 0) out.push({ date: `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6)}`, close });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** 네이버 일봉 — 국내 종목 코드(005930) 또는 지수(KOSPI·KOSDAQ). 거래소 공식 종가 */
export async function naverDaily(symbol: string, count = 300, f: typeof fetch = fetch): Promise<Result<Bar[]>> {
  try {
    const res = await f(`https://fchart.stock.naver.com/sise.nhn?symbol=${encodeURIComponent(symbol)}&timeframe=day&count=${count}&requestType=0`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; JARVIS-research)" }, signal: AbortSignal.timeout(15_000),
    });
    if (res.status !== 200) return fail(`naver ${symbol}: HTTP ${res.status}`, res.status);
    const bars = parseNaverDaily(await res.text());
    return bars.length ? ok(bars, 200) : fail(`naver ${symbol}: 데이터 없음`);
  } catch (e) {
    return fail(`naver ${symbol}: ${safeReason(e)}`);
  }
}

export type InvestorFlow = { date: string; personal: number; foreign: number; institutional: number };

/** 순수 함수: 네이버 지수 투자자 동향 JSON({bizdate, personalValue:"-17,897", …}, 단위 억원) → 숫자 */
export function parseNaverTrend(json: unknown): InvestorFlow | null {
  const j = json as { bizdate?: string; personalValue?: string; foreignValue?: string; institutionalValue?: string } | null;
  const n = (v?: string) => (v === undefined ? NaN : Number(v.replace(/[+,]/g, "")));
  if (!j?.bizdate || !/^\d{8}$/.test(j.bizdate)) return null;
  const f = { personal: n(j.personalValue), foreign: n(j.foreignValue), institutional: n(j.institutionalValue) };
  if (![f.personal, f.foreign, f.institutional].every(Number.isFinite)) return null;
  return { date: `${j.bizdate.slice(0, 4)}-${j.bizdate.slice(4, 6)}-${j.bizdate.slice(6)}`, ...f };
}

/** 네이버 지수(KOSPI·KOSDAQ) 하루 투자자별 순매수(억원) */
export async function naverInvestorTrend(index: "KOSPI" | "KOSDAQ", ymd: string, f: typeof fetch = fetch): Promise<Result<InvestorFlow>> {
  try {
    const res = await f(`https://m.stock.naver.com/api/index/${index}/trend?bizdate=${ymd.replace(/-/g, "")}`, { headers: { "User-Agent": "Mozilla/5.0 (compatible; JARVIS-research)" }, signal: AbortSignal.timeout(15_000) });
    if (res.status !== 200) return fail(`naver trend ${index}: HTTP ${res.status}`, res.status);
    const v = parseNaverTrend(await res.json());
    return v ? ok(v, 200) : fail(`naver trend ${index}: 형식 다름`);
  } catch (e) {
    return fail(`naver trend ${index}: ${safeReason(e)}`);
  }
}

export type StockFlow = { date: string; foreign: number; institution: number; individual: number; close?: number };   // close = 그날 종가(순매수 금액 환산용)

/** 순수 함수: 네이버 종목 투자자 동향 JSON([{bizdate, foreignerPureBuyQuant:"-350,942", organPureBuyQuant, individualPureBuyQuant}], 단위 주) → 날짜 오름차순 */
export function parseNaverStockTrend(json: unknown): StockFlow[] {
  if (!Array.isArray(json)) return [];
  const n = (v: unknown) => (typeof v === "string" ? Number(v.replace(/[+,]/g, "")) : NaN);
  const out: StockFlow[] = [];
  for (const r of json as Record<string, unknown>[]) {
    const d = typeof r?.bizdate === "string" && /^\d{8}$/.test(r.bizdate) ? r.bizdate : null;
    const f = { foreign: n(r?.foreignerPureBuyQuant), institution: n(r?.organPureBuyQuant), individual: n(r?.individualPureBuyQuant) };
    const close = n(r?.closePrice);
    if (d && Number.isFinite(f.foreign) && Number.isFinite(f.institution)) out.push({ date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`, ...f, individual: Number.isFinite(f.individual) ? f.individual : 0, ...(Number.isFinite(close) ? { close } : {}) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** 네이버 국내 종목(ETF 포함) 일별 외국인·기관·개인 순매수(주) — 최근 pageSize(≤60) 거래일, before(YYYYMMDD)를 주면 그 날짜 이전으로 거슬러 간다 */
export async function naverStockFlow(code: string, pageSize = 10, f: typeof fetch = fetch, before?: string): Promise<Result<StockFlow[]>> {
  try {
    const res = await f(`https://m.stock.naver.com/api/stock/${encodeURIComponent(code)}/trend?pageSize=${pageSize}${before ? `&bizdate=${before}` : ""}`, { headers: { "User-Agent": "Mozilla/5.0 (compatible; JARVIS-research)" }, signal: AbortSignal.timeout(15_000) });
    if (res.status !== 200) return fail(`naver flow ${code}: HTTP ${res.status}`, res.status);
    const rows = parseNaverStockTrend(await res.json());
    return rows.length ? ok(rows, 200) : fail(`naver flow ${code}: 데이터 없음`);
  } catch (e) {
    return fail(`naver flow ${code}: ${safeReason(e)}`);
  }
}

/** 네이버 종목 투자자 동향을 pages × 60거래일만큼 거슬러 읽는다 (📡 섹터 ETF 수급 추세, D69). 한 쪽이라도 읽으면 성공 */
export async function naverStockFlowLong(code: string, pages: number, f: typeof fetch = fetch): Promise<Result<StockFlow[]>> {
  const out: StockFlow[] = [];
  let before: string | undefined;
  for (let i = 0; i < pages; i++) {
    const r = await naverStockFlow(code, 60, f, before);
    if (!r.ok) { if (out.length) break; return r; }
    out.unshift(...r.data.filter((x) => !out.some((y) => y.date === x.date)));
    const first = r.data[0].date;
    const d = new Date(`${first}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    before = d.toISOString().slice(0, 10).replace(/-/g, "");
    if (r.data.length < 60) break;
  }
  return ok(out.sort((a, b) => a.date.localeCompare(b.date)), 200);
}
