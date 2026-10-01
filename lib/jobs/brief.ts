/**
 * ☀️ 아침(07:30) · 🌙 저녁(19:20) 브리핑 (PRD §9.2, 부록 B.2). pg_cron → Vercel 라우트(정시), Actions 예비.
 * 같은 날 같은 종류는 한 번만(notifications dedupe `brief:<kind>:<date>`). 🟢🟡🔵 는 P3 전까지 0.
 */
import { linksConfig, taxonomyConfig } from "@/lib/config/load";
import { dbInsert, dbSelect, dbSelectAll } from "@/lib/db";
import { getState } from "./poll";
import type { AxesEvidence } from "@/lib/engine/explain";
import { featuresOf, perfLine, perfPrior, type PerfStat } from "@/lib/engine/feedback";
import { buyReasons, consensusOf, EMPTY_IDEA, ideaCard, rankBuy } from "@/lib/engine/idea";
import { FAMILY_NAME } from "@/lib/labels";
import { QUEUE_LABEL, type Queue } from "@/lib/engine/queues";
import { env } from "@/lib/env";
import { read as heimdallr } from "@/lib/ingest/heimdallr";
import { read as hermes } from "@/lib/ingest/hermescall";
import { charts } from "@/lib/ingest/market";
import { dashboardButtons, linkLine, rows, type LinkEntity } from "@/lib/links";
import { sendMessage } from "@/lib/telegram/send";
import { BRIEF_SPLIT, briefText, type BriefData } from "@/lib/telegram/templates";
import { briefDate, kstDate, kstString } from "@/lib/time";
import { loadEntities, rules } from "./context";
import { currentRegime } from "./pipeline";

const OTHERS: Queue[] = ["radar", "pullback_wait", "take_profit"];
const MAX_IDEAS = 5;

export async function buildBrief(kind: "morning" | "evening", now = new Date()): Promise<BriefData> {
  const R = rules();
  const date = briefDate(kind, now);
  const market = kind === "morning" ? R.market.morning : R.market.evening;
  const sectors = kind === "morning" ? R.market.us_sectors : [];
  const since24 = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const focus: "KR" | "US" = kind === "morning" ? "US" : "KR";

  const [ents, quotes, reg, qItems, alerts] = await Promise.all([
    loadEntities(),
    charts([...market, ...sectors].map((m) => m.sym)),
    currentRegime(),
    dbSelectAll<{ date: string; entity_id: string; queue: Queue; reason: Record<string, unknown> }>("queue_items", `select=date,entity_id,queue,reason&date=eq.${date}`),
    dbSelectAll<{ entity_id: string | null; payload: { name?: string; summary?: string }; sent_at: string | null }>("notifications", `select=entity_id,payload,sent_at&kind=eq.holding_alert&sent_at=gte.${since24}`),
  ]);
  const ctx = { links: linksConfig(), taxonomy: taxonomyConfig(), jarvisUrl: env().JARVIS_URL };
  const l1Name = new Map(taxonomyConfig().l1.map((r) => [r.code, r.name]));
  const all = qItems.ok ? qItems.data : [];
  const mine = all.filter((x) => ents.byId.get(x.entity_id)?.market === focus);
  const buys = all.filter((x) => x.queue === "buy" && ents.byId.has(x.entity_id));
  const ax = buys.length ? await dbSelectAll<{ entity_id: string; evidence: AxesEvidence }>("axes_daily", `select=entity_id,evidence&date=eq.${date}&entity_id=in.(${buys.map((i) => `"${i.entity_id}"`).join(",")})`) : { ok: true as const, data: [] };
  const evBy = new Map((ax.ok ? ax.data : []).map((a) => [a.entity_id, a.evidence]));

  // 🎯 추천: (과거 성과 표본 30건 이상이면 기대 초과수익 →) 신호 계열 수 → 주가 반영도(낮을수록) → 산업 실제 성장률 → 가까운 이벤트 순 최대 5개 (D49)
  //    추천 시장(아침 미국 · 저녁 국내)을 먼저 채우고, 모자라면 다른 시장으로 채운다 (아침 07:30 은 국내 장 시작 전이라 국내 추천도 유효)
  const stats = await latestPerfStats();
  const scored = buys.map((b) => {
    const ev = evBy.get(b.entity_id) ?? {};
    const e = ents.byId.get(b.entity_id)!;
    const p = (b.reason as { p?: number | null }).p ?? null;
    const prior = perfPrior(featuresOf({ families: ev.families, p, grade: ev.F?.grade, market: e.market, l1: e.primary_l1 }), stats, "buy", R.feedback);
    return { ...b, ev, families: ev.families?.length ?? 0, p, industryGrowth: ev.idea?.industry?.realized_median ?? null, nextEvent: ev.next_event ?? null, perf: prior.score, prior };
  });
  const bucketName = (d: string, b: string) => (d === "l1" ? l1Name.get(b) ?? b : d === "sources" ? FAMILY_NAME[b] ?? b : d === "families" ? `${b}개` : d === "market" ? (b === "KR" ? "국내" : "미국") : b);
  const first = rankBuy(scored.filter((b) => ents.byId.get(b.entity_id)!.market === focus), MAX_IDEAS);
  const ranked = [...first, ...rankBuy(scored.filter((b) => ents.byId.get(b.entity_id)!.market !== focus), MAX_IDEAS - first.length)];
  const ideas = ranked.map((b, i) => {
    const e = ents.byId.get(b.entity_id)!;
    const idea = b.ev.idea ?? EMPTY_IDEA;
    const reasons = buyReasons({ idea, p: b.p, consensus: consensusOf(b.ev), grade: b.ev.F?.grade ?? null, score: b.ev.F?.score ?? null });
    const industry = idea.industry?.name ?? (e.primary_l1 ? l1Name.get(e.primary_l1) ?? "" : "");
    return ideaCard(i + 1, { name: e.name, symbol: e.symbol, market: e.market, industry }, idea, reasons, b.ev.tech, linkLine(e as unknown as LinkEntity, ctx), perfLine(b.prior, R.feedback, bucketName));
  });
  const others = OTHERS.map((q) => ({ icon: QUEUE_LABEL[q].split(" ")[0], label: QUEUE_LABEL[q].replace(/^\S+\s/, ""), names: mine.filter((x) => x.queue === q).map((x) => ents.byId.get(x.entity_id)!.name) }));

  // 실적: 아침 = 밤사이 HermesCall 미국 발표, 저녁 = 오늘 Heimdallr ★○
  const earnings: BriefData["earnings"] = { title: kind === "morning" ? "밤사이 미국 실적 (HermesCall)" : "오늘 국내 실적 ★○ (Heimdallr)", lines: [] };
  if (kind === "morning") {
    const ev = await hermes<{ symbol: string; pr_detected_at: string | null }>("earnings_events", { select: "symbol,pr_detected_at", filters: { pr_detected_at: `gte.${since24}` } });
    for (const x of ev.ok ? ev.data : []) earnings.lines.push(`${ents.byId.get(`US:${x.symbol}`)?.name ?? x.symbol} (${x.symbol}) 발표`);
  } else {
    const nt = await heimdallr<{ code: string; kind: string; payload: { grade?: string; score?: number } | null; sent_at: string }>("notifications", { select: "code,kind,payload,sent_at", filters: { sent_at: `gte.${since24}`, kind: "in.(flash,upgrade)" } });
    for (const x of nt.ok ? nt.data : []) {
      const g = x.payload?.grade;
      if (g === "★" || g === "○") earnings.lines.push(`${g} ${ents.byId.get(`KR:${x.code}`)?.name ?? x.code} (${x.code}) 점수 ${x.payload?.score ?? "-"}`);
    }
  }

  // 일정: 아침 = 오늘, 저녁 = 내일 (보유·큐 종목 + 산업·매크로 이벤트)
  const day = kind === "morning" ? date : kstDate(new Date(new Date(`${date}T12:00:00+09:00`).getTime() + 86400_000));
  const watched = new Set([...(qItems.ok ? qItems.data.map((x) => x.entity_id) : []), ...[...ents.byId.values()].filter((e) => e.snowball_asset_id).map((e) => e.id)]);
  const cal = await dbSelect<{ entity_id: string | null; l1: string | null; scope: string; title: string; source: string }>("catalyst_events", `select=entity_id,l1,scope,title,source&date=eq.${day}`);
  const schedule = { title: kind === "morning" ? "오늘 일정" : "내일 일정", lines: [] as string[] };
  for (const c of cal.ok ? cal.data : []) {
    if (c.scope === "company" && !(c.entity_id && watched.has(c.entity_id))) continue;
    const who = c.entity_id ? ents.byId.get(c.entity_id)?.name ?? c.entity_id : c.l1 ? taxonomyConfig().l1.find((r) => r.code === c.l1)?.name ?? c.l1 : "매크로";
    schedule.lines.push(`${who}: ${c.title} (${c.source})`);
  }

  const al = alerts.ok ? alerts.data : [];
  return {
    kind, date,
    market: market.map((m) => ({ label: m.label, last: quotes[m.sym]?.last ?? null, change_pct: quotes[m.sym]?.change_pct ?? null, level: m.level })),
    sectors: sectors.map((s) => ({ label: s.label, change_pct: quotes[s.sym]?.change_pct ?? null })),
    regime: { risk_off: reg.risk_off, reasons: reg.reasons },
    counts: { green: 0, yellow: 0, blue: 0, alert: al.length },
    alertsPaused: (await getState<{ paused?: boolean }>("holding_alert_pause"))?.paused === true,
    earnings, focus, ideas, buyTotal: buys.length, others,
    holding: al.slice(0, 8).map((a) => `⚠️ ${a.payload?.name ?? a.entity_id ?? "-"}: ${a.payload?.summary ?? ""}`),
    schedule: { ...schedule, lines: schedule.lines.slice(0, 10) },
    asOf: kstString(now),
  };
}

/** 최신 성과 스냅샷(🎯 매수 검토, 기준 기간) — outcomes_update 가 매일 20:00 에 쓴다. 없으면 빈 배열(규칙 순위) */
async function latestPerfStats(): Promise<PerfStat[]> {
  const h = rules().feedback.primary_horizon;
  const last = await dbSelect<{ as_of: string }>("perf_stats", "select=as_of&order=as_of.desc&limit=1");
  const asOf = last.ok ? last.data[0]?.as_of : undefined;
  if (!asOf) return [];
  const r = await dbSelectAll<PerfStat>("perf_stats", `select=scope,dimension,bucket,horizon_days,n,median_excess,hit_rate&as_of=eq.${asOf}&scope=eq.buy&horizon_days=eq.${h}`);
  return r.ok ? r.data : [];
}

export async function sendBrief(kind: "morning" | "evening", now = new Date(), opts: { force?: boolean } = {}): Promise<Record<string, unknown>> {
  const date = briefDate(kind, now);
  const key = `brief:${kind}:${date}`;
  const done = await dbSelect<{ sent_at: string | null }>("notifications", `select=sent_at&dedupe_key=eq.${encodeURIComponent(key)}`);
  if (!opts.force && done.ok && done.data[0]?.sent_at) return { skipped: "이미 발송", key };
  const data = await buildBrief(kind, now);
  const chat = env().TELEGRAM_CHAT_ID;
  const buttons = rows(dashboardButtons(linksConfig().dashboards, env().JARVIS_URL), 3);
  const r = chat ? await sendMessage(chat, briefText(data), buttons, BRIEF_SPLIT) : { ok: false as const, reason: "TELEGRAM_CHAT_ID 미설정" };
  await dbInsert("notifications", [{ kind: `brief_${kind}`, dedupe_key: key, payload: { ideas: data.ideas.map((c) => c.code), buy_total: data.buyTotal, alerts: data.counts.alert, error: r.ok ? undefined : r.reason, scheduled_kst: kind === "morning" ? "07:30" : "19:20" },
    sent_at: r.ok ? new Date().toISOString() : null, telegram_msg_id: r.ok ? r.data[0] : null }], { upsertOn: "dedupe_key" });
  if (!r.ok) throw new Error(`브리핑 발송 실패: ${r.reason}`);
  return { sent: key, ideas: data.ideas.map((c) => c.code), alerts: data.counts.alert, sent_at_kst: kstString(new Date()) };
}
