/**
 * 🔧 시스템 이상 (PRD §9.2): 소스 2회 연속 실패(M3 ② 검색 소스 4종 전부 실패 포함) → 텔레그램. 같은 소스·같은 날 1번.
 */
import { dbInsert, dbSelect } from "@/lib/db";
import { env } from "@/lib/env";
import { sendMessage } from "@/lib/telegram/send";
import { systemText } from "@/lib/telegram/templates";
import { kstDate } from "@/lib/time";

export async function systemAlerts(now = new Date()): Promise<string[]> {
  const r = await dbSelect<{ source: string; consecutive_failures: number; last_error: string | null; last_ok_at: string | null }>("source_health", "select=source,consecutive_failures,last_error,last_ok_at&consecutive_failures=gte.2");
  if (!r.ok || !r.data.length) return [];
  const outlook = r.data.filter((x) => x.source.startsWith("outlook_"));
  const others = r.data.filter((x) => !x.source.startsWith("outlook_"));
  const lines = others.map((x) => `${x.source}: 연속 ${x.consecutive_failures}회 실패 — ${x.last_error ?? ""}`.slice(0, 200));
  if (outlook.length >= 4) lines.push("M3 ② 무료 검색 소스 4종 모두 2회 연속 실패 — 기존 채택값은 만료 전까지 유지");
  if (!lines.length) return [];
  const key = `system:sources:${kstDate(now)}:${r.data.map((x) => x.source).sort().join(",")}`;
  const dup = await dbSelect("notifications", `select=id&dedupe_key=eq.${encodeURIComponent(key)}`);
  if (dup.ok && dup.data.length) return [];
  const chat = env().TELEGRAM_CHAT_ID;
  const s = chat ? await sendMessage(chat, systemText("시스템 이상 — 소스 수집 실패", lines), []) : { ok: false as const, reason: "chat 없음" };
  await dbInsert("notifications", [{ kind: "system", dedupe_key: key, payload: { lines }, sent_at: s.ok ? now.toISOString() : null }], { ignoreDuplicates: true, upsertOn: "dedupe_key" });
  return lines;
}
