/**
 * ☀️ 아침(07:30) · 🌙 저녁(19:20) 브리핑 (PRD §9.2, 부록 B.2). pg_cron → Vercel 라우트(정시), Actions 예비.
 * 같은 날 같은 종류는 한 번만(notifications dedupe `brief:<kind>:<date>`). 🟢🟡🔵 는 P3 전까지 0.
 */
import { linksConfig, taxonomyConfig } from "@/lib/config/load";
import { dbInsert, dbSelect, dbSelectAll } from "@/lib/db";
import { QUEUE_LABEL, type Queue } from "@/lib/engine/queues";
import { env } from "@/lib/env";
import { read as heimdallr } from "@/lib/ingest/heimdallr";
import { read as hermes } from "@/lib/ingest/hermescall";
import { charts } from "@/lib/ingest/market";
import { dashboardButtons, inlineLinks, rows, type LinkEntity } from "@/lib/links";
import { sendMessage } from "@/lib/telegram/send";
import { briefText, type BriefData, type BriefItem } from "@/lib/telegram/templates";
import { kstDate, kstString } from "@/lib/time";
import { loadEntities, rules } from "./context";
import { currentRegime } from "./pipeline";

const ICON: Record<Queue, string> = { holding_alert: "⚠️", take_profit: "💰", buy: "🎯", radar: "🔭", pullback_wait: "⏳" };
const ORDER: Queue[] = ["take_profit", "buy", "radar", "pullback_wait"];

export async function buildBrief(kind: "morning" | "evening", now = new Date()): Promise<BriefData> {
  const R = rules();
  const date = kstDate(now);
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
  const items: BriefItem[] = [];
  for (const q of ORDER) {
    for (const it of (qItems.ok ? qItems.data : []).filter((x) => x.queue === q)) {
      const e = ents.byId.get(it.entity_id);
      if (!e || e.market !== focus) continue;
      const r = it.reason as { p?: number | null; families?: string[]; days_to_earnings?: number; heat?: number };
      const p = r.p === null || r.p === undefined ? "-" : String(Math.round(r.p));
      const note = q === "buy" ? `${e.market === "KR" ? "PRI" : "P"} ${p} · ${r.families?.join("/") ?? ""}`
        : q === "radar" ? `실적 D-${r.days_to_earnings ?? "?"} · ${r.families?.join("/") ?? ""}`
        : q === "take_profit" ? `과열 ${r.heat ?? "-"} · P ${p}` : `P ${p} — 눌림 대기`;
      items.push({ icon: ICON[q], html: inlineLinks(e as unknown as LinkEntity, ctx), note: `${QUEUE_LABEL[q].slice(2).trim()} · ${note}` });
    }
  }

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
  const day = kind === "morning" ? date : kstDate(new Date(now.getTime() + 86400_000));
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
    earnings, items: items.slice(0, 15),
    holding: al.slice(0, 8).map((a) => `⚠️ ${a.payload?.name ?? a.entity_id ?? "-"}: ${a.payload?.summary ?? ""}`),
    schedule: { ...schedule, lines: schedule.lines.slice(0, 10) },
    asOf: kstString(now),
  };
}

export async function sendBrief(kind: "morning" | "evening", now = new Date(), opts: { force?: boolean } = {}): Promise<Record<string, unknown>> {
  const date = kstDate(now);
  const key = `brief:${kind}:${date}`;
  const done = await dbSelect<{ sent_at: string | null }>("notifications", `select=sent_at&dedupe_key=eq.${encodeURIComponent(key)}`);
  if (!opts.force && done.ok && done.data[0]?.sent_at) return { skipped: "이미 발송", key };
  const data = await buildBrief(kind, now);
  const chat = env().TELEGRAM_CHAT_ID;
  const buttons = rows(dashboardButtons(linksConfig().dashboards, env().JARVIS_URL), 3);
  const r = chat ? await sendMessage(chat, briefText(data), buttons) : { ok: false as const, reason: "TELEGRAM_CHAT_ID 미설정" };
  await dbInsert("notifications", [{ kind: `brief_${kind}`, dedupe_key: key, payload: { items: data.items.length, alerts: data.counts.alert, error: r.ok ? undefined : r.reason, scheduled_kst: kind === "morning" ? "07:30" : "19:20" },
    sent_at: r.ok ? new Date().toISOString() : null, telegram_msg_id: r.ok ? r.data[0] : null }], { upsertOn: "dedupe_key" });
  if (!r.ok) throw new Error(`브리핑 발송 실패: ${r.reason}`);
  return { sent: key, items: data.items.length, alerts: data.counts.alert, sent_at_kst: kstString(new Date()) };
}
