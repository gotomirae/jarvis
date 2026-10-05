/**
 * 대시보드 그래프용 시계열 계산 (표시 전용 — 판정에 쓰지 않는다, D56). 순수 함수.
 *  · 여러 지수를 기간 첫날 = 100 으로 맞춰 한 그래프에 겹치기
 *  · 이번 주(월요일 시작) 구간과 주간 등락률
 *  · 주가 + MACD + RSI 일별 시계열, 분기 영업이익 증가율을 분기말 다음 첫 거래일에 붙이기
 */
import { ema, rsiSeries } from "./technicals";

export type Bar = { date: string; close: number };
export type Point = Record<string, number | string | null> & { date: string };

/** 기간 시작일 (YYYY-MM-DD 에서 N개월 전) */
export function monthsAgo(today: string, n: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
}

/** 각 시계열을 from 이후 첫 값 = 100 으로 바꿔 날짜 합집합으로 합친다(휴장일은 null) */
export function rebaseMerge(series: Record<string, Bar[]>, from: string): Point[] {
  const byDate = new Map<string, Point>();
  for (const [k, bars] of Object.entries(series)) {
    const xs = bars.filter((b) => b.date >= from);
    if (!xs.length) continue;
    const base = xs[0].close;
    for (const b of xs) {
      const p = byDate.get(b.date) ?? byDate.set(b.date, { date: b.date }).get(b.date)!;
      p[k] = Math.round((b.close / base) * 10000) / 100;
    }
  }
  const keys = Object.keys(series);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).map((p) => ({ ...Object.fromEntries(keys.map((k) => [k, null])), ...p }) as Point);
}

/** 기간 수익률(%) — 마지막 값 vs 첫 값 */
export function periodReturn(bars: Bar[], from: string): number | null {
  const xs = bars.filter((b) => b.date >= from);
  return xs.length >= 2 ? (xs[xs.length - 1].close / xs[0].close - 1) * 100 : null;
}

/** 날짜가 속한 주의 월요일 */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** 이번 주(마지막 봉이 속한 주) 첫 거래일·마지막 거래일·주간 등락률(직전 주 마지막 종가 대비) */
export function weekWindow(bars: Bar[]): { start: string; end: string; change_pct: number | null } | null {
  if (!bars.length) return null;
  const end = bars[bars.length - 1];
  const mon = weekStart(end.date);
  const i = bars.findIndex((b) => b.date >= mon);
  const prev = i > 0 ? bars[i - 1].close : null;
  return { start: bars[i].date, end: end.date, change_pct: prev ? (end.close / prev - 1) * 100 : null };
}

export type IndicatorPoint = { date: string; close: number; macd: number; signal: number; hist: number; rsi: number | null; op_yoy: number | null };

/** 일봉 → 주가·MACD·시그널·막대·RSI (전체로 계산한 뒤 from 이후만 돌려준다 — 앞부분 예열 구간 제외) */
export function indicatorSeries(bars: Bar[], from: string, macd: [number, number, number], rsiPeriod: number): IndicatorPoint[] {
  const xs = bars.map((b) => b.close);
  const [a, b, c] = macd;
  const slow = ema(xs, b);
  const line = ema(xs, a).map((v, i) => v - slow[i]);
  const sig = ema(line, c);
  const rs = rsiSeries(xs, rsiPeriod);
  const off = xs.length - rs.length;
  const r4 = (x: number) => Math.round(x * 10000) / 10000;
  return bars.map((bar, i) => ({ date: bar.date, close: bar.close, macd: r4(line[i]), signal: r4(sig[i]), hist: r4(line[i] - sig[i]), rsi: i >= off ? Math.round(rs[i - off] * 10) / 10 : null, op_yoy: null }))
    .filter((p) => p.date >= from);
}

/** 분기말 날짜 (2026, 2 → 2026-06-30) */
export function quarterEnd(fy: number, fq: number): string {
  const m = fq * 3;
  return new Date(Date.UTC(fy, m, 0)).toISOString().slice(0, 10);
}

/** 최근 n개 분기의 첫날 (오늘이 속한 분기 포함) */
export function quartersAgoStart(today: string, n: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  const q0 = Math.floor(d.getUTCMonth() / 3);
  return new Date(Date.UTC(d.getUTCFullYear(), q0 * 3 - (n - 1) * 3, 1)).toISOString().slice(0, 10);
}

/** 분기 영업이익 증가율을 분기말 이후 첫 거래일 점에 붙인다(그 기간 밖이면 버림) */
export function attachQuarterly(points: IndicatorPoint[], quarters: { fy: number; fq: number; op_yoy: number | null }[]): IndicatorPoint[] {
  const out = points.map((p) => ({ ...p }));
  for (const q of quarters) {
    if (q.op_yoy === null) continue;
    const at = out.find((p) => p.date > quarterEnd(q.fy, q.fq));
    if (at) at.op_yoy = Math.round(q.op_yoy * 10) / 10;
  }
  return out;
}

/** 이번 달 수익률(%) — 마지막 봉이 속한 달의 직전 달 마지막 종가 대비. 직전 달 자료가 없으면 null */
export function monthReturn(bars: Bar[]): number | null {
  if (!bars.length) return null;
  const end = bars[bars.length - 1];
  const prev = [...bars].reverse().find((b) => b.date < `${end.date.slice(0, 7)}-01`);
  return prev ? (end.close / prev.close - 1) * 100 : null;
}

/** 합친 시계열에 다른 값(공포·탐욕·변동성 등)을 날짜로 붙인다 — 날짜 합집합, 없는 값은 null. 세로 비교용 공통 x축 */
export function addColumns(points: Point[], cols: Record<string, { date: string; value: number; [k: string]: unknown }[]>, from: string): Point[] {
  const byDate = new Map(points.map((p) => [p.date, { ...p }]));
  const keys = Object.keys(points[0] ?? {}).filter((k) => k !== "date");
  for (const [k, xs] of Object.entries(cols)) {
    for (const x of xs) {
      if (x.date < from) continue;
      const p = byDate.get(x.date) ?? byDate.set(x.date, { date: x.date, ...Object.fromEntries(keys.map((kk) => [kk, null])) } as Point).get(x.date)!;
      p[k] = x.value;
      if (typeof x.rating === "string") p[`${k}_rating`] = x.rating;
    }
  }
  const all = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const colKeys = Object.keys(cols);
  return all.map((p) => ({ ...Object.fromEntries(colKeys.map((k) => [k, null])), ...p }) as Point);
}
