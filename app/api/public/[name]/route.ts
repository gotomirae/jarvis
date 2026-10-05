/**
 * JARVIS 공개 JSON API (PRD §5.7) — 헤더 X-Jarvis-Token = JARVIS_PUBLIC_TOKEN. 민감정보(금액·수량·원가·정확한 비중) 없음.
 *   GET /api/public/taxonomy        노션 산업 18 · L2 · 동의어 · 지정 매핑(yaml + 대시보드 확정분) · 노션 URL
 *   GET /api/public/holdings-lite   보유 종목(금액 없는 비중 구간) — FlyWheel position_impact 용
 *   GET /api/public/industry-heat   산업별 이야기·촉매 점수 + 고성장(M3) 여부와 근거 3종 — Heimdallr·HermesCall 용
 *   GET /api/public/catalyst-watch  캐치업 후보(태그 CU) — Heimdallr 용 (HermesCall catalyst_watch 연계 후)
 *   GET /api/public/stock-context?entity=KR:005930  종목 맥락(SnowBall 훼손조건·확신도·최근 결정 · 진입 판정 · 추천 이력) — Claude kairos-deck 용 (D61)
 */
import { NextResponse, type NextRequest } from "next/server";
import { taxonomyConfig } from "@/lib/config/load";
import { dbSelect, dbSelectAll } from "@/lib/db";
import { env } from "@/lib/env";
import { read as hermes } from "@/lib/ingest/hermescall";
import { latestHoldings } from "@/lib/jobs/context";
import { holdingsLite, industryHeat, stockContext, tokenOk, type HeatRow, type StockContextInput } from "@/lib/public-api";
import { confirmedOverrides } from "@/lib/taxonomy-store";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const l1Name = (c: string) => taxonomyConfig().l1.find((r) => r.code === c)?.name ?? c;

const HANDLERS: Record<string, (q: URLSearchParams) => Promise<unknown>> = {
  taxonomy: async () => {
    const tx = taxonomyConfig();
    return {
      version: (tx as unknown as { version?: number }).version ?? 1,
      l1: tx.l1.map((r) => ({ code: r.code, name: r.name, l2: r.l2, synonyms: r.synonyms, notion_url: tx.notion.l1_urls[r.code] ?? null })),
      special_labels: tx.special_labels,
      overrides: [...(await confirmedOverrides()), ...(tx.overrides ?? [])],
      l2_page_ids: tx.notion.l2_page_ids,
      unmatched_default: tx.unmatched_default ?? "ETC",
    };
  },
  "holdings-lite": async () => {
    const h = await latestHoldings();
    const ids = h.positions.map((p) => p.entity_id).filter((x): x is string => !!x);
    const e = ids.length ? await dbSelect<{ id: string; l1_codes: string[] }>("entities", `select=id,l1_codes&id=in.(${ids.map((i) => `"${i}"`).join(",")})`) : { ok: true as const, data: [] };
    const l1 = new Map((e.ok ? e.data : []).map((x) => [x.id, x.l1_codes]));
    return { snapshot_at: h.snapshot_at, holdings: holdingsLite(h.positions, (id) => (id ? l1.get(id) ?? [] : []), l1Name) };
  },
  "industry-heat": async () => {
    const last = await dbSelect<{ date: string }>("industry_heat", "select=date&order=date.desc&limit=1");
    const date = last.ok && last.data[0] ? last.data[0].date : null;
    if (!date) return { date: null, industries: [] };
    const rows = await dbSelectAll<HeatRow>("industry_heat", `select=l1,n_score,c_score,sentiment,m3_pass,m3_median_rev_yoy_q0,m3_median_rev_yoy_q1,m3_members,m3_basis&date=eq.${date}`);
    return industryHeat(date, rows.ok ? rows.data : [], l1Name);
  },
  "stock-context": async (q) => {
    const raw = (q.get("entity") ?? "").trim().toUpperCase();
    if (!/^(KR|US):[A-Z0-9.\-]{1,12}$/.test(raw)) return { error: "entity=KR:005930 형식 필요" };
    const e = await dbSelect<{ id: string; name: string; symbol: string; market: string; l1_codes: string[] | null }>("entities", `select=id,name,symbol,market,l1_codes&id=eq.${encodeURIComponent(raw)}`);
    const ent = e.ok ? e.data[0] : undefined;
    if (!ent) return { error: "JARVIS 종목 마스터에 없음", entity: raw };
    const h = await latestHoldings();
    const pos = (h.positions.find((p) => p.entity_id === ent.id) ?? null) as StockContextInput["holding"];
    const ev = await dbSelect<NonNullable<StockContextInput["entry"]>>("entry_eval", `select=date,level,m1,m2,m3,m4,m5,tag,invalidation_price&entity_id=eq.${encodeURIComponent(ent.id)}&order=date.desc&limit=1`);
    const briefs = await dbSelectAll<{ sent_at: string; payload: { picks?: { id: string }[] } }>("notifications", "select=sent_at,payload&kind=in.(brief_morning,brief_evening)&sent_at=not.is.null&order=sent_at.asc");
    const picks = (briefs.ok ? briefs.data : []).filter((b) => b.payload?.picks?.some((p) => p.id === ent.id)).map((b) => b.sent_at);
    return stockContext({ entity: { id: ent.id, name: ent.name, symbol: ent.symbol, market: ent.market, l1_names: (ent.l1_codes ?? []).map(l1Name) },
      holding: pos, entry: ev.ok ? ev.data[0] ?? null : null, picks });
  },
  "catalyst-watch": async () => {
    const r = await hermes<Record<string, unknown>>("catalyst_watch", { select: "*", filters: { expires_at: `gte.${new Date().toISOString()}` } });
    return r.ok ? { tag: "CU", items: r.data } : { tag: "CU", items: [], note: "HermesCall catalyst_watch 테이블 연계(INTEGRATION_TASKS §C-5) 이후 제공" };
  },
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  if (!tokenOk(req.headers.get("x-jarvis-token"), env().JARVIS_PUBLIC_TOKEN)) return json({ ok: false }, 401);
  const { name } = await params;
  const h = HANDLERS[name];
  if (!h) return json({ ok: false, error: "unknown endpoint", endpoints: Object.keys(HANDLERS) }, 404);
  try {
    return json({ ok: true, ...(await h(req.nextUrl.searchParams) as object) });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message.slice(0, 200) : String(e) }, 500);
  }
}
