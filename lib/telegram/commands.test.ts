import { describe, expect, it } from "vitest";
import { handleCommand, parseCommand, renderStatus, type StatusCtx } from "./commands";

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
    expect((await handleCommand("/entry", ctx))?.text).toContain("P3");
    expect((await handleCommand("/foo", ctx))?.text).toContain("알 수 없는 명령: /foo");
    expect(await handleCommand("안녕", ctx)).toBeNull();
  });
});
