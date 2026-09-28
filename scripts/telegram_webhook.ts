/**
 * webhook 등록·조회 (PRD §9.1). @Tonny_JARVIS_bot 인지 getMe 로 먼저 확인한다(다른 봇 토큰 금지, 불변 규칙 8).
 *   npm run job -- telegram_webhook --action info|set|delete
 */
import { need } from "@/lib/env";
import { tgApi } from "@/lib/telegram/send";

const EXPECTED_BOT = "Tonny_JARVIS_bot";

export async function telegramWebhookJob(args: Record<string, string>): Promise<void> {
  const me = await tgApi<{ username: string }>("getMe", {});
  if (!me.ok) throw new Error(`getMe 실패: ${me.reason}`);
  if (me.data.username !== EXPECTED_BOT) throw new Error(`봇 불일치: @${me.data.username} (필요: @${EXPECTED_BOT}) — 중단`);

  const action = args.action ?? "info";
  if (action === "set") {
    const url = `${need("JARVIS_URL").replace(/\/$/, "")}/api/telegram/webhook`;
    const r = await tgApi("setWebhook", { url, secret_token: need("TELEGRAM_WEBHOOK_SECRET"), allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
    console.log(r.ok ? `setWebhook OK → ${url}` : `setWebhook 실패: ${r.reason}`);
  } else if (action === "delete") {
    const r = await tgApi("deleteWebhook", {});
    console.log(r.ok ? "deleteWebhook OK" : `실패: ${r.reason}`);
  }
  const info = await tgApi<{ url: string; pending_update_count: number; last_error_message?: string; last_error_date?: number }>("getWebhookInfo", {});
  if (info.ok) console.log(JSON.stringify({ bot: `@${me.data.username}`, url: info.data.url || "(없음)", pending: info.data.pending_update_count, last_error: info.data.last_error_message ?? null }, null, 2));
}
