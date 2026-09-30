/**
 * @Tonny_JARVIS_bot webhook (PRD §9.1, D9).
 * - X-Telegram-Bot-Api-Secret-Token 을 TELEGRAM_WEBHOOK_SECRET 과 비교(불일치 401).
 * - 허용 chat_id 1개 외 메시지는 무시(200 으로 응답해 재전송 루프 방지).
 */
import { NextResponse, type NextRequest } from "next/server";
import { linksConfig } from "@/lib/config/load";
import { env } from "@/lib/env";
import { dbInsert } from "@/lib/db";
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
