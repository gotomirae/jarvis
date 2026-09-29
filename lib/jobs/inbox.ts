/**
 * FlyWheel 인박스 (PRD §11): Idea_Generating 에 행을 추가하면 FlyWheel STEP2 가 코드 변경 없이 연계종합에 반영한다.
 *  · HermesCall 딥분석(수혜강도 ≥ 7 또는 F1~F4 ≥ 2) · Heimdallr ★ 분석 · Sage 멘토 2명+ 새 강세 합류 · Sage 주간 전략
 *  · 하루 5건 상한(FlyWheel 비용 보호) · 같은 source_ref 재투입 금지(inbox_log) · 노션 초당 3회
 *  · 관련산업 = L1 의 L2 이름(FlyWheel 허용 목록). L2 없는 L1(1l·2f·2g)은 비우고 본문 첫 줄에 L1 이름
 * P2 실측: HermesCall analyses.stage 는 전부 'preliminary' → deep_analysis 가 있는 분석을 "최종 딥분석"으로 본다(D35).
 */
import { taxonomyConfig } from "@/lib/config/load";
import { dbInsert, dbSelect, dbSelectAll } from "@/lib/db";
import { env } from "@/lib/env";
import { read as heimdallr } from "@/lib/ingest/heimdallr";
import { read as hermes } from "@/lib/ingest/hermescall";
import { read as sage } from "@/lib/ingest/sage";
import { usFilters, type QuarterlyMetricRow } from "@/lib/engine/normalize";
import { kstDate } from "@/lib/time";
import { labelToL1, loadEntities, rules } from "./context";

export type InboxItem = { source_ref: string; title: string; summary: string; l1: string[]; body: string[]; link: string | null };

const chunk = (s: string, n = 1900) => { const out: string[] = []; for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n)); return out; };
const rt = (s: string) => [{ type: "text", text: { content: s.slice(0, 2000) } }];

export function l2Of(l1: string[]): { l2: string[]; l1Only: string[] } {
  const tx = taxonomyConfig();
  const l2: string[] = [], l1Only: string[] = [];
  for (const c of l1) { const r = tx.l1.find((x) => x.code === c); if (!r) continue; if (r.l2.length) l2.push(...r.l2); else l1Only.push(r.name); }
  return { l2: [...new Set(l2)], l1Only };
}

async function createRow(item: InboxItem): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const key = env().NOTION_API_KEY, db = env().NOTION_IDEA_DB_ID;
  if (!key || !db) return { ok: false, reason: "NOTION_API_KEY / NOTION_IDEA_DB_ID 미설정" };
  const { l2, l1Only } = l2Of(item.l1);
  const lines = [...(l1Only.length ? [`산업(L1): ${l1Only.join(", ")}`] : []), ...item.body, ...(item.link ? [`원 프로젝트: ${item.link}`] : []), "※ JARVIS 인박스 자동 투입 · 매수 확정 신호 아님"];
  const children = lines.flatMap((l) => chunk(l)).slice(0, 90).map((c) => ({ object: "block", type: "paragraph", paragraph: { rich_text: rt(c) } }));
  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
    body: JSON.stringify({
      parent: { database_id: db },
      properties: { 제목: { title: rt(item.title) }, "핵심 내용": { rich_text: rt(item.summary) }, "관련 산업": { rich_text: rt(l2.join(", ")) }, 날짜: { rich_text: rt(kstDate()) } },
      children,
    }),
  });
  if (res.status !== 200) return { ok: false, reason: `HTTP ${res.status} ${(await res.text()).slice(0, 160)}` };
  return { ok: true, id: ((await res.json()) as { id: string }).id };
}

export async function collectInbox(now = new Date()): Promise<InboxItem[]> {
  const R = rules().inbox;
  const ents = await loadEntities();
  const hToL1 = await labelToL1("hermescall");
  const since = new Date(now.getTime() - 2 * 86400_000).toISOString();
  const items: InboxItem[] = [];

  // HermesCall 딥분석
  const [an, bene, qm, tr] = await Promise.all([
    hermes<{ id: number; transcript_id: number; created_at: string; deep_analysis: { source_summary?: string; key_price_driver?: string; industry_sentiment?: { rationale?: string; sentiment?: string }; beneficiary_industries?: { industry?: string }[] } | null }>(
      "analyses", { select: "id,transcript_id,created_at,deep_analysis", filters: { created_at: `gte.${since}` } }),
    hermes<{ analysis_id: number; beneficiary_symbol: string; beneficiary_market: string; strength: number | null }>("beneficiaries", { select: "analysis_id,beneficiary_symbol,beneficiary_market,strength" }),
    hermes<QuarterlyMetricRow>("quarterly_metrics", { select: "symbol,fiscal_year,fiscal_quarter,f1_surprise,f2_guidance_up,f3_acceleration,f4_opm_up" }),
    hermes<{ id: number; symbol: string; fiscal_year: number; fiscal_quarter: number }>("transcripts", { select: "id,symbol,fiscal_year,fiscal_quarter", order: "id.desc", limit: 300 }),
  ]);
  for (const a of an.ok ? an.data : []) {
    if (!a.deep_analysis) continue;
    const t = (tr.ok ? tr.data : []).find((x) => x.id === a.transcript_id);
    const bs = (bene.ok ? bene.data : []).filter((b) => b.analysis_id === a.id).sort((x, y) => (y.strength ?? 0) - (x.strength ?? 0));
    const q = t ? (qm.ok ? qm.data : []).find((x) => x.symbol === t.symbol && x.fiscal_year === t.fiscal_year && x.fiscal_quarter === t.fiscal_quarter) : undefined;
    const flags = q ? usFilters(q) : [];
    if ((bs[0]?.strength ?? 0) < R.hermescall.strength_min && flags.length < R.hermescall.or_filters_min) continue;
    const names = bs.slice(0, 4).map((b) => `${ents.byId.get(ents.resolveSymbol(b.beneficiary_symbol, b.beneficiary_market) ?? "")?.name ?? b.beneficiary_symbol} ${b.strength ?? "-"}`);
    const d = a.deep_analysis;
    items.push({
      source_ref: `hermescall:analysis:${a.id}`,
      title: `[HermesCall] ${t?.symbol ?? "?"} ${t ? `${t.fiscal_quarter}Q FY${String(t.fiscal_year).slice(2)}` : ""} — 수혜: ${names.join(", ")}`.slice(0, 200),
      summary: [d.key_price_driver, d.industry_sentiment?.rationale].filter(Boolean).join(" ").slice(0, 1900),
      l1: [...new Set((d.beneficiary_industries ?? []).flatMap((b) => hToL1(b.industry ?? "")))],
      body: [d.source_summary ?? "", `F1~F4: ${flags.join(",") || "-"}`, `수혜 상위: ${names.join(", ")}`].filter(Boolean),
      link: `https://hermes-call-psi.vercel.app/analysis/${a.id}`,
    });
  }

  // Heimdallr ★ 분석
  const [ha, grades] = await Promise.all([
    heimdallr<{ id: number; code: string; fiscal_year: number; fiscal_quarter: number; created_at: string; payload: { one_line_thesis?: string; why_now?: string; growth_engine?: string } | null }>(
      "analyses", { select: "id,code,fiscal_year,fiscal_quarter,created_at,payload", filters: { created_at: `gte.${since}` } }),
    heimdallr<{ code: string; fiscal_year: number; fiscal_quarter: number; grade: string | null; score_final: number | null; pri: number | null }>("screen_results", { select: "code,fiscal_year,fiscal_quarter,grade,score_final,pri", filters: { grade: "eq.★" } }),
  ]);
  for (const a of ha.ok ? ha.data : []) {
    const g = (grades.ok ? grades.data : []).find((x) => x.code === a.code && x.fiscal_year === a.fiscal_year && x.fiscal_quarter === a.fiscal_quarter);
    if (!g || !R.heimdallr.grades.includes(g.grade ?? "")) continue;
    const e = ents.byId.get(`KR:${a.code}`);
    items.push({
      source_ref: `heimdallr:analysis:${a.id}`,
      title: `[Heimdallr] ${e?.name ?? a.code} ${a.fiscal_year}Q${a.fiscal_quarter} — ★ ${g.score_final ?? "-"}/PRI ${g.pri !== null ? Math.round(g.pri) : "-"}`,
      summary: (a.payload?.one_line_thesis ?? "").slice(0, 1900), l1: e?.l1_codes ?? [],
      body: [a.payload?.why_now ?? "", a.payload?.growth_engine ?? ""].filter(Boolean), link: `https://heimdallr-call.vercel.app/stock/${a.code}`,
    });
  }

  // Sage 컨센서스 변화: 오늘 신호 vs 이전 신호의 강세 멘토 차이
  const day = now.toISOString().slice(0, 10);
  const cons = await dbSelectAll<{ dedupe_key: string; entity_id: string | null; l1_codes: string[]; evidence: { bullish?: string[] }; observed_at: string }>("signals",
    `select=dedupe_key,entity_id,l1_codes,evidence,observed_at&kind=eq.mentor_consensus&created_at=gte.${new Date(now.getTime() - 10 * 86400_000).toISOString()}`);
  const byT = new Map<string, { day: string; bull: string[] }[]>();
  for (const c of cons.ok ? cons.data : []) {
    const m = c.dedupe_key.match(/^sage:cons:(.+):(\d{4}-\d{2}-\d{2})$/);
    if (m) (byT.get(m[1]) ?? byT.set(m[1], []).get(m[1])!).push({ day: m[2], bull: c.evidence.bullish ?? [] });
  }
  for (const [t, xs] of byT) {
    xs.sort((a, b) => a.day.localeCompare(b.day));
    const cur = xs[xs.length - 1];
    if (cur.day !== day || xs.length < 2) continue;
    const prev = new Set(xs[xs.length - 2].bull);
    const fresh = cur.bull.filter((b) => !prev.has(b));
    if (fresh.length < R.sage.new_mentors_min) continue;
    const isL1 = t.startsWith("L1:");
    const label = isL1 ? taxonomyConfig().l1.find((r) => r.code === t.slice(3))?.name ?? t : ents.byId.get(t)?.name ?? t;
    items.push({ source_ref: `sage:consensus:${t}:${day}`, title: `[Sage] ${label} — 멘토 ${fresh.length}명 강세 합류`, summary: `새 강세 멘토: ${fresh.join(", ")} · 전체 강세 ${cur.bull.length}명`,
      l1: isL1 ? [t.slice(3)] : ents.byId.get(t)?.l1_codes ?? [], body: [], link: `https://sage-gotomiraes-projects.vercel.app/?q=${encodeURIComponent(label)}&date=30d` });
  }

  // Sage 주간 전략 (금 18:00 발행 후)
  const rep = await sage<{ id: number; report_type: string; period_end: string; report_md: string; created_at: string }>("strategy_reports", { select: "id,report_type,period_end,report_md,created_at", filters: { report_type: "eq.weekly", created_at: `gte.${new Date(now.getTime() - 7 * 86400_000).toISOString()}` } });
  for (const r of rep.ok ? rep.data : []) {
    const d = new Date(`${r.period_end}T00:00:00Z`);
    const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    const week = Math.ceil(((d.getTime() - jan4.getTime()) / 86400_000 + ((jan4.getUTCDay() + 6) % 7) + 1) / 7);
    items.push({ source_ref: `sage:weekly:${r.id}`, title: `[Sage 주간] ${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`, summary: r.report_md.slice(0, 1900), l1: [], body: chunk(r.report_md, 1900).slice(0, 40), link: "https://sage-gotomiraes-projects.vercel.app/" });
  }
  return items;
}

export async function runInbox(now = new Date(), opts: { dryRun?: boolean } = {}): Promise<Record<string, unknown>> {
  const max = rules().inbox.max_per_day;
  const today = await dbSelect<{ source_ref: string }>("inbox_log", `select=source_ref&created_at=gte.${kstDate(now)}T00:00:00%2B09:00`);
  let left = max - (today.ok ? today.data.length : max);
  const items = await collectInbox(now);
  const done: string[] = [], skipped: string[] = [], failed: string[] = [];
  for (const it of items) {
    const dup = await dbSelect("inbox_log", `select=source_ref&source_ref=eq.${encodeURIComponent(it.source_ref)}`);
    if (dup.ok && dup.data.length) { skipped.push(it.source_ref); continue; }
    if (left <= 0) { skipped.push(`${it.source_ref}(상한)`); continue; }
    if (opts.dryRun) { done.push(`(dry) ${it.title}`); left--; continue; }
    const r = await createRow(it);
    if (r.ok) { await dbInsert("inbox_log", [{ source_ref: it.source_ref, notion_page_id: r.id }]); done.push(it.title); left--; }
    else failed.push(`${it.source_ref}: ${r.reason}`);
    await new Promise((s) => setTimeout(s, 400));   // 노션 초당 3회
  }
  return { candidates: items.length, added: done, skipped: skipped.length, failed };
}
