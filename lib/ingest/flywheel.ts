/**
 * Compounding FlyWheel 어댑터 (PRD §5.5) — 노션 API 읽기.
 * 연계종합 행 형식은 P0 에서 실측해 config/taxonomy.yaml > notion.flywheel_monitoring 에 고정했다:
 *   · '날짜' 텍스트 = "YYYY-MM-DD\n연계종합"  (구분 select 는 비어 있음)
 *   · '신호강도' select = "1"~"5" (연계종합 행에만)
 * 인박스 쓰기(Idea_Generating)는 P2 에서 추가한다.
 */
import { env } from "@/lib/env";
import { taxonomyConfig } from "@/lib/config/load";
import { fail, ok, safeReason, type ProbeRow, type Result, type SourceAdapter } from "./types";

const NOTION_VERSION = "2022-06-28";

export type LinkedSynthesis = {
  l2: string;
  page_id: string;
  date: string;              // YYYY-MM-DD (날짜 텍스트 첫 줄)
  strength: number | null;   // 1~5, 값이 없거나 형식 밖이면 null
  created_time: string;
  url: string;
};

type NotionPage = {
  id: string;
  url?: string;
  created_time: string;
  properties: Record<string, { type: string; select?: { name?: string } | null; rich_text?: { plain_text?: string }[] }>;
};

/** 순수 함수: 노션 페이지 → 연계종합 레코드. 연계종합이 아니면 null. */
export function parseLinkedRow(
  l2: string,
  page: NotionPage,
  cfg = { date_property: "날짜", strength_property: "신호강도", linked_marker: "연계종합" },
): LinkedSynthesis | null {
  const dateText = (page.properties[cfg.date_property]?.rich_text ?? []).map((t) => t.plain_text ?? "").join("");
  const [first, ...rest] = dateText.split(/\r?\n/);
  if (!rest.some((l) => l.trim() === cfg.linked_marker)) return null;
  const raw = page.properties[cfg.strength_property]?.select?.name;
  const n = raw !== undefined && /^[1-5]$/.test(raw) ? Number(raw) : null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(first.trim()) ? first.trim() : page.created_time.slice(0, 10);
  return { l2, page_id: page.id, date, strength: n, created_time: page.created_time, url: page.url ?? `https://www.notion.so/${page.id.replace(/-/g, "")}` };
}

async function queryLatestLinked(key: string, dbId: string, l2: string): Promise<Result<LinkedSynthesis | null>> {
  const cfg = taxonomyConfig().notion.flywheel_monitoring;
  try {
    const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" },
      body: JSON.stringify({
        filter: { property: cfg.date_property, rich_text: { contains: cfg.linked_marker } },
        sorts: [{ timestamp: "created_time", direction: "descending" }],
        page_size: 1,
      }),
    });
    if (res.status !== 200) return fail(`${l2}: HTTP ${res.status}`, res.status);
    const j = (await res.json()) as { results: NotionPage[] };
    return ok(j.results[0] ? parseLinkedRow(l2, j.results[0], cfg) : null, 200);
  } catch (e) {
    return fail(`${l2}: ${safeReason(e)}`);
  }
}

/** L2 별 최신 연계종합 (노션 초당 3회 제한 → 350ms 간격) */
export async function latestLinkedSyntheses(): Promise<Result<LinkedSynthesis[]>> {
  const key = env().NOTION_API_KEY;
  if (!key) return fail("NOTION_API_KEY 미설정");
  const out: LinkedSynthesis[] = [];
  const errors: string[] = [];
  for (const [l2, dbId] of Object.entries(taxonomyConfig().notion.flywheel_monitoring.db_ids)) {
    const r = await queryLatestLinked(key, dbId, l2);
    if (r.ok) { if (r.data) out.push(r.data); } else errors.push(r.reason);
    await new Promise((s) => setTimeout(s, 350));
  }
  if (out.length === 0 && errors.length) return fail(errors.join("; "));
  return ok(out);
}

/** Invest_WiKi 행의 '수혜 기업' 텍스트 → 기업명 목록 (쉼표·가운뎃점·줄바꿈·"및" 구분, 괄호 설명 제거) */
export function splitCompanies(text: string): string[] {
  return text.split(/[,，、·\n\/;]| 및 /).map((s) => s.replace(/\(.*?\)|（.*?）/g, "").trim()).filter((s) => s.length >= 2 && s.length <= 30);
}

/** Invest_WiKi 최근 N일 행 (PRD §5.5 "Invest_WiKi 14일 수혜 기업") */
export async function wikiSince(days: number): Promise<Result<{ page_id: string; created_time: string; companies: string[]; url: string }[]>> {
  const key = env().NOTION_API_KEY;
  const dbId = (taxonomyConfig().notion as unknown as { flywheel_wiki_db_id?: string }).flywheel_wiki_db_id;
  if (!key || !dbId) return fail("NOTION_API_KEY 또는 flywheel_wiki_db_id 미설정");
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const out: { page_id: string; created_time: string; companies: string[]; url: string }[] = [];
  let cursor: string | undefined;
  try {
    do {
      const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" },
        body: JSON.stringify({ filter: { timestamp: "created_time", created_time: { on_or_after: since } }, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
      });
      if (res.status !== 200) return fail(`Invest_WiKi: HTTP ${res.status}${res.status === 404 ? " (JARVIS 통합이 이 DB 에 연결되지 않음)" : ""}`, res.status);
      const j = (await res.json()) as { results: NotionPage[]; has_more: boolean; next_cursor: string | null };
      for (const p of j.results) {
        const text = (p.properties["수혜 기업"]?.rich_text ?? []).map((t) => t.plain_text ?? "").join("");
        out.push({ page_id: p.id, created_time: p.created_time, companies: splitCompanies(text), url: p.url ?? `https://www.notion.so/${p.id.replace(/-/g, "")}` });
      }
      cursor = j.has_more && j.next_cursor ? j.next_cursor : undefined;
      await new Promise((s) => setTimeout(s, 350));
    } while (cursor);
    return ok(out);
  } catch (e) {
    return fail(`Invest_WiKi: ${safeReason(e)}`);
  }
}

export const flywheel: SourceAdapter = {
  name: "flywheel",
  configured: () => !!env().NOTION_API_KEY,
  probe: async () => {
    const r = await latestLinkedSyntheses();
    const row: ProbeRow = r.ok
      ? { source: "flywheel", table: "모니터링 DB 연계종합(L2 17개)", status: 200, readable: true, rows: r.data.length,
          columns: ["l2", "date", "strength", "created_time"], note: `신호강도 값 있음 ${r.data.filter((x) => x.strength !== null).length}/${r.data.length}` }
      : { source: "flywheel", table: "모니터링 DB 연계종합(L2 17개)", status: r.status ?? null, readable: false, rows: 0, columns: [], note: r.reason };
    return [row];
  },
};
