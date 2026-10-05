/**
 * 🔎 추천 종목 심층 분석 버튼 (D59) — 순수 함수. 버튼 → Heimdallr 산업·기업 분석(Kairos, 노션) → 완료 알림 → 🎤 발표자료(Claude, PPT).
 * 판정과 무관한 참고 자료다(불변 규칙 5: 🟢 판정에 쓰지 않는다). 모든 메시지에 "매수 확정 신호 아님"(불변 규칙 3).
 * 콜백 데이터(64바이트 제한): an:c:<종목ID> · an:i:<산업명> · dk:<장부ID>
 */
import type { AnalysisKind, AnalysisRequestResult } from "@/lib/ingest/heimdallr";
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

const notionBtn = (url: string | null): KbButton[] => (url ? [{ text: "📝 노션에서 보기", url }] : []);
const deckBtn = (kind: AnalysisKind, localId: number | null): KbButton[] => (kind === "company" && localId ? [{ text: "🎤 발표자료", callback_data: `dk:${localId}` }] : []);
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "-");

/** 버튼을 누른 직후 답장 */
export function acceptReply(kind: AnalysisKind, target: string, r: { ok: true; data: AnalysisRequestResult } | { ok: false; reason: string }, localId: number | null): { text: string; buttons: KbButton[][] } {
  const head = `🔎 <b>${KIND[kind]}</b> · ${esc(target)}`;
  if (!r.ok) return { text: [head, `Heimdallr 요청 실패: ${esc(r.reason)}`, "<i>Heimdallr 쪽 연동(INTEGRATION_TASKS G)이 끝나야 동작합니다.</i>", "", FOOT].join("\n"), buttons: [] };
  const d = r.data;
  if (d.status === "reused") {
    return { text: [head, `✅ ${day(d.completed_at)}에 끝난 분석이 있어 다시 돌리지 않습니다.`, "", FOOT].join("\n"), buttons: [[...notionBtn(d.notion_url), ...deckBtn(kind, localId)]].filter((x) => x.length) };
  }
  if (d.status === "in_progress") return { text: [head, "⏳ 이미 분석 중입니다. 끝나면 여기로 알려드립니다.", "", FOOT].join("\n"), buttons: [] };
  if (d.status === "rejected") return { text: [head, `❌ 접수 안 됨: ${esc(d.reason ?? "사유 없음")}`, "", FOOT].join("\n"), buttons: [] };
  return { text: [head, "📥 접수했습니다. Heimdallr가 노션에 작성하면(보통 1~2시간, PC·Codex 실행 중일 때) 여기로 알려드립니다.", "", FOOT].join("\n"), buttons: [] };
}

/** 분석 완료·실패 알림 (poll) */
export function doneReply(kind: AnalysisKind, target: string, status: "sent" | "failed" | "rejected", notionUrl: string | null, error: string | null, localId: number): { text: string; buttons: KbButton[][] } {
  const head = `${status === "sent" ? "✅" : "❌"} <b>${KIND[kind]} ${status === "sent" ? "완료" : "실패"}</b> · ${esc(target)}`;
  if (status !== "sent") return { text: [head, `원인: ${esc(error ?? status)}`, "다시 누르면 새로 요청합니다.", "", FOOT].join("\n"), buttons: [] };
  const lines = [head, kind === "company" ? "🎤 발표자료 버튼을 누르면 Claude가 양식대로 PPT를 만들어 노션·드라이브에 저장합니다." : null, "", FOOT].filter((x) => x !== null);
  return { text: lines.join("\n"), buttons: [[...notionBtn(notionUrl), ...deckBtn(kind, localId)]].filter((x) => x.length) };
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
