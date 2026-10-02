/**
 * 미국 주가 반영도 pri_us_lite (PRD §7.6) — 하루 1회 계산해 bot_state 'pri_us_lite' 에 저장하고 파이프라인(P축)·진입 판정(미국 M1·게이트)이 함께 쓴다.
 * 시세: 야후 1년 일봉, 벤치마크 S&P 500, 발표 후 반응은 HermesCall earnings_events.pr_detected_at(가장 최근 지난 발표).
 * 3개월 초과수익 백분위의 모집단 = 이번에 계산한 미국 종목 전체(HermesCall entry_checks_us 대상 + 큐 대상).
 */
import { priUsLite, priUsParts, type PriUsParts } from "@/lib/engine/pri-us-lite";
import { read as hermes } from "@/lib/ingest/hermescall";
import { chart } from "@/lib/ingest/market";
import { kstDate } from "@/lib/time";
import { rules } from "./context";
import { getState, setState } from "./poll";

type Stored = { date: string; values: Record<string, number | null> };

async function pool<T, R>(xs: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => { while (i < xs.length) { const k = i++; out[k] = await f(xs[k]); } }));
  return out;
}

/** symbols: 미국 티커. 모집단(HermesCall entry_checks_us 대상)을 항상 포함해 백분위 기준을 하루 안에서 고정. 같은 날 이미 계산된 종목은 다시 받지 않는다 */
export async function priUsLiteMap(symbols: string[], now = new Date()): Promise<Map<string, number | null>> {
  const today = kstDate(now);
  const prev = await getState<Stored>("pri_us_lite");
  const cached = prev?.date === today ? prev.values : {};
  const uni = Object.keys(cached).length ? { ok: false as const } : await hermes<{ symbol: string }>("entry_checks_us", { select: "symbol", filters: { check_date: `gte.${kstDate(new Date(now.getTime() - 10 * 86400_000))}` } });
  const want = [...new Set(symbols.map((s) => s.toUpperCase()))];
  const base = uni.ok ? uni.data.map((r) => r.symbol.toUpperCase()) : [];
  const missing = want.filter((s) => !(s in cached));
  if (missing.length) {
    const all = [...new Set([...Object.keys(cached), ...base, ...missing])];
    const [spx, ee] = await Promise.all([
      chart("^GSPC", "1y"),
      hermes<{ symbol: string; pr_detected_at: string | null }>("earnings_events", { select: "symbol,pr_detected_at", filters: { pr_detected_at: `lte.${now.toISOString()}` } }),
    ]);
    const lastEarn = new Map<string, string>();
    for (const e of ee.ok ? ee.data : []) if (e.pr_detected_at && (!lastEarn.has(e.symbol) || e.pr_detected_at > lastEarn.get(e.symbol)!)) lastEarn.set(e.symbol, e.pr_detected_at);
    const bench = spx.ok ? spx.data.closes : null;
    const parts = await pool(all, 6, async (s): Promise<[string, PriUsParts | null]> => {
      const q = await chart(s.replace(/\./g, "-"), "1y");
      if (!q.ok || q.data.closes.length < 60) return [s, null];
      // 발표 감지 시각(UTC) → 미국 날짜: 장 마감 뒤 발표가 대부분이라 그날 종가가 "발표 전" 종가
      const ed = lastEarn.get(s);
      const usDay = ed ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ed)) : null;
      return [s, priUsParts(q.data.closes, bench, usDay)];
    });
    const rel = parts.map(([, p]) => p?.rel_ret_3m).filter((x): x is number => typeof x === "number");
    const w = rules().pri_us_lite.weights;
    const values: Record<string, number | null> = {};
    for (const [s, p] of parts) values[s] = p ? priUsLite(p, rel, w) : null;
    await setState("pri_us_lite", { date: today, values });
    return new Map(want.map((s) => [s, values[s] ?? null]));
  }
  return new Map(want.map((s) => [s, cached[s] ?? null]));
}
