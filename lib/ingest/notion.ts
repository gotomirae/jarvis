/**
 * 노션 쓰기 어댑터 — 주간 투자위원회 페이지(2. 주식 자본 > 2_3 > JARVIS 주간 투자위원회 하위). 예외 없이 Result 반환(불변 규칙 6).
 * 부모 ID 는 페이지 주소 전체여도 된다(마지막 32자리 16진수를 쓴다 — 10/3 실측: 환경변수에 주소가 들어 있었음).
 * 노션 API 는 한 번에 블록 100개까지 → 나머지는 children 추가로 이어 붙인다. 초당 3회 제한(T9)을 지키려 요청 사이 350ms.
 */
import { env } from "@/lib/env";
import { fail, ok, safeReason, type Result } from "./types";

export function notionId(v: string | null | undefined): string | null {
  if (!v) return null;
  const hex = v.replace(/-/g, "").match(/[0-9a-f]{32}(?=[^0-9a-f]*$)/i) ?? v.replace(/-/g, "").match(/[0-9a-f]{32}/i);
  return hex ? hex[0].toLowerCase() : null;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function createNotionPage(parentRaw: string | undefined, title: string, blocks: Record<string, unknown>[], f: typeof fetch = fetch): Promise<Result<string>> {
  const key = env().NOTION_API_KEY, parent = notionId(parentRaw);
  if (!key || !parent) return fail("NOTION_API_KEY / NOTION_WEEKLY_PARENT_PAGE_ID 미설정");
  const headers = { Authorization: `Bearer ${key}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" };
  try {
    const res = await f("https://api.notion.com/v1/pages", { method: "POST", headers, body: JSON.stringify({ parent: { page_id: parent }, properties: { title: { title: [{ type: "text", text: { content: title } }] } }, children: blocks.slice(0, 100) }) });
    if (res.status !== 200) return fail(`notion 페이지 생성 HTTP ${res.status} ${safeReason(await res.text())}`, res.status);
    const page = (await res.json()) as { id: string; url: string };
    for (let i = 100; i < blocks.length; i += 100) {
      await wait(350);
      const r = await f(`https://api.notion.com/v1/blocks/${page.id}/children`, { method: "PATCH", headers, body: JSON.stringify({ children: blocks.slice(i, i + 100) }) });
      if (r.status !== 200) return fail(`notion 블록 추가 HTTP ${r.status} (페이지는 생성됨: ${page.url})`, r.status);
    }
    return ok(page.url, 200);
  } catch (e) {
    return fail(`notion: ${safeReason(e)}`);
  }
}
