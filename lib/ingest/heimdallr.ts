/**
 * Heimdallr Call 어댑터 (PRD §5.2) — anon 읽기 전용.
 * P0: 골격 + 테이블 실측(probe). P2~P3 에서 screen_results·entry_checks 등 정규화 리더를 채운다.
 */
import { env } from "@/lib/env";
import { probeTable, selectAll, type RestTarget, type SelectOpts } from "./rest";
import { fail, type Result, type SourceAdapter } from "./types";

/** PRD §5.2 + INTEGRATION_TASKS §B-11 의 anon SELECT 확인 대상. entry_checks 는 연계 작업 B 이후 생긴다. */
export const HEIMDALLR_TABLES = [
  "screen_results", "price_snapshots", "quarterly_fundamentals", "consensus_snapshots", "notifications",
  "analyses", "outcome_tracking", "krx_universe", "index_snapshots", "entry_checks",
] as const;

function target(): RestTarget | null {
  const e = env();
  return e.HEIMDALLR_SUPABASE_URL && e.HEIMDALLR_ANON_KEY ? { url: e.HEIMDALLR_SUPABASE_URL, key: e.HEIMDALLR_ANON_KEY } : null;
}

export async function read<T = Record<string, unknown>>(table: (typeof HEIMDALLR_TABLES)[number], o?: SelectOpts): Promise<Result<T[]>> {
  const t = target();
  return t ? selectAll<T>(t, table, o) : fail("HEIMDALLR_SUPABASE_URL/ANON_KEY 미설정");
}

export const heimdallr: SourceAdapter = {
  name: "heimdallr",
  configured: () => target() !== null,
  probe: async () => {
    const t = target();
    if (!t) return HEIMDALLR_TABLES.map((table) => ({ source: "heimdallr", table, status: null, readable: false, rows: 0, columns: [], note: "키 미설정" }));
    const out = [];
    for (const table of HEIMDALLR_TABLES) out.push(await probeTable("heimdallr", t, table));
    return out;
  },
};
