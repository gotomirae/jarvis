/**
 * SnowBall Heritage 어댑터 (PRD §5.1, SnowBall 0019_jarvis_contract.sql / D-69).
 * - 토큰 RPC 로만 접근한다. 반드시 POST (GET 이면 토큰이 URL 에 남는다).
 * - 읽기 6개 + 쓰기 1개(jarvis_submit_idea: draft 제출). 보유·거래·원가·논지를 쓰는 경로는 없다(불변 규칙 1).
 * - 응답 필드명은 SnowBall types/index.ts 의 Jarvis* 인터페이스와 1:1. 누락 필드는 호출부에서 방어한다.
 */
import { env } from "@/lib/env";
import { rpc, type RestTarget } from "./rest";
import { fail, ok, type ProbeRow, type Result, type SourceAdapter } from "./types";

export type SnowballMarket = "KR" | "US" | string;

export interface JarvisPosition {
  asset_id: string;
  ticker: string;
  name: string;
  market: SnowballMarket;
  sector: string | null;
  asset_class: string;                 // stock/etf/fund … — 개별 종목 신호는 stock 만
  weight: number | null;
  allowed_weight: number | null;
  heat_score: number | null;
  heat_breakdown: Record<string, unknown> | null;
  thesis_version: number | null;
  conviction: number | null;
  invalidation_1: string | null;
  invalidation_2: string | null;
  invalidation_3: string | null;
  open_triggers: number;
  last_decision_action: string | null;
  last_decision_date: string | null;
  [k: string]: unknown;                // qty·avg_cost 등은 읽기 캐시에만 머문다(쓰기 경로 없음)
}

export interface JarvisTrigger {
  trigger_id: string;
  asset_id: string;
  ticker: string;
  market: SnowballMarket;
  name: string;
  direction: "positive" | "negative" | string;
  category: string;
  expected_date: string | null;
  status: "waiting" | "imminent" | string;
  one_line: string;
  source_url: string | null;
  [k: string]: unknown;
}

export type JarvisMacro = Record<string, { value: number; date: string; source: string }>;

export interface JarvisCheck { pass: boolean | null; note?: string | null }
export interface JarvisSubmitIdeaInput {
  ticker: string;
  market?: SnowballMarket | null;
  idea: Record<string, unknown>;        // payload.source='jarvis' 는 SQL 이 강제
}

function target(): { t: RestTarget; token: string } | null {
  const e = env();
  if (!e.SNOWBALL_SUPABASE_URL || !e.SNOWBALL_ANON_KEY || !e.SNOWBALL_JARVIS_TOKEN) return null;
  return { t: { url: e.SNOWBALL_SUPABASE_URL, key: e.SNOWBALL_ANON_KEY }, token: e.SNOWBALL_JARVIS_TOKEN };
}

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<Result<T>> {
  const c = target();
  if (!c) return fail("SNOWBALL_SUPABASE_URL/ANON_KEY/JARVIS_TOKEN 미설정");
  return rpc<T>(c.t, fn, { p_token: c.token, ...args });
}

async function callArray<T>(fn: string, args: Record<string, unknown> = {}): Promise<Result<T[]>> {
  const r = await call<T[] | null>(fn, args);
  if (!r.ok) return r;
  return ok(Array.isArray(r.data) ? r.data : [], r.status);
}

export const exportPositions = () => callArray<JarvisPosition>("jarvis_export_positions");
export const exportWatchlist = () => call<{ watch_assets: unknown[]; ideas: unknown[] }>("jarvis_export_watchlist");
export const exportTriggers = (horizonDays = 180) => callArray<JarvisTrigger>("jarvis_export_triggers", { p_horizon_days: horizonDays });
export const exportMacro = () => call<JarvisMacro>("jarvis_export_macro");
export const exportRiskAlerts = (since: string) => callArray<Record<string, unknown>>("jarvis_export_risk_alerts", { p_since: since });
export const exportPerformance = (from: string, to: string) =>
  call<{ net_worth: unknown[]; benchmarks: unknown[] }>("jarvis_export_performance", { p_from: from, p_to: to });
/** 🟢·🎯·🔭 후보를 draft 로 제출 (하루 최대 3, rules.yaml queues.snowball_submit). P2 에서 사용. */
export const submitIdea = (input: JarvisSubmitIdeaInput) => call<string>("jarvis_submit_idea", { p_payload: input });

/** 읽기 RPC 6개 실측 — 건수·키 이름만 남긴다(금액·수량 미보관). */
export const snowball: SourceAdapter = {
  name: "snowball",
  configured: () => target() !== null,
  probe: async () => {
    const since = new Date(Date.now() - 7 * 86400_000).toISOString();
    const today = new Date().toISOString().slice(0, 10);
    const monthAgo = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    const checks: [string, () => Promise<Result<unknown>>][] = [
      ["jarvis_export_positions", exportPositions],
      ["jarvis_export_watchlist", exportWatchlist],
      ["jarvis_export_triggers", () => exportTriggers(180)],
      ["jarvis_export_macro", exportMacro],
      ["jarvis_export_risk_alerts", () => exportRiskAlerts(since)],
      ["jarvis_export_performance", () => exportPerformance(monthAgo, today)],
    ];
    const out: ProbeRow[] = [];
    for (const [fn, run] of checks) {
      const r = await run();
      if (!r.ok) { out.push({ source: "snowball", table: fn, status: r.status ?? null, readable: false, rows: 0, columns: [], note: r.reason }); continue; }
      const d = r.data;
      const rows = Array.isArray(d) ? d.length : d && typeof d === "object" ? Object.keys(d).length : 0;
      const first = Array.isArray(d) ? d[0] : d;
      out.push({ source: "snowball", table: fn, status: 200, readable: true, rows,
        columns: first && typeof first === "object" ? Object.keys(first as object) : [] });
    }
    return out;
  },
};
