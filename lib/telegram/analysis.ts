/**
 * 🔎 추천 종목 심층 분석 버튼 (D59·D60) — 순수 함수.
 * 버튼 → Heimdallr Codex 분석(노션) → 🧠 Claude 심층 분석(자동: Codex 노션·Codex 자료·웹) → 완료 알림 → 🎤 발표자료(선택, 양식 PPT).
 * 판정과 무관한 참고 자료다(불변 규칙 5: 🟢 판정에 쓰지 않는다). 모든 메시지에 "매수 확정 신호 아님"(불변 규칙 3).
 * 콜백 데이터(64바이트 제한): an:c:<종목ID> · an:i:<산업명> · dk:<장부ID>
 */
import type { AnalysisKind, AnalysisRequestResult, ClaudeJob } from "@/lib/ingest/heimdallr";
import type { Button } from "@/lib/links";
import { esc, NOT_A_BUY_SIGNAL } from "./format";

export type CallbackButton = { text: string; callback_data: string };
export type KbButton = Button | CallbackButton;
export type AnalysisPick = { entityId: string; name: string; industry: string | null };
export type Callback = { type: "analysis"; kind: AnalysisKind; key: string } | { type: "deck"; id: number };

const MAX_CB = 64;
const FOOT = `<i>${esc(NOT_A_BUY_SIGNAL)}</i>`;
const KIND = { company: "🏢 기업 분석", industry: "🏭 산업 분석" } as const;
const DAY = 86_400_000;

const cb = (text: string, data: string): CallbackButton | null => (Buffer.byteLength(data, "utf8") <= MAX_CB ? { text, callback_data: data } : null);

/** 추천 종목마다 한 줄: [🏭 산업] [🏢 기업]. 같은 산업 버튼은 한 번만(처음 나온 줄에) */
export function analysisKeyboard(picks: AnalysisPick[]): KbButton[][] {
  const seen = new Set<string>();
  return picks.map((p) => {
    const row: KbButton[] = [];
    if (p.industry && !seen.has(p.industry)) {
      seen.add(p.industry);
      const b = cb(`🏭 ${p.industry}`, `an:i:${p.industry}`);
      if (b) row.push(b);
    }
    const c = cb(`🏢 ${p.name}`, `an:c:${p.entityId}`);
    if (c) row.push(c);
    return row;
  }).filter((r) => r.length);
}

export function analysisPrompt(): string {
  return ["🔎 <b>추천 종목 심층 분석</b>", "버튼을 누르면 Heimdallr가 산업·기업 분석을 노션에 씁니다.", "최근 분석이 있으면(기업 30일·그 사이 실적 발표 없음 / 산업 30일) 다시 돌리지 않고 그 링크를 드립니다.", "", FOOT].join("\n");
}

export function parseCallback(data: string | undefined): Callback | null {
  if (!data) return null;
  const m = data.match(/^an:([ci]):(.+)$/s);
  if (m) return { type: "analysis", kind: m[1] === "c" ? "company" : "industry", key: m[2] };
  const d = data.match(/^dk:(\d+)$/);
  return d ? { type: "deck", id: Number(d[1]) } : null;
}

/** 이 시각 이후 완료된 분석은 재사용한다: 산업 = 30일 전, 기업 = 30일 전과 가장 최근 실적 발표일 중 늦은 쪽 */
export function reuseAfter(kind: AnalysisKind, now: Date, lastEarningsDate: string | null): string {
  const d30 = new Date(now.getTime() - 30 * DAY);
  if (kind === "company" && lastEarningsDate) {
    const er = new Date(`${lastEarningsDate}T00:00:00+09:00`);
    if (er > d30 && er <= now) return er.toISOString();
  }
  return d30.toISOString();
}

const notionBtn = (url: string | null, text = "📝 노션에서 보기"): KbButton[] => (url ? [{ text, url }] : []);
const codexBtn = (url: string | null) => notionBtn(url, "📝 Codex 분석");
const claudeBtn = (url: string | null) => notionBtn(url, "🧠 Claude 분석");
const deckBtn = (kind: AnalysisKind, localId: number | null): KbButton[] => (kind === "company" && localId ? [{ text: "🎤 발표자료", callback_data: `dk:${localId}` }] : []);
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "-");
const rowsOf = (...rs: KbButton[][]) => rs.filter((r) => r.length);

/** 산업 분석의 Claude 선별 최고 기업 → 🏢 기업 분석 버튼 (JARVIS 종목 마스터에 있을 때만) */
export type TopPick = { name: string; entityId: string | null };
const pickBtn = (p: TopPick | null | undefined): KbButton[] => {
  const b = p?.entityId ? cb(`🏢 ${p.name} 기업 분석`, `an:c:${p.entityId}`) : null;
  return b ? [b] : [];
};
/** 🧠 다음에 할 일: 기업 = 🎤, 산업 = 선별 기업 🏢 */
const nextRow = (kind: AnalysisKind, localId: number | null, pick?: TopPick | null): KbButton[] => (kind === "company" ? deckBtn(kind, localId) : pickBtn(pick));

/** 버튼을 누른 직후 답장 */
export function acceptReply(kind: AnalysisKind, target: string, r: { ok: true; data: AnalysisRequestResult } | { ok: false; reason: string }, localId: number | null, pick: TopPick | null = null): { text: string; buttons: KbButton[][] } {
  const head = `🔎 <b>${KIND[kind]}</b> · ${esc(target)}`;
  if (!r.ok) return { text: [head, `Heimdallr 요청 실패: ${esc(r.reason)}`, "<i>Heimdallr 쪽 연동(INTEGRATION_TASKS G)이 끝나야 동작합니다.</i>", "", FOOT].join("\n"), buttons: [] };
  const d = r.data;
  if (d.status === "reused") {
    const c = d.claude;
    const lines = [head, `✅ ${day(d.completed_at)}에 끝난 분석이 있어 다시 돌리지 않습니다.`];
    if (c?.status === "sent") return { text: [...lines, "", FOOT].join("\n"), buttons: rowsOf([...codexBtn(d.notion_url), ...claudeBtn(c.notion_url)], nextRow(kind, localId, pick)) };
    if (c && (c.status === "pending" || c.status === "working")) return { text: [...lines, "🧠 Claude 심층 분석이 진행 중입니다. 끝나면 알려드립니다.", "", FOOT].join("\n"), buttons: rowsOf(codexBtn(d.notion_url)) };
    return { text: [...lines, "", FOOT].join("\n"), buttons: rowsOf([...codexBtn(d.notion_url), ...deckBtn(kind, localId)]) };
  }
  if (d.status === "in_progress") return { text: [head, "⏳ 이미 분석 중입니다. 끝나면 여기로 알려드립니다.", "", FOOT].join("\n"), buttons: [] };
  if (d.status === "rejected") return { text: [head, `❌ 접수 안 됨: ${esc(d.reason ?? "사유 없음")}`, "", FOOT].join("\n"), buttons: [] };
  return { text: [head, "📥 접수했습니다. Heimdallr(Codex)가 노션에 쓰면(보통 1~2시간, PC·Codex 실행 중일 때) 알려드리고, 이어서 🧠 Claude가 심층 분석합니다.", "", FOOT].join("\n"), buttons: [] };
}

/** Codex 분석 완료·실패 알림 (poll). claudePending = 🧠 Claude 심층 분석이 이어서 돈다 → 🎤 는 🧠 끝난 뒤(D60) */
export function doneReply(kind: AnalysisKind, target: string, status: "sent" | "failed" | "rejected", notionUrl: string | null, error: string | null, localId: number, claudePending = false): { text: string; buttons: KbButton[][] } {
  const head = `${status === "sent" ? "✅" : "❌"} <b>${KIND[kind]} ${status === "sent" ? "완료" : "실패"}</b> · ${esc(target)}`;
  if (status !== "sent") return { text: [head, `원인: ${esc(error ?? status)}`, "다시 누르면 새로 요청합니다.", "", FOOT].join("\n"), buttons: [] };
  if (claudePending) {
    return { text: [`✅ <b>${KIND[kind]} (Codex) 완료</b> · ${esc(target)}`, "🧠 Claude가 이 노션 분석과 Codex가 쓴 자료·웹 검색으로 심층 분석을 이어서 합니다(보통 30분~1시간). 끝나면 다시 알려드립니다.", "", FOOT].join("\n"), buttons: rowsOf(codexBtn(notionUrl)) };
  }
  const lines = [head, kind === "company" ? "🎤 발표자료 버튼을 누르면 Claude가 양식대로 PPT를 만들어 노션·드라이브에 저장합니다." : null, "", FOOT].filter((x) => x !== null);
  return { text: lines.join("\n"), buttons: rowsOf([...notionBtn(notionUrl), ...deckBtn(kind, localId)]) };
}

/** 🧠 Claude 심층 분석 완료·실패 알림 (poll). 기업 → 🎤, 산업 → 선별 최고 기업 🏢. 실패해도 🎤 는 가능(발표자료 단계가 분석부터 한다) */
export function claudeReply(kind: AnalysisKind, target: string, job: Pick<ClaudeJob, "status" | "notion_url" | "error">, codexUrl: string | null, localId: number, pick: TopPick | null = null): { text: string; buttons: KbButton[][] } {
  const ok = job.status === "sent";
  const lines = [`${ok ? "🧠" : "⚠️"} <b>Claude 심층 분석 ${ok ? "완료" : "실패"}</b> · ${esc(target)}`];
  if (ok && kind === "company") lines.push("Codex 분석·Codex 자료·웹을 다시 확인해 산업 → 기업 → 시나리오까지 정리했습니다. 🎤 를 누르면 양식대로 발표자료(PPT·PDF)를 만듭니다.");
  if (ok && kind === "industry") lines.push(pick ? `산업 리포트와 기업 선별을 마쳤습니다. 가장 매력적인 기업: <b>${esc(pick.name)}</b>${pick.entityId ? " — 🏢 로 기업 분석을 이어갈 수 있습니다." : ""}` : "산업 리포트와 기업 선별을 마쳤습니다.");
  if (!ok) lines.push(`원인: ${esc(job.error ?? "알 수 없음")}`, kind === "company" ? "Codex 분석은 그대로 있습니다. 🎤 를 누르면 발표자료 단계에서 심층 분석부터 합니다." : "Codex 분석은 그대로 있습니다.");
  lines.push("", FOOT);
  return { text: lines.join("\n"), buttons: rowsOf([...codexBtn(codexUrl), ...(ok ? claudeBtn(job.notion_url) : [])], nextRow(kind, localId, ok ? pick : null)) };
}

/** Heimdallr 🧠 작업 상태 → JARVIS 장부 claude_status. done = 더 기다릴 것 없음(알림 대상이거나 🧠 없음) */
export function claudeState(job: ClaudeJob | null | undefined): { claude_status: "queued" | "working" | "sent" | "failed" | "none"; done: boolean } {
  if (!job) return { claude_status: "none", done: true };            // 이 기능 이전 분석 — 🎤 는 바로 가능(발표자료 단계가 분석부터)
  if (job.status === "pending") return { claude_status: "queued", done: false };
  if (job.status === "working") return { claude_status: "working", done: false };
  return { claude_status: job.status, done: true };
}

/** 🎤 누른 직후 답장 */
export function deckAcceptReply(target: string, r: { ok: true; data: { status: string; notion_url: string | null; reason?: string | null } } | { ok: false; reason: string }): { text: string; buttons: KbButton[][] } {
  const head = `🎤 <b>발표자료</b> · ${esc(target)}`;
  if (!r.ok) return { text: [head, `요청 실패: ${esc(r.reason)}`, "", FOOT].join("\n"), buttons: [] };
  const d = r.data;
  if (d.status === "sent") return { text: [head, "✅ 이미 만든 발표자료가 있습니다.", "", FOOT].join("\n"), buttons: [notionBtn(d.notion_url)].filter((x) => x.length) };
  if (d.status === "in_progress") return { text: [head, "⏳ 이미 만드는 중입니다.", "", FOOT].join("\n"), buttons: [] };
  if (d.status === "rejected") return { text: [head, `❌ 접수 안 됨: ${esc(d.reason ?? "사유 없음")}`, "", FOOT].join("\n"), buttons: [] };
  return { text: [head, "📥 접수했습니다. 끝나면(보통 30분~1시간) PDF·PPT 링크를 보내드립니다.", "", FOOT].join("\n"), buttons: [] };
}

export function deckDoneReply(target: string, ok: boolean, notionUrl: string | null, error: string | null): { text: string; buttons: KbButton[][] } {
  const head = `${ok ? "✅" : "❌"} <b>🎤 발표자료 ${ok ? "완료" : "실패"}</b> · ${esc(target)}`;
  const body = ok ? "노션 기업 페이지에 PDF(미리보기)·PPTX를 붙였고, 드라이브 기업 폴더에도 저장했습니다." : `원인: ${esc(error ?? "알 수 없음")} — 다시 누르면 새로 요청합니다.`;
  return { text: [head, body, "", FOOT].join("\n"), buttons: ok ? [notionBtn(notionUrl)].filter((x) => x.length) : [] };
}
