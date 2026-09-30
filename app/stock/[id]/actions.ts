"use server";
/**
 * [SnowBall 아이디어로 보내기] — jarvis_submit_idea(draft)만. 논지·거래·매수는 SnowBall 에서(불변 규칙 1).
 */
import { redirect } from "next/navigation";
import { dbInsert, dbSelect } from "@/lib/db";
import { env } from "@/lib/env";
import { submitIdea } from "@/lib/ingest/snowball";
import { requireAllowedUser } from "@/lib/supabase/server";

export async function submitToSnowball(formData: FormData) {
  await requireAllowedUser();
  const id = String(formData.get("entity_id") ?? "");
  const e = await dbSelect<{ id: string; symbol: string; name: string }>("entities", `select=id,symbol,name&id=eq.${encodeURIComponent(id)}`);
  const ent = e.ok ? e.data[0] : undefined;
  const back = `/stock/${encodeURIComponent(id)}`;
  if (!ent) redirect(`${back}?submitted=${encodeURIComponent("종목 없음")}`);
  // 버튼 연타 방지: 같은 종목 수동 제출은 10분에 1번 (P2 운영: 같은 종목 5회 연속 제출 실측)
  const recent = await dbSelect("notifications", `select=id&kind=eq.snowball_submit&entity_id=eq.${encodeURIComponent(id)}&created_at=gte.${new Date(Date.now() - 10 * 60_000).toISOString()}&limit=1`);
  if (recent.ok && recent.data.length) redirect(`${back}?submitted=${encodeURIComponent("이미 보냈습니다(10분 안에 다시 보내지 않음)")}`);
  const base = env().JARVIS_URL?.replace(/\/$/, "");
  const r = await submitIdea({
    ticker: ent!.symbol,
    idea: {
      headline: `[JARVIS 수동 제출] ${ent!.name}`,
      why_now: "JARVIS 대시보드에서 수동 제출. 매수 확정 신호 아님 — 논지·훼손조건은 SnowBall 에서 작성.",
      evidence_urls: base ? [`${base}${back}`] : [], jarvis_url: base ? `${base}${back}` : null, jarvis_entry: null,
    },
  });
  await dbInsert("notifications", [{ kind: "snowball_submit", dedupe_key: `submit:manual:${id}:${Date.now()}`, entity_id: id, payload: r.ok ? { idea_id: r.data, manual: true } : { error: r.reason, manual: true }, sent_at: r.ok ? new Date().toISOString() : null }]);
  redirect(`${back}?submitted=${r.ok ? "ok" : encodeURIComponent(r.reason.slice(0, 120))}`);
}
