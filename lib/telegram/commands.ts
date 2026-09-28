/**
 * 텔레그램 명령 라우팅 (PRD §9.3) — 순수 함수. 데이터는 ctx 로 주입한다(테스트 가능).
 * P0: /status · /links. 나머지 명령은 해당 Phase 에서 구현한다.
 */
import { dashboardButtons, rows, type Button, type DashboardsConfig } from "@/lib/links";
import { esc, NOT_A_BUY_SIGNAL } from "./format";

export type Reply = { text: string; buttons?: Button[][] };

export type StatusCtx = {
  nowKst: string;
  env: Record<string, boolean>;                         // 설정 여부만 (값 없음)
  db: { ok: boolean; note?: string };
  jobs: { job: string; at: string; ok: boolean | null }[];
  sources: { source: string; last_ok_at: string | null; consecutive_failures: number }[];
};

export type CommandCtx = {
  dashboards: DashboardsConfig;
  jarvisUrl: string | null | undefined;
  status: () => Promise<StatusCtx>;
};

const PLANNED: Record<string, string> = {
  "/today": "P2", "/hold": "P2", "/s": "P2", "/entry": "P3", "/radar": "P4", "/growth": "P2",
  "/week": "P4", "/idea": "P2", "/mute": "P2",
};

/** "/cmd@Tonny_JARVIS_bot arg" → ["/cmd", "arg"] */
export function parseCommand(text: string): { cmd: string; arg: string } | null {
  const m = text.trim().match(/^(\/[a-zA-Z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/);
  return m ? { cmd: m[1].toLowerCase(), arg: (m[2] ?? "").trim() } : null;
}

export function renderLinks(ctx: Pick<CommandCtx, "dashboards" | "jarvisUrl">): Reply {
  const buttons = dashboardButtons(ctx.dashboards, ctx.jarvisUrl);
  const note = ctx.jarvisUrl ? "" : "\n<i>JARVIS 대시보드는 배포 후(JARVIS_URL 설정) 버튼이 생깁니다.</i>";
  return { text: `🔗 <b>대시보드</b>${note}`, buttons: rows(buttons, 3) };
}

export function renderStatus(s: StatusCtx): string {
  const envOk = Object.values(s.env).filter(Boolean).length;
  const missing = Object.entries(s.env).filter(([, v]) => !v).map(([k]) => k);
  const lines = [
    `🤖 <b>JARVIS 상태</b> · ${esc(s.nowKst)} KST`,
    `환경변수 ${envOk}/${Object.keys(s.env).length} 설정${missing.length ? ` · 미설정: ${esc(missing.join(", "))}` : ""}`,
    `DB: ${s.db.ok ? "✅" : "❌"}${s.db.note ? ` ${esc(s.db.note)}` : ""}`,
  ];
  if (s.sources.length) {
    lines.push("", "<b>소스</b>");
    for (const x of s.sources) lines.push(`${x.consecutive_failures >= 2 ? "🔧" : x.consecutive_failures ? "⚠️" : "✅"} ${esc(x.source)} · 마지막 성공 ${esc(x.last_ok_at ?? "없음")}`);
  }
  if (s.jobs.length) {
    lines.push("", "<b>최근 잡</b>");
    for (const j of s.jobs) lines.push(`${j.ok === null ? "⏳" : j.ok ? "✅" : "❌"} ${esc(j.job)} · ${esc(j.at)}`);
  }
  lines.push("", `<i>${esc(NOT_A_BUY_SIGNAL)}</i>`);
  return lines.join("\n");
}

export async function handleCommand(text: string, ctx: CommandCtx): Promise<Reply | null> {
  const p = parseCommand(text);
  if (!p) return null;
  if (p.cmd === "/status") return { text: renderStatus(await ctx.status()) };
  if (p.cmd === "/links") return renderLinks(ctx);
  if (p.cmd === "/start" || p.cmd === "/help") {
    return { text: ["🤖 <b>JARVIS</b> — 사용 가능: /status · /links", `준비 중: ${Object.keys(PLANNED).join(" ")}`].join("\n") };
  }
  const phase = PLANNED[p.cmd];
  return { text: phase ? `${esc(p.cmd)} 는 ${phase}에서 제공됩니다. 지금은 /status · /links 를 쓸 수 있습니다.` : `알 수 없는 명령: ${esc(p.cmd)} — /help` };
}
