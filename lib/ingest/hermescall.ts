/**
 * HermesCall 어댑터 (PRD §5.3) — anon 읽기 전용.
 * P0: 골격 + 테이블 실측. entry_checks_us·catalyst_watch 는 연계 작업 C 이후 생긴다.
 */
import { env } from "@/lib/env";
import { probeTable, selectAll, type RestTarget, type SelectOpts } from "./rest";
import { fail, type Result, type SourceAdapter } from "./types";

export const HERMES_TABLES = [
  "analyses", "beneficiaries", "quarterly_metrics", "earnings_events", "technical_ideas", "watchlist",
  "entry_checks_us", "catalyst_watch",
] as const;

function target(): RestTarget | null {
  const e = env();
  return e.HERMES_SUPABASE_URL && e.HERMES_ANON_KEY ? { url: e.HERMES_SUPABASE_URL, key: e.HERMES_ANON_KEY } : null;
}

export async function read<T = Record<string, unknown>>(table: (typeof HERMES_TABLES)[number], o?: SelectOpts): Promise<Result<T[]>> {
  const t = target();
  return t ? selectAll<T>(t, table, o) : fail("HERMES_SUPABASE_URL/ANON_KEY 미설정");
}

export const hermescall: SourceAdapter = {
  name: "hermescall",
  configured: () => target() !== null,
  probe: async () => {
    const t = target();
    if (!t) return HERMES_TABLES.map((table) => ({ source: "hermescall", table, status: null, readable: false, rows: 0, columns: [], note: "키 미설정" }));
    const out = [];
    for (const table of HERMES_TABLES) out.push(await probeTable("hermescall", t, table));
    return out;
  },
};
