/**
 * @Tonny_JARVIS_bot webhook (PRD §9.1, D9).
 * - X-Telegram-Bot-Api-Secret-Token 을 TELEGRAM_WEBHOOK_SECRET 과 비교(불일치 401).
 * - 허용 chat_id 1개 외 메시지는 무시(200 으로 응답해 재전송 루프 방지).
 */
import { NextResponse, type NextRequest } from "next/server";
import { linksConfig } from "@/lib/config/load";
import { env } from "@/lib/env";
import { dbInsert, dbSelect } from "@/lib/db";
import { kstString } from "@/lib/time";
import { collectStatus } from "@/lib/status";
import { handleCommand } from "@/lib/telegram/commands";
import { safeEqual } from "@/lib/telegram/format";
import { sendMessage } from "@/lib/telegram/send";

export const dynamic = "force-dynamic";

type Update = { message?: { chat?: { id?: number }; text?: string } };

export async function POST(req: NextRequest) {
  const e = env();
  if (!e.TELEGRAM_WEBHOOK_SECRET || !safeEqual(req.headers.get("x-telegram-bot-api-secret-token"), e.TELEGRAM_WEBHOOK_SECRET)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  let update: Update;
  try { update = (await req.json()) as Update; } catch { return NextResponse.json({ ok: true }); }

  const chatId = update.message?.chat?.id;
  const text = update.message?.text;
  if (!chatId || !text || !e.TELEGRAM_CHAT_ID || String(chatId) !== e.TELEGRAM_CHAT_ID) return NextResponse.json({ ok: true });

  const reply = await handleCommand(text, {
    dashboards: linksConfig().dashboards, jarvisUrl: e.JARVIS_URL, status: collectStatus,
    setAlertPause: async (paused) => { await dbInsert("bot_state", [{ key: "holding_alert_pause", value: { paused, at: new Date().toISOString(), by: "telegram" }, updated_at: new Date().toISOString() }], { upsertOn: "key" }); },
    weekly: async () => {
      const r = await dbSelect<{ week: string; grounding_ok: boolean | null; created_at: string; notion_url: string | null }>("weekly_memos", "select=week,grounding_ok,created_at,notion_url&order=week.desc&limit=1");
      const w = r.ok ? r.data[0] : undefined;
      return w ? { week: w.week, grounded: !!w.grounding_ok, publishedKst: kstString(new Date(w.created_at)), notionUrl: w.notion_url } : null;
    },
    entry: async () => {
      const latest = async (m: string) => { const r = await dbSelect<{ date: string }>("entry_eval", `select=date&market=eq.${m}&order=date.desc&limit=1`); return r.ok ? r.data[0]?.date ?? null : null; };
      const [kr, us] = await Promise.all([latest("KR"), latest("US")]);
      const dates = [kr, us].filter(Boolean).join(",");
      const ev = dates ? await dbSelect<{ entity_id: string; level: string; market: string; date: string }>("entry_eval", `select=entity_id,level,market,date&date=in.(${dates})&level=in.(green,yellow)`) : { ok: true as const, data: [] };
      const rows = (ev.ok ? ev.data : []).filter((x) => (x.market === "KR" ? x.date === kr : x.date === us));
      const bw = await dbSelect<{ entity_id: string }>("breakout_watch", `select=entity_id&armed_until=gte.${new Date().toISOString().slice(0, 10)}`);
      const ids = [...new Set([...rows.map((x) => x.entity_id), ...(bw.ok ? bw.data.map((x) => x.entity_id) : [])])];
      const en = ids.length ? await dbSelect<{ id: string; name: string }>("entities", `select=id,name&id=in.(${ids.map((i) => `"${i}"`).join(",")})`) : { ok: true as const, data: [] };
      const nm = new Map((en.ok ? en.data : []).map((x) => [x.id, x.name]));
      const name = (id: string) => nm.get(id) ?? id;
      return { kr, us, green: rows.filter((x) => x.level === "green").map((x) => name(x.entity_id)), yellow: rows.filter((x) => x.level === "yellow").map((x) => name(x.entity_id)), blue: (bw.ok ? bw.data : []).map((x) => name(x.entity_id)) };
    },
  });
  if (reply) {
    const r = await sendMessage(chatId, reply.text, reply.buttons);
    if (!r.ok) console.error("telegram send 실패:", r.reason);
  }
  return NextResponse.json({ ok: true });
}

export function GET() {
  return NextResponse.json({ ok: true, service: "jarvis-telegram-webhook" });
}
