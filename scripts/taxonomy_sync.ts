/**
 * taxonomy_sync (PRD §4.1.2, 일 03:00 + 수동)
 *  ① taxonomy.yaml L1 → jarvis.taxonomy_l1
 *  ② 5개 프로젝트의 현재 산업 라벨을 수집해 match → jarvis.taxonomy_labels, 미매칭·처음 보는 부분일치 → taxonomy_pending
 *  ③ 노션 `2_1` 하위 카테고리와 yaml 비교 → bot_state 'taxonomy_notion_diff' (/taxonomy 변경 카드). 자동 반영하지 않는다.
 */
import { taxonomyConfig } from "@/lib/config/load";
import { dbInsert, dbUpsertBatched } from "@/lib/db";
import { env } from "@/lib/env";
import { read as heimdallr } from "@/lib/ingest/heimdallr";
import { read as hermes } from "@/lib/ingest/hermescall";
import { read as sage } from "@/lib/ingest/sage";
import { exportPositions, exportWatchlist } from "@/lib/ingest/snowball";
import { recordSource, runJob, slotOf } from "@/lib/jobs";
import { classify } from "@/lib/taxonomy/match";
import { diffIsEmpty, diffNotionL1, type NotionChild } from "@/lib/taxonomy/notion";
import { confirmedOverrides, snapshotLabels } from "@/lib/taxonomy-store";

const TWO_ONE_PAGE = "36a9c770aa61809c95e5c1117f9779b5";   // taxonomy.yaml source.notion_parent

async function notionChildren(pageId: string, key: string): Promise<NotionChild[] | string> {
  const out: NotionChild[] = [];
  let cursor: string | undefined;
  do {
    const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`, {
      headers: { Authorization: `Bearer ${key}`, "Notion-Version": "2022-06-28" },
    });
    if (res.status !== 200) return `HTTP ${res.status}`;
    const j = (await res.json()) as { results: { id: string; type: string; child_database?: { title: string }; child_page?: { title: string } }[]; has_more: boolean; next_cursor: string | null };
    for (const b of j.results) {
      if (b.type === "child_database") out.push({ id: b.id, title: b.child_database?.title ?? "", type: "child_database" });
      if (b.type === "child_page") out.push({ id: b.id, title: b.child_page?.title ?? "", type: "child_page" });
    }
    cursor = j.has_more && j.next_cursor ? j.next_cursor : undefined;
  } while (cursor);
  return out;
}

export async function taxonomySyncJob(args: Record<string, string>): Promise<void> {
  await runJob("taxonomy_sync", slotOf(args), async () => {
    const tx = taxonomyConfig();
    const now = new Date().toISOString();

    // ① L1 정본
    const l1Rows = tx.l1.map((r) => ({ code: r.code, name: r.name, l2: r.l2, synonyms: r.synonyms, notion_url: tx.notion.l1_urls[r.code] ?? null, synced_at: now }));
    const w1 = await dbUpsertBatched("taxonomy_l1", l1Rows, "code");
    if (!w1.ok) throw new Error(w1.reason);

    // ② 프로젝트 라벨 수집 (프로젝트 키 = 참조 스냅샷 키)
    const [watch, mentions, krx, pos, wl] = await Promise.all([
      hermes<{ industries: string[] | null; active: boolean | null }>("watchlist", { select: "industries,active" }),
      sage<{ value: string }>("mentions", { select: "value", filters: { mention_type: "eq.sector" } }),
      heimdallr<{ sector: string | null }>("krx_universe", { select: "sector" }),
      exportPositions(),
      exportWatchlist(),
    ]);
    const labels: Record<string, Set<string>> = {
      hermescall: new Set((watch.ok ? watch.data : []).filter((r) => r.active !== false).flatMap((r) => r.industries ?? [])),
      sage: new Set((mentions.ok ? mentions.data : []).map((r) => r.value)),
      heimdallr_sector: new Set((krx.ok ? krx.data : []).map((r) => r.sector ?? "").filter(Boolean)),
      snowball: new Set([
        ...(pos.ok ? pos.data.map((p) => p.sector ?? "") : []),
        ...(wl.ok ? ((wl.data as { watch_assets?: { sector?: string | null }[] }).watch_assets ?? []).map((a) => a.sector ?? "") : []),
      ].filter(Boolean)),
      flywheel: new Set(Object.keys(tx.notion.flywheel_monitoring.db_ids)),
    };
    const sourceErr = { hermescall: watch, sage: mentions, heimdallr: krx, snowball: pos };
    for (const [s, r] of Object.entries(sourceErr)) await recordSource(s, r.ok, r.ok ? undefined : r.reason);

    const extra = await confirmedOverrides();
    const labelRows: Record<string, unknown>[] = [];
    const pendingRows: Record<string, unknown>[] = [];
    const summary: Record<string, { labels: number; pending: number; methods: Record<string, number> }> = {};
    for (const [project, set] of Object.entries(labels)) {
      const known = snapshotLabels(project);
      const s = (summary[project] = { labels: set.size, pending: 0, methods: {} as Record<string, number> });
      for (const label of set) {
        const c = classify(label, project, tx, known, extra);
        s.methods[c.method] = (s.methods[c.method] ?? 0) + 1;
        labelRows.push({ project, label, l1_codes: c.l1_codes, primary_l1: c.primary_l1, method: c.method, updated_at: now });
        if (c.pending) { s.pending++; pendingRows.push({ project, label, suggested_l1: c.l1_codes, method: c.method }); }
      }
    }
    const w2 = await dbUpsertBatched("taxonomy_labels", labelRows, "project,label");
    if (!w2.ok) throw new Error(w2.reason);
    const w3 = await dbInsert("taxonomy_pending", pendingRows, { ignoreDuplicates: true, upsertOn: "project,label" });
    if (!w3.ok) throw new Error(w3.reason);

    // ③ 노션 2_1 변경 감지
    let notion: Record<string, unknown> = { skipped: "NOTION_API_KEY 미설정" };
    const key = env().NOTION_API_KEY;
    if (key) {
      const kids = await notionChildren(TWO_ONE_PAGE, key);
      await recordSource("notion", typeof kids !== "string", typeof kids === "string" ? kids : undefined);
      if (typeof kids === "string") notion = { error: kids };
      else {
        const diff = diffNotionL1(kids, tx.l1, tx.notion.l1_urls);
        notion = { children: kids.length, changed: !diffIsEmpty(diff), ...diff };
        await dbInsert("bot_state", [{ key: "taxonomy_notion_diff", value: { ...notion, checked_at: now }, updated_at: now }], { upsertOn: "key" });
      }
    }
    const detail = { l1: l1Rows.length, projects: summary, pending_new_or_existing: pendingRows.length, notion };
    console.log(JSON.stringify(detail, null, 1));
    return detail;
  });
}
