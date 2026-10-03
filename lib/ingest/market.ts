/**
 * 시세 어댑터 — Yahoo chart API (무료·무키, HermesCall price_history 실측 소스) · 네이버 일봉(국내 공식 종가).
 * 예외 없이 Result 반환(불변 규칙 6).
 * ※ 야후 국내 종가는 장 마감 동시호가 전 체결가라 거래소 공식 종가와 1~3% 다르다(10/1 실측, D47) → 성과 원장 국내 시세는 naverDaily.
 */
import { fail, ok, safeReason, type Result } from "./types";

export type Bar = { date: string; close: number };
export type Quote = { symbol: string; last: number | null; prev: number | null; change_pct: number | null; date: string | null; closes: Bar[] };

/** 순수 함수: chart JSON → Quote (결측 종가 제외, 거래소 날짜는 exchangeTimezone 기준) */
export function parseChart(symbol: string, json: unknown): Quote | null {
  const r = (json as { chart?: { result?: unknown[] } })?.chart?.result?.[0] as
    | { meta?: { exchangeTimezoneName?: string }; timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }
    | undefined;
  if (!r?.timestamp || !r.indicators?.quote?.[0]?.close) return null;
  const tz = r.meta?.exchangeTimezoneName ?? "UTC";
  const closes: Bar[] = [];
  r.timestamp.forEach((t, i) => {
    const c = r.indicators!.quote![0].close![i];
    if (c === null || c === undefined) return;
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t * 1000));
    closes.push({ date, close: c });
  });
  if (!closes.length) return null;
  const last = closes[closes.length - 1];
  const prev = closes.length > 1 ? closes[closes.length - 2].close : null;
  return { symbol, last: last.close, prev, change_pct: prev ? ((last.close - prev) / prev) * 100 : null, date: last.date, closes };
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
