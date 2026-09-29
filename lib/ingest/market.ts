/**
 * 시세 어댑터 — Yahoo chart API (무료·무키, HermesCall price_history 실측 소스). 예외 없이 Result 반환(불변 규칙 6).
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
