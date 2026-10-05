/**
 * 🔎 산업·기업 심층 분석 버튼 처리 (D59·D60). 순수 부분은 lib/telegram/analysis.ts.
 * 단계: Codex 분석(노션) → 🧠 Claude 심층 분석(Heimdallr 가 자동 실행) → 🎤 발표자료(선택).
 *  - 브리핑 직후 추천 종목 버튼 메시지(sendAnalysisPrompt)
 *  - 버튼 콜백(handleAnalysisCallback): Heimdallr jarvis_request_analysis / jarvis_request_deck → 장부 jarvis.analysis_requests
 *  - poll(30분)의 완료 확인(pollAnalysis): Codex 완료 알림 → 🧠 완료 알림(기업 🎤 / 산업 선별 기업 🏢) → 🎤 완료 알림
 * JARVIS 는 분석을 만들지 않는다 — 요청·상태·노션 링크만 다룬다.
 */
import { dbInsert, dbSelect, dbUpdate } from "@/lib/db";
import { env } from "@/lib/env";
import { analysisStatus, requestAnalysis, requestDeck, type AnalysisKind, type AnalysisStatus, type ClaudeJob } from "@/lib/ingest/heimdallr";
import { acceptReply, analysisKeyboard, analysisPrompt, claudeReply, claudeState, deckAcceptReply, deckDoneReply, doneReply, parseCallback, reuseAfter, type AnalysisPick, type TopPick } from "@/lib/telegram/analysis";
import { sendMessage, tgApi } from "@/lib/telegram/send";
import { l1Name } from "./context";

type Row = {
  id: number; kind: AnalysisKind; entity_id: string | null; target_name: string; heimdallr_id: number | null; status: string;
  notion_url: string | null; deck_status: string | null; deck_notion_url: string | null; notified_at: string | null; deck_notified_at: string | null;
  claude_status: string | null; claude_notified_at: string | null; created_at: string;
};

/** Claude 선별 최고 기업 → JARVIS 종목 ID (종목 마스터에 있을 때만 🏢 버튼) */
async function resolvePick(p: ClaudeJob["top_pick"]): Promise<TopPick | null> {
  if (!p?.name) return null;
  const id = p.market && p.code ? `${p.market}:${p.code.toUpperCase()}` : null;
  return { name: p.name, entityId: id && (await entity(id)) ? id : null };
}

/** 브리핑 직후 버튼 메시지. Heimdallr 연동 토큰이 없으면(G절 미완료) 보내지 않는다 — 눌러도 동작하지 않는 버튼을 만들지 않는다 */
export async function sendAnalysisPrompt(chatId: string, picks: AnalysisPick[]) {
  if (!env().HEIMDALLR_JARVIS_TOKEN) return null;
  const kb = analysisKeyboard(picks);
  return kb.length ? sendMessage(chatId, analysisPrompt(), kb) : null;
}

async function lastEarnings(entityId: string, today: string): Promise<string | null> {
  const r = await dbSelect<{ date: string }>("catalyst_events", `select=date&origin=eq.earnings&entity_id=eq.${encodeURIComponent(entityId)}&date=lte.${today}&order=date.desc&limit=1`);
  return r.ok ? r.data[0]?.date ?? null : null;
}

async function entity(id: string) {
  const r = await dbSelect<{ id: string; name: string; symbol: string; market: "KR" | "US"; primary_l1: string | null }>("entities", `select=id,name,symbol,market,primary_l1&id=eq.${encodeURIComponent(id)}`);
  return r.ok ? r.data[0] ?? null : null;
}

/** 콜백 처리 — 웹훅이 부른다. 반환값 = answerCallbackQuery 짧은 안내 */
export async function handleAnalysisCallback(chatId: number, data: string | undefined, now = new Date()): Promise<string> {
  const c = parseCallback(data);
  if (!c) return "알 수 없는 버튼";
  if (c.type === "deck") return handleDeck(chatId, c.id);

  let target: string, entityId: string | null = null, market: "KR" | "US" | null = null, code: string | null = null, industry: string | null = null;
  if (c.kind === "company") {
    const e = await entity(c.key);
    if (!e) return "종목을 찾지 못했습니다";
    ({ name: target, id: entityId, market, symbol: code } = e);
    industry = e.primary_l1 ? l1Name(e.primary_l1) : null;
  } else {
    target = industry = c.key;
  }
  const today = now.toISOString().slice(0, 10);
  const after = reuseAfter(c.kind, now, entityId ? await lastEarnings(entityId, today) : null);
  const r = await requestAnalysis({ kind: c.kind, target_name: target, market, code, industry, reuse_after: after });

  let localId: number | null = null, pick: TopPick | null = null;
  if (r.ok && r.data.status !== "rejected") {
    const reused = r.data.status === "reused";
    const cs = reused ? claudeState(r.data.claude) : null;      // 재사용이면 그 분석의 🧠 상태도 이어받는다
    if (reused && r.data.claude?.status === "sent") pick = await resolvePick(r.data.claude.top_pick);
    const ins = await dbInsert<{ id: number }>("analysis_requests", [{
      kind: c.kind, entity_id: entityId, target_name: target, heimdallr_id: r.data.request_id, status: reused ? "reused" : "queued", notion_url: r.data.notion_url,
      notified_at: reused ? now.toISOString() : null,
      claude_status: cs?.claude_status ?? null, claude_notion_url: r.data.claude?.notion_url ?? null, top_pick: r.data.claude?.top_pick ?? null,
      claude_notified_at: cs?.done ? now.toISOString() : null,
    }], { returning: true });
    localId = ins.ok ? ins.data[0]?.id ?? null : null;
  }
  const reply = acceptReply(c.kind, target, r, localId, pick);
  await sendMessage(chatId, reply.text, reply.buttons);
  return r.ok ? "Heimdallr 에 요청했습니다" : "요청 실패 — 메시지를 확인하세요";
}

async function handleDeck(chatId: number, id: number): Promise<string> {
  const r = await dbSelect<Row>("analysis_requests", `select=*&id=eq.${id}`);
  const row = r.ok ? r.data[0] : undefined;
  if (!row || row.kind !== "company" || !row.heimdallr_id || !["sent", "reused"].includes(row.status)) return "기업 분석이 끝난 뒤에 누를 수 있습니다";
  const d = await requestDeck(row.heimdallr_id);
  if (d.ok && (d.data.status === "queued" || d.data.status === "in_progress")) await dbUpdate("analysis_requests", `id=eq.${id}`, { deck_status: "queued", deck_notified_at: null, updated_at: new Date().toISOString() });
  if (d.ok && d.data.status === "sent") await dbUpdate("analysis_requests", `id=eq.${id}`, { deck_status: "sent", deck_notion_url: d.data.notion_url, deck_notified_at: new Date().toISOString() });
  const reply = deckAcceptReply(row.target_name, d);
  await sendMessage(chatId, reply.text, reply.buttons);
  return d.ok ? "발표자료를 요청했습니다" : "요청 실패";
}

/** poll(30분): 열린 요청의 Heimdallr 상태 → 완료·실패 알림. 이미 알린 건 다시 보내지 않는다(notified_at) */
export async function pollAnalysis(chatId: string | undefined): Promise<Record<string, unknown>> {
  const since = new Date(Date.now() - 3 * 86_400_000).toISOString();    // 🧠 대기는 3일까지만 본다(그 뒤엔 🎤 단계가 분석부터)
  const open = await dbSelect<Row>("analysis_requests", `select=*&or=(and(status.in.(queued,working),notified_at.is.null),and(status.in.(sent,reused),claude_notified_at.is.null,created_at.gte.${since}),deck_status.in.(queued,working))&heimdallr_id=not.is.null&limit=50`);
  if (!open.ok) return { open: open.reason };
  if (!open.data.length) {
    // 열린 요청이 없어도 연동 상태는 남긴다(빈 목록 조회 = 읽기 전용) → 토큰 어긋남을 버튼 누르기 전에 안다
    if (!env().HEIMDALLR_JARVIS_TOKEN) return { open: 0, link: "토큰 미설정" };
    const ping = await analysisStatus([]);
    return { open: 0, link: ping.ok ? "ok" : ping.reason.slice(0, 120) };
  }
  const st = await analysisStatus([...new Set(open.data.map((x) => x.heimdallr_id as number))]);
  if (!st.ok) return { open: open.data.length, error: st.reason };
  const byId = new Map((st.data ?? []).map((s) => [s.request_id, s] as [number, AnalysisStatus]));
  let sent = 0;
  const now = new Date().toISOString();
  for (const row of open.data) {
    const s = byId.get(row.heimdallr_id as number);
    if (!s) continue;
    let codexStatus = row.status, claudeNotified = row.claude_notified_at;
    // ① Codex 분석
    if (["queued", "working"].includes(row.status) && !row.notified_at) {
      const fin = s.status === "sent" ? "sent" : s.status === "failed" || s.status === "rejected" ? s.status : null;
      if (fin) {
        const cs = claudeState(s.claude);
        const reply = doneReply(row.kind, row.target_name, fin, s.notion_url, s.error, row.id, fin === "sent" && !cs.done);
        const m = chatId ? await sendMessage(chatId, reply.text, reply.buttons) : null;
        const noClaude = fin !== "sent" || cs.claude_status === "none";     // 🧠 없음 → 🎤 를 이 알림에 이미 붙였다
        await dbUpdate("analysis_requests", `id=eq.${row.id}`, { status: fin, notion_url: s.notion_url, error: s.error, notified_at: m?.ok ? now : null,
          claude_status: cs.claude_status, claude_notified_at: m?.ok && noClaude ? now : null, updated_at: now });
        if (m?.ok) { sent++; codexStatus = fin; claudeNotified = noClaude ? now : null; }
      } else if (row.status !== "working" && s.status === "working") {
        await dbUpdate("analysis_requests", `id=eq.${row.id}`, { status: "working", updated_at: now });
      }
    }
    // ② 🧠 Claude 심층 분석 (Codex 완료 뒤, Heimdallr 가 자동 실행)
    if (["sent", "reused"].includes(codexStatus) && !claudeNotified && s.claude) {
      const cs = claudeState(s.claude);
      if (cs.done) {
        const pick = s.claude.status === "sent" ? await resolvePick(s.claude.top_pick) : null;
        const reply = claudeReply(row.kind, row.target_name, s.claude, s.notion_url ?? row.notion_url, row.id, pick);
        const m = chatId ? await sendMessage(chatId, reply.text, reply.buttons) : null;
        await dbUpdate("analysis_requests", `id=eq.${row.id}`, { claude_status: cs.claude_status, claude_notion_url: s.claude.notion_url, claude_error: s.claude.error,
          top_pick: s.claude.top_pick ?? null, claude_notified_at: m?.ok ? now : null, updated_at: now });
        if (m?.ok) sent++;
      } else if (row.claude_status !== cs.claude_status) {
        await dbUpdate("analysis_requests", `id=eq.${row.id}`, { claude_status: cs.claude_status, updated_at: now });
      }
    }
    if (["queued", "working"].includes(row.deck_status ?? "") && s.deck) {
      if (s.deck.status === "sent" || s.deck.status === "failed") {
        const reply = deckDoneReply(row.target_name, s.deck.status === "sent", s.deck.notion_url, s.deck.error);
        const m = chatId ? await sendMessage(chatId, reply.text, reply.buttons) : null;
        await dbUpdate("analysis_requests", `id=eq.${row.id}`, { deck_status: s.deck.status, deck_notion_url: s.deck.notion_url, deck_error: s.deck.error, deck_notified_at: m?.ok ? now : null, updated_at: now });
        if (m?.ok) sent++;
      } else if (s.deck.status === "working" && row.deck_status !== "working") {
        await dbUpdate("analysis_requests", `id=eq.${row.id}`, { deck_status: "working", updated_at: now });
      }
    }
  }
  return { open: open.data.length, notified: sent };
}

/** 버튼 로딩 표시를 끝낸다 (텔레그램은 콜백마다 answerCallbackQuery 를 기대) */
export const answerCallback = (id: string, text: string) => tgApi("answerCallbackQuery", { callback_query_id: id, text: text.slice(0, 190) });
