/**
 * 노션 `2_1. 산업 & 종목` 카테고리 변경 감지 (PRD §4.1.2) — 순수 함수. 자동 반영하지 않고 /taxonomy 카드로 보여준다.
 *
 * 기준은 **페이지·DB ID**(taxonomy.yaml notion.l1_urls)다. P1 실측(9/28): 노션 공개 API 의 child_database 제목은
 * 화면 제목("1f. 엔터", "2b. IT")이 아니라 데이터 소스 이름("1f. 엔터_미디어", "1j. IT")을 돌려준다 → 제목 비교는 오탐.
 * 그래서 추가·삭제는 ID 로 판정하고, 제목 차이는 참고(title_notes)로만 남긴다.
 */
export type NotionChild = { id: string; title: string; type: "child_database" | "child_page" };
export type L1Diff = {
  added: { id: string; title: string; code: string | null }[];   // yaml 에 없는 하위 항목 → L1 추가 검토
  removed: { code: string; name: string }[];                      // yaml L1 의 페이지가 2_1 아래에서 사라짐
  title_notes: { code: string; yaml: string; api_title: string }[];
};

export function parseCategoryTitle(title: string): { code: string; name: string } | null {
  const m = title.trim().match(/^([0-9][a-z])\.\s*(.+)$/i);
  return m ? { code: m[1].toLowerCase(), name: m[2].trim() } : null;
}

/** notion.so URL·대시 포함 ID → 32자리 소문자 */
export function notionId(urlOrId: string): string | null {
  const m = urlOrId.replace(/-/g, "").match(/([0-9a-f]{32})(?:[?#].*)?$/i);
  return m ? m[1].toLowerCase() : null;
}

export function diffNotionL1(children: NotionChild[], yamlL1: { code: string; name: string }[], l1Urls: Record<string, string>): L1Diff {
  const d: L1Diff = { added: [], removed: [], title_notes: [] };
  const byId = new Map<string, { code: string; name: string }>();
  for (const r of yamlL1) {
    const id = l1Urls[r.code] ? notionId(l1Urls[r.code]) : null;
    if (id) byId.set(id, r);
  }
  const seen = new Set<string>();
  for (const c of children) {
    const id = notionId(c.id);
    const y = id ? byId.get(id) : undefined;
    if (!id || !y) {
      if (c.title.trim()) d.added.push({ id: c.id, title: c.title.trim(), code: parseCategoryTitle(c.title)?.code ?? null });
      continue;
    }
    seen.add(id);
    const expectTitle = `${y.code}. ${y.name}`;
    if (c.title.trim() !== expectTitle) d.title_notes.push({ code: y.code, yaml: y.name, api_title: c.title.trim() });
  }
  for (const [id, y] of byId) if (!seen.has(id)) d.removed.push({ code: y.code, name: y.name });
  return d;
}

export function diffIsEmpty(d: L1Diff): boolean {
  return !d.added.length && !d.removed.length;
}
