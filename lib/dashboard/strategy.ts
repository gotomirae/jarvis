/**
 * 📅 월간 투자 전략 (D63) — content/strategy/YYYY-MM.yaml 을 읽어 화면에 넘긴다. 표시 전용: 🎯·🟢 판정·큐·M1~M5에 쓰지 않는다.
 * 과거 사례 그래프는 야후 일봉(lib/ingest/market.history)으로 열릴 때 계산하고 서버 캐시한다. 실패한 시계열은 빈 칸으로 견딘다(불변 규칙 6).
 */
import fs from "node:fs";
import path from "node:path";
import { unstable_cache } from "next/cache";
import { parse } from "yaml";
import { alignPaths, type Bar, type Point } from "@/lib/engine/series";
import { history } from "@/lib/ingest/market";
import { kstDate } from "@/lib/time";
import { dashboardConfig } from "./data";

type Tone = "gold" | "good" | "hot" | "cool" | "warn" | "arc";
export type StrategyEvent = { date: string; title: string; why?: string };
export type Strategy = {
  month: string; title: string; as_of: string; horizon: string; headline: string[];
  stance: { label: string; value: string; tone: Tone }[];
  snapshot: { label: string; value: string; note: string; tone: Tone }[];
  scenarios: { name: string; prob: number; tone: Tone; when: string; path: string; targets: string; cash: string; play: string }[];
  strategies: {
    id: string; icon: string; title: string; l1: string[]; conviction: string; horizon: string;
    thesis: string[]; precedent: string[]; plan: { when: string; action: string }[]; watch: string[]; exit: string[];
    tickers: { name: string; code: string; market: "KR" | "US" }[];
  }[];
  months: { ym: string; theme: string; macro: StrategyEvent[]; industry: StrategyEvent[]; company: StrategyEvent[]; playbook: string[] }[];
  precedents: {
    id: string; title: string; question: string; days: number; takeaways: string[];
    series: { label: string; note?: string; sym: string; start: string; color: string; current?: boolean }[];
  }[];
  risks: { risk: string; signal: string; response: string }[];
  checklist: string[];
  sources: { title: string; url: string }[];
};

const DIR = () => path.join(process.cwd(), "content", "strategy");

/** 발행된 달 목록 (최신 먼저) */
export function strategyMonths(): string[] {
  try {
    return fs.readdirSync(DIR()).map((f) => /^(\d{4}-\d{2})\.yaml$/.exec(f)?.[1]).filter((m): m is string => !!m).sort().reverse();
  } catch {
    return [];
  }
}

export function loadStrategy(month: string): Strategy | null {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  try {
    return parse(fs.readFileSync(path.join(DIR(), `${month}.yaml`), "utf8")) as Strategy;
  } catch {
    return null;
  }
}

/** 시작일부터 영업일 days 개를 덮을 만큼(달력 일수 ×1.6 + 여유) 일봉 */
async function rawBars(sym: string, start: string, days: number, today: string): Promise<Bar[]> {
  const end = new Date(Date.parse(`${start}T00:00:00Z`) + Math.ceil(days * 1.6 + 10) * 86400_000).toISOString().slice(0, 10);
  const r = await history(sym, start, end < today ? end : today);
  return r.ok ? r.data : [];
}

export type PrecedentChart = { id: string; data: Point[]; lines: { key: string; label: string; note: string; color: string; current: boolean; last: number | null; min: number | null; day: number }[] };

/** 과거 사례 그래프 — 시작일 이후 첫 거래일 = 100, x = 경과 거래일 */
export async function precedentCharts(s: Strategy): Promise<PrecedentChart[]> {
  const today = kstDate();
  const bars = (sym: string, start: string, days: number) =>
    unstable_cache(rawBars, ["jarvis-strategy-bars-v1"], { revalidate: dashboardConfig().cache_minutes * 60 })(sym, start, days, today);
  return Promise.all(s.precedents.map(async (p) => {
    const xs = await Promise.all(p.series.map((x) => bars(x.sym, x.start, p.days)));
    const data = alignPaths(Object.fromEntries(p.series.map((x, i) => [`p${i}`, { bars: xs[i], start: x.start }])), p.days);
    return {
      id: p.id, data,
      lines: p.series.map((x, i) => {
        const vs = data.map((r) => r[`p${i}`]).filter((v): v is number => typeof v === "number");
        return { key: `p${i}`, label: x.label, note: x.note ?? "", color: x.color, current: x.current === true, last: vs.length ? vs[vs.length - 1] : null, min: vs.length ? Math.min(...vs) : null, day: Math.max(0, vs.length - 1) };
      }),
    };
  }));
}
