/**
 * 📌 6개 프로젝트 바로가기를 대화 맨 위에 고정한다 (D58). /pin 명령과 `npm run job -- pin_links` 가 같이 쓴다.
 * 멱등(불변 규칙 13): bot_state 'pinned_links' 의 기존 메시지를 고쳐 다시 고정하고, 그 메시지를 고칠 수 없을 때만 새로 보낸다.
 * 새로 보낼 때는 이전 고정을 해제해 바로가기 고정이 쌓이지 않게 한다. 실패해도 throw 하지 않는다.
 * 입력창 옆 메뉴 버튼(📌 바로가기 → JARVIS /go)도 함께 설정한다 — 고정 메시지가 위로 밀려도 항상 한 번에 열 수 있게.
 */
import { linksConfig } from "@/lib/config/load";
import { dbInsert, dbSelect } from "@/lib/db";
import { env } from "@/lib/env";
import { ok, type Result } from "@/lib/ingest/types";
import { renderPinnedLinks } from "./commands";
import { sendMessage, tgApi } from "./send";

type PinState = { chat_id: string; message_id: number };

type PinResult = { messageId: number; created: boolean; menu: string | null };   // menu: 메뉴 버튼 실패 사유(성공이면 null)

/** 입력창 옆 메뉴 버튼 → 텔레그램 안에서 JARVIS /go 를 연다. JARVIS_URL(https) 이 없으면 설정하지 않는다. */
async function setMenuButton(chatId: string | number): Promise<string | null> {
  const base = env().JARVIS_URL?.replace(/\/$/, "");
  if (!base?.startsWith("https://")) return "JARVIS_URL(https) 미설정 — 메뉴 버튼 생략";
  const r = await tgApi("setChatMenuButton", { chat_id: chatId, menu_button: { type: "web_app", text: "📌 바로가기", web_app: { url: `${base}/go` } } });
  return r.ok ? null : r.reason;
}

export async function pinLinks(chatId: string | number): Promise<Result<PinResult>> {
  const pinned = await pinMessage(chatId);
  if (!pinned.ok) return pinned;
  return ok({ ...pinned.data, menu: await setMenuButton(chatId) });
}

async function pinMessage(chatId: string | number): Promise<Result<Omit<PinResult, "menu">>> {
  const reply = renderPinnedLinks({ dashboards: linksConfig().dashboards, jarvisUrl: env().JARVIS_URL });
  const markup = { inline_keyboard: (reply.buttons ?? []).map((row) => row.map((b) => ({ text: b.text, url: b.url }))) };
  const pin = (messageId: number) => tgApi("pinChatMessage", { chat_id: chatId, message_id: messageId, disable_notification: true });

  const prev = await dbSelect<{ value: PinState }>("bot_state", "select=value&key=eq.pinned_links");
  const old = prev.ok ? prev.data[0]?.value : undefined;
  if (old && String(old.chat_id) === String(chatId)) {
    const ed = await tgApi("editMessageText", { chat_id: chatId, message_id: old.message_id, text: reply.text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: markup });
    if ((ed.ok || /not modified/i.test(ed.reason)) && (await pin(old.message_id)).ok) return ok({ messageId: old.message_id, created: false });
  }

  const sent = await sendMessage(chatId, reply.text, reply.buttons);
  if (!sent.ok) return sent;
  const messageId = sent.data[0];
  const p = await pin(messageId);
  if (!p.ok) return p;
  if (old && old.message_id !== messageId) await tgApi("unpinChatMessage", { chat_id: old.chat_id, message_id: old.message_id });   // 지워진 메시지면 실패 — 무시
  const at = new Date().toISOString();
  await dbInsert("bot_state", [{ key: "pinned_links", value: { chat_id: String(chatId), message_id: messageId, at }, updated_at: at }], { upsertOn: "key" });
  return ok({ messageId, created: true });
}
