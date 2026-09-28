/**
 * Sage 어댑터 (PRD §5.4) — anon(publishable) 읽기 전용. PC 에는 service 키만 있어 SAGE_READ_KEY 는 사용자가 넣는다.
 */
import { env } from "@/lib/env";
import { probeTable, selectAll, type RestTarget, type SelectOpts } from "./rest";
import { fail, type Result, type SourceAdapter } from "./types";

export const SAGE_TABLES = ["mentions", "mentor_scorecards", "strategy_reports", "mentors"] as const;

function target(): RestTarget | null {
  const e = env();
  return e.SAGE_SUPABASE_URL && e.SAGE_READ_KEY ? { url: e.SAGE_SUPABASE_URL, key: e.SAGE_READ_KEY } : null;
}

export async function read<T = Record<string, unknown>>(table: (typeof SAGE_TABLES)[number], o?: SelectOpts): Promise<Result<T[]>> {
  const t = target();
  return t ? selectAll<T>(t, table, o) : fail("SAGE_SUPABASE_URL/READ_KEY 미설정");
}

export const sage: SourceAdapter = {
  name: "sage",
  configured: () => target() !== null,
  probe: async () => {
    const t = target();
    if (!t) return SAGE_TABLES.map((table) => ({ source: "sage", table, status: null, readable: false, rows: 0, columns: [], note: "키 미설정 (SAGE_READ_KEY)" }));
    const out = [];
    for (const table of SAGE_TABLES) out.push(await probeTable("sage", t, table));
    return out;
  },
};
