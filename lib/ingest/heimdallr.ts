/**
 * Heimdallr Call 어댑터 (PRD §5.2) — anon 읽기 전용.
 * P0: 골격 + 테이블 실측(probe). P2~P3 에서 screen_results·entry_checks 등 정규화 리더를 채운다.
 */
import { env } from "@/lib/env";
import { probeTable, rpc, selectAll, type RestTarget, type SelectOpts } from "./rest";
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

// ── 🔎 분석 요청 RPC (D59, INTEGRATION_TASKS G) ─────────────────────────────
// 산업·기업 심층 분석(Kairos)과 🎤 발표자료는 Heimdallr 가 만든다. JARVIS 는 토큰 RPC 로 요청·상태 조회만 한다(쓰기 = 요청 접수 1종).
// 반드시 POST(토큰이 URL 에 남지 않게). 키가 없거나 RPC 가 아직 없으면 {ok:false} — 호출부가 "연동 준비 전"으로 안내한다.

export type AnalysisKind = "company" | "industry";
export type AnalysisRequestInput = {
  kind: AnalysisKind;
  target_name: string;                 // 기업명 또는 산업명
  market: "KR" | "US" | null;          // 기업 요청만
  code: string | null;                 // 국내 6자리 · 미국 티커 (기업 요청만)
  industry: string | null;             // JARVIS 산업명(L1) — Heimdallr 가 Drive 산업 폴더와 짝 맞춤
  reuse_after: string;                 // 이 시각 이후 완료된 분석이 있으면 새로 돌리지 않고 그 링크를 돌려준다
};
export type AnalysisRequestResult = {
  status: "queued" | "in_progress" | "reused" | "rejected";
  request_id: number | null; notion_url: string | null; completed_at: string | null; reason?: string | null;
};
export type AnalysisStatus = {
  request_id: number; status: "pending" | "working" | "awaiting_input" | "rejected" | "failed" | "sending" | "sent" | "uncertain";
  stage: string | null; notion_url: string | null; error: string | null; completed_at: string | null;
  deck: { status: "pending" | "working" | "sent" | "failed"; notion_url: string | null; error: string | null } | null;
};

function rpcTarget(): { t: RestTarget; token: string } | null {
  const t = target();
  const token = env().HEIMDALLR_JARVIS_TOKEN;
  return t && token ? { t, token } : null;
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<Result<T>> {
  const c = rpcTarget();
  return c ? rpc<T>(c.t, fn, { p_token: c.token, ...args }) : fail("HEIMDALLR_JARVIS_TOKEN 미설정");
}

export const requestAnalysis = (input: AnalysisRequestInput) => call<AnalysisRequestResult>("jarvis_request_analysis", { p_payload: input });
export const analysisStatus = (ids: number[]) => call<AnalysisStatus[] | null>("jarvis_analysis_status", { p_request_ids: ids });
export const requestDeck = (requestId: number) => call<{ status: "queued" | "in_progress" | "sent" | "rejected"; notion_url: string | null; reason?: string | null }>("jarvis_request_deck", { p_request_id: requestId });
