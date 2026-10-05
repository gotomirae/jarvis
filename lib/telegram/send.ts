/**
 * @Tonny_JARVIS_bot 발송 (PRD §9.1). TELEGRAM_BOT_TOKEN 만 쓴다(다른 봇 토큰 금지, 불변 규칙 8).
 * 1초 간격 · 429 retry_after 존중 · 4,096자 분할 · 실패해도 throw 하지 않는다.
 */
import { env } from "@/lib/env";
import type { KbButton } from "./analysis";
import { fail, ok, safeReason, type Result } from "@/lib/ingest/types";
import { splitMessage } from "./format";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function tgApi<T = unknown>(method: string, body: Record<string, unknown>): Promise<Result<T>> {
  const token = env().TELEGRAM_BOT_TOKEN;
  if (!token) return fail("TELEGRAM_BOT_TOKEN 미설정");
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const j = (await res.json()) as { ok: boolean; result?: T; description?: string; parameters?: { retry_after?: number } };
      if (j.ok) return ok(j.result as T, res.status);
      if (res.status === 429 && j.parameters?.retry_after) { await sleep((j.parameters.retry_after + 1) * 1000); continue; }
      return fail(`${method}: ${res.status} ${safeReason(j.description ?? "")}`, res.status);
    } catch (e) {
      if (attempt === 2) return fail(`${method}: ${safeReason(e)}`);
      await sleep(1000);
    }
  }
  return fail(`${method}: 재시도 초과`);
}

/** 링크 버튼(url)·콜백 버튼(callback_data) 혼합 인라인 키보드 */
export function inlineKeyboard(buttons: KbButton[][]) {
  return { inline_keyboard: buttons.map((row) => row.map((b) => ("callback_data" in b ? { text: b.text, callback_data: b.callback_data } : { text: b.text, url: b.url }))) };
}

export async function sendMessage(chatId: string | number, html: string, buttons?: KbButton[][], splitBefore?: RegExp): Promise<Result<number[]>> {
  const parts = splitMessage(html, 4096, splitBefore);
  const ids: number[] = [];
  for (let i = 0; i < parts.length; i++) {
    const last = i === parts.length - 1;
    const r = await tgApi<{ message_id: number }>("sendMessage", {
      chat_id: chatId, text: parts[i], parse_mode: "HTML", disable_web_page_preview: true,
      ...(last && buttons?.length ? { reply_markup: inlineKeyboard(buttons) } : {}),
    });
    if (!r.ok) return r;
    ids.push(r.data.message_id);
    if (!last) await sleep(1000);
  }
  return ok(ids);
}
