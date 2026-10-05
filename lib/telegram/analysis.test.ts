import { describe, expect, it } from "vitest";
import { acceptReply, analysisKeyboard, analysisPrompt, deckAcceptReply, deckDoneReply, doneReply, parseCallback, reuseAfter } from "./analysis";
import { inlineKeyboard } from "./send";

const FOOT = "매수 확정 신호가 아닙니다";

describe("🔎 분석 버튼 (D59)", () => {
  it("추천 종목마다 [🏭 산업][🏢 기업], 같은 산업은 한 번만, 64바이트 넘는 콜백은 생략", () => {
    const kb = analysisKeyboard([
      { entityId: "KR:009150", name: "삼성전기", industry: "반도체" },
      { entityId: "US:NVDA", name: "NVIDIA", industry: "반도체" },
      { entityId: "KR:000660", name: "SK하이닉스", industry: null },
      { entityId: "KR:1", name: "X", industry: "가".repeat(30) },
    ]);
    expect(kb[0]).toEqual([{ text: "🏭 반도체", callback_data: "an:i:반도체" }, { text: "🏢 삼성전기", callback_data: "an:c:KR:009150" }]);
    expect(kb[1]).toEqual([{ text: "🏢 NVIDIA", callback_data: "an:c:US:NVDA" }]);
    expect(kb[2]).toHaveLength(1);
    expect(kb[3]).toEqual([{ text: "🏢 X", callback_data: "an:c:KR:1" }]);
    expect(analysisKeyboard([{ entityId: "K".repeat(70), name: "긴ID", industry: null }])).toEqual([]);
    expect(analysisPrompt()).toContain(FOOT);
  });

  it("콜백 해석", () => {
    expect(parseCallback("an:c:KR:009150")).toEqual({ type: "analysis", kind: "company", key: "KR:009150" });
    expect(parseCallback("an:i:AI 인프라")).toEqual({ type: "analysis", kind: "industry", key: "AI 인프라" });
    expect(parseCallback("dk:42")).toEqual({ type: "deck", id: 42 });
    expect(parseCallback("dk:x")).toBeNull();
    expect(parseCallback(undefined)).toBeNull();
  });

  it("재사용 기준: 산업 30일, 기업은 30일과 최근 실적 발표일 중 늦은 쪽", () => {
    const now = new Date("2026-10-05T03:00:00Z");
    const d30 = "2026-09-05T03:00:00.000Z";
    expect(reuseAfter("industry", now, "2026-09-25")).toBe(d30);
    expect(reuseAfter("company", now, null)).toBe(d30);
    expect(reuseAfter("company", now, "2026-08-01")).toBe(d30);                       // 30일보다 오래된 실적 → 30일
    expect(reuseAfter("company", now, "2026-09-25")).toBe("2026-09-24T15:00:00.000Z"); // 실적 발표 이후 분석만 재사용
    expect(reuseAfter("company", now, "2026-10-20")).toBe(d30);                       // 미래 일정은 무시
  });

  it("접수 답장: 실패·재사용(🎤 포함)·진행 중·거절·접수", () => {
    expect(acceptReply("company", "<삼성>", { ok: false, reason: "RPC 없음" }, null).text).toContain("&lt;삼성&gt;");
    const reused = acceptReply("company", "삼성전기", { ok: true, data: { status: "reused", request_id: 7, notion_url: "https://n/1", completed_at: "2026-10-01T00:00:00Z" } }, 3);
    expect(reused.text).toContain("2026-10-01에 끝난 분석");
    expect(reused.buttons).toEqual([[{ text: "📝 노션에서 보기", url: "https://n/1" }, { text: "🎤 발표자료", callback_data: "dk:3" }]]);
    expect(acceptReply("industry", "반도체", { ok: true, data: { status: "reused", request_id: 7, notion_url: null, completed_at: null } }, 3).buttons).toEqual([]);
    expect(acceptReply("industry", "반도체", { ok: true, data: { status: "in_progress", request_id: 7, notion_url: null, completed_at: null } }, null).text).toContain("이미 분석 중");
    expect(acceptReply("industry", "반도체", { ok: true, data: { status: "rejected", request_id: null, notion_url: null, completed_at: null, reason: "산업 미확인" } }, null).text).toContain("산업 미확인");
    expect(acceptReply("industry", "반도체", { ok: true, data: { status: "rejected", request_id: null, notion_url: null, completed_at: null } }, null).text).toContain("사유 없음");
    const q = acceptReply("company", "NVIDIA", { ok: true, data: { status: "queued", request_id: 8, notion_url: null, completed_at: null } }, 4);
    expect(q.text).toContain("접수했습니다");
    expect(q.text).toContain(FOOT);
  });

  it("완료·실패 알림: 기업만 🎤", () => {
    const c = doneReply("company", "삼성전기", "sent", "https://n/2", null, 5);
    expect(c.buttons[0].map((b) => b.text)).toEqual(["📝 노션에서 보기", "🎤 발표자료"]);
    expect(c.text).toContain("🎤 발표자료 버튼");
    expect(doneReply("industry", "반도체", "sent", "https://n/3", null, 6).buttons[0]).toHaveLength(1);
    expect(doneReply("industry", "반도체", "sent", null, null, 6).buttons).toEqual([]);
    const f = doneReply("company", "삼성전기", "failed", null, "SOURCE_ACCESS", 5);
    expect(f.text).toContain("❌");
    expect(f.text).toContain("SOURCE_ACCESS");
    expect(doneReply("company", "삼성전기", "rejected", null, null, 5).text).toContain("rejected");
  });

  it("🎤 접수·완료", () => {
    expect(deckAcceptReply("삼성전기", { ok: false, reason: "x" }).text).toContain("요청 실패");
    expect(deckAcceptReply("삼성전기", { ok: true, data: { status: "sent", notion_url: "https://n/4" } }).buttons).toEqual([[{ text: "📝 노션에서 보기", url: "https://n/4" }]]);
    expect(deckAcceptReply("삼성전기", { ok: true, data: { status: "in_progress", notion_url: null } }).text).toContain("만드는 중");
    expect(deckAcceptReply("삼성전기", { ok: true, data: { status: "rejected", notion_url: null, reason: "분석 미완료" } }).text).toContain("분석 미완료");
    expect(deckAcceptReply("삼성전기", { ok: true, data: { status: "rejected", notion_url: null } }).text).toContain("사유 없음");
    expect(deckAcceptReply("삼성전기", { ok: true, data: { status: "queued", notion_url: null } }).text).toContain("접수했습니다");
    expect(deckDoneReply("삼성전기", true, "https://n/5", null).text).toContain("PDF(미리보기)·PPTX");
    const bad = deckDoneReply("삼성전기", false, null, null);
    expect(bad.text).toContain("알 수 없음");
    expect(bad.buttons).toEqual([]);
  });

  it("인라인 키보드: 링크·콜백 버튼 혼합", () => {
    expect(inlineKeyboard([[{ text: "a", url: "https://x" }, { text: "b", callback_data: "dk:1" }]])).toEqual({ inline_keyboard: [[{ text: "a", url: "https://x" }, { text: "b", callback_data: "dk:1" }]] });
  });
});
