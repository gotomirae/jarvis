import { describe, expect, it } from "vitest";
import { handleCommand, parseCommand, renderPinnedLinks, renderStatus, type StatusCtx } from "./commands";

const dashboards = {
  jarvis: { label: "📊 JARVIS", url: "${JARVIS_URL}/" },
  heimdallr: { label: "🛡️ Heimdallr", url: "https://heimdallr-call.vercel.app/" },
  sage: { label: "🧙 Sage", url: "https://sage.example/" },
  flywheel: { label: "🔄 FlyWheel", url: "https://www.notion.so/x" },
};
const status: StatusCtx = {
  nowKst: "2026-09-27 21:00",
  env: { TELEGRAM_BOT_TOKEN: true, SAGE_READ_KEY: false },
  db: { ok: true },
  jobs: [{ job: "outlook_smoke", at: "2026-09-27 04:00", ok: true }, { job: "x", at: "t", ok: false }, { job: "y", at: "t", ok: null }],
  sources: [
    { source: "heimdallr", last_ok_at: "2026-09-27 20:00", consecutive_failures: 0 },
    { source: "sage", last_ok_at: null, consecutive_failures: 2 },
    { source: "gdelt", last_ok_at: "t", consecutive_failures: 1 },
  ],
};
const ctx = { dashboards, jarvisUrl: undefined as string | undefined, status: async () => status };

describe("telegram commands", () => {
  it("parses commands with bot suffix and args", () => {
    expect(parseCommand("/status@Tonny_JARVIS_bot")).toEqual({ cmd: "/status", arg: "" });
    expect(parseCommand("/S 삼성전자 ")).toEqual({ cmd: "/s", arg: "삼성전자" });
    expect(parseCommand("hello")).toBeNull();
  });

  it("/status renders presence, sources, jobs and the not-a-buy-signal footer", async () => {
    const r = await handleCommand("/status", ctx);
    expect(r?.text).toContain("환경변수 1/2 설정");
    expect(r?.text).toContain("미설정: SAGE_READ_KEY");
    expect(r?.text).toContain("🔧 sage");
    expect(r?.text).toContain("⚠️ gdelt");
    expect(r?.text).toContain("❌ x");
    expect(r?.text).toContain("⏳ y");
    expect(r?.text).toContain("매수 확정 신호가 아닙니다");
    const minimal = renderStatus({ ...status, env: { A: true }, db: { ok: false, note: "<err>" }, jobs: [], sources: [] });
    expect(minimal).toContain("DB: ❌ &lt;err&gt;");
    expect(minimal).not.toContain("미설정:");
    expect(minimal).not.toContain("최근 잡");
  });

  it("/links returns dashboard buttons in rows of 3, JARVIS only with URL", async () => {
    const r = await handleCommand("/links", ctx);
    expect(r?.buttons?.flat().map((b) => b.text)).toEqual(["🛡️ Heimdallr", "🧙 Sage", "🔄 FlyWheel"]);
    expect(r?.text).toContain("JARVIS_URL");
    const r2 = await handleCommand("/links", { ...ctx, jarvisUrl: "https://j.app" });
    expect(r2?.buttons?.[0][0]).toEqual({ text: "📊 JARVIS", url: "https://j.app/" });
    expect(r2?.buttons?.[1]).toHaveLength(1);
    expect(r2?.text).not.toContain("JARVIS_URL");
  });

  it("/pin: 6개 바로가기 고정 메시지·성공/실패 응답, ctx 없으면 알 수 없는 명령", async () => {
    const six = { ...dashboards, hermescall: { label: "⚡ HermesCall", url: "https://h/" }, snowball: { label: "❄️ SnowBall", url: "https://s/" } };
    const m = renderPinnedLinks({ dashboards: six, jarvisUrl: "https://j.app" });
    expect(m.buttons?.map((r) => r.length)).toEqual([3, 3]);
    expect(m.buttons?.flat().map((b) => b.text)).toEqual(["📊 JARVIS", "🛡️ Heimdallr", "🧙 Sage", "🔄 FlyWheel", "⚡ HermesCall", "❄️ SnowBall"]);
    expect(m.text).toContain("📌 <b>프로젝트 바로가기</b>");
    expect(m.text).not.toContain("JARVIS_URL");
    expect(m.text).toContain("입력창 옆 <b>📌 바로가기</b>");
    expect(renderPinnedLinks({ dashboards: six, jarvisUrl: undefined }).text).toContain("JARVIS_URL");
    expect((await handleCommand("/pin", { ...ctx, pin: async () => null }))?.text).toContain("맨 위에 고정했습니다");
    expect((await handleCommand("/pin", { ...ctx, pin: async () => "pinChatMessage: 400 <x>" }))?.text).toBe("📌 고정 실패: pinChatMessage: 400 &lt;x&gt;");
    expect((await handleCommand("/pin", ctx))?.text).toContain("알 수 없는 명령");
  });

  it("/alerts on|off 와 /status 표시", async () => {
    let state: boolean | null = null;
    const c = { ...ctx, setAlertPause: async (p: boolean) => { state = p; } };
    expect((await handleCommand("/alerts off", c))?.text).toContain("멈췄습니다");
    expect(state).toBe(true);
    expect((await handleCommand("/alerts ON", c))?.text).toContain("다시 켰습니다");
    expect(state).toBe(false);
    expect((await handleCommand("/alerts", c))?.text).toContain("사용법");
    expect((await handleCommand("/alerts off", ctx))?.text).toContain("사용법");
    expect(renderStatus({ ...status, alertsPaused: true })).toContain("⏸ 일시 정지");
    expect(renderStatus({ ...status, alertsPaused: false })).toContain("▶️ 켜짐");
  });

  it("help, planned and unknown commands; plain text ignored", async () => {
    expect((await handleCommand("/start", ctx))?.text).toContain("/status · /links");
    expect((await handleCommand("/help", ctx))?.text).toContain("/entry");
    expect((await handleCommand("/radar", ctx))?.text).toContain("P4");
    expect((await handleCommand("/foo", ctx))?.text).toContain("알 수 없는 명령: /foo");
    expect(await handleCommand("안녕", ctx)).toBeNull();
  });
});

describe("/week · /entry (P4)", async () => {
  const { handleCommand, renderWeek, renderEntry } = await import("./commands");
  const base = { dashboards: {}, jarvisUrl: "https://j.app/", status: async () => ({ nowKst: "", env: {}, db: { ok: true }, jobs: [], sources: [] }) };
  it("/week: 최신 메모 링크 · 없음", async () => {
    const r = await handleCommand("/week", { ...base, weekly: async () => ({ week: "2026-W40", grounded: false, publishedKst: "2026-10-03 09:31", notionUrl: "https://n/x" }) });
    expect(r?.text).toContain("🏛️ <b>주간 투자위원회 2026-W40</b>");
    expect(r?.text).toContain("서술 없이 표·목록만");
    expect(r?.text).toContain('href="https://j.app/weekly?week=2026-W40"');
    expect(r?.text).toContain('href="https://n/x"');
    expect(renderWeek(null, null).text).toContain("아직 발행된");
    const g = renderWeek({ week: "W", grounded: true, publishedKst: "t", notionUrl: null }, null).text;
    expect(g).not.toContain("🔗");
    expect(g).not.toContain("표·목록만");
  });
  it("/entry: 단계별 목록·8개 초과 생략", async () => {
    const r = await handleCommand("/entry", { ...base, entry: async () => ({ kr: "2026-10-02", us: null, green: ["한화에어로스페이스"], yellow: [], blue: Array.from({ length: 9 }, (_, i) => `B${i}`) }) });
    expect(r?.text).toContain("국내 2026-10-02 · 미국 - 평가");
    expect(r?.text).toContain("🟢 진입 신호 1: 한화에어로스페이스");
    expect(r?.text).toContain("🟡 관찰 0\n");
    expect(r?.text).toContain(" 외");
    expect(r?.text).toContain('href="https://j.app/entry"');
    expect(renderEntry({ kr: null, us: null, green: [], yellow: [], blue: [] }, undefined).text).not.toContain("🔗");
  });
  it("ctx 가 없으면 준비 중 안내로", async () => {
    expect((await handleCommand("/week", base))?.text).toContain("알 수 없는 명령");
  });
});
