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
  alertsPaused?: boolean;
};

export type CommandCtx = {
  dashboards: DashboardsConfig;
  jarvisUrl: string | null | undefined;
  status: () => Promise<StatusCtx>;
  setAlertPause?: (paused: boolean) => Promise<void>;     // /alerts on|off — 보유 경고 텔레그램 일시 정지
  weekly?: () => Promise<WeekCtx | null>;                 // /week — 최신 주간 투자위원회
  entry?: () => Promise<EntryCtx>;                        // /entry — 🟢·🟡·🔵 현황
};

export type WeekCtx = { week: string; grounded: boolean; publishedKst: string; notionUrl: string | null };
export type EntryCtx = { kr: string | null; us: string | null; green: string[]; yellow: string[]; blue: string[] };

const PLANNED: Record<string, string> = {
  "/today": "P2", "/hold": "P2", "/s": "P2", "/radar": "P4", "/growth": "P2", "/idea": "P2", "/mute": "P2",
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
  if (s.alertsPaused !== undefined) lines.push(`보유 경고 알림: ${s.alertsPaused ? "⏸ 일시 정지 (/alerts on 으로 재개)" : "▶️ 켜짐"}`);
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
  if (p.cmd === "/alerts") {
    const arg = p.arg.toLowerCase();
    if (!ctx.setAlertPause || !["on", "off"].includes(arg)) return { text: "사용법: /alerts off (보유 경고 알림 일시 정지) · /alerts on (다시 켜기)" };
    await ctx.setAlertPause(arg === "off");
    return { text: arg === "off" ? "⏸ 보유 경고 알림을 멈췄습니다. 경고는 계속 계산해 대시보드에만 표시합니다. 다시 켜려면 /alerts on" : "▶️ 보유 경고 알림을 다시 켰습니다. 멈춘 동안 쌓인 경고는 보내지 않고, 새로 생기는 경고부터 알립니다." };
  }
  if (p.cmd === "/week" && ctx.weekly) return renderWeek(await ctx.weekly(), ctx.jarvisUrl);
  if (p.cmd === "/entry" && ctx.entry) return renderEntry(await ctx.entry(), ctx.jarvisUrl);
  if (p.cmd === "/start" || p.cmd === "/help") {
    return { text: ["🤖 <b>JARVIS</b> — 사용 가능: /status · /links · /alerts on|off · /entry · /week", `준비 중: ${Object.keys(PLANNED).join(" ")}`].join("\n") };
  }
  const phase = PLANNED[p.cmd];
  return { text: phase ? `${esc(p.cmd)} 는 ${phase}에서 제공됩니다. 지금은 /status · /links 를 쓸 수 있습니다.` : `알 수 없는 명령: ${esc(p.cmd)} — /help` };
}

const base = (u: string | null | undefined) => (u ? u.replace(/\/$/, "") : null);

export function renderWeek(w: WeekCtx | null, jarvisUrl: string | null | undefined): Reply {
  if (!w) return { text: "아직 발행된 주간 투자위원회가 없습니다. 매주 토요일 09:30(늦어도 10:30)에 발행합니다." };
  const b = base(jarvisUrl);
  const links = [b && `<a href="${esc(`${b}/weekly?week=${w.week}`)}">대시보드 전문</a>`, w.notionUrl && `<a href="${esc(w.notionUrl)}">노션</a>`].filter(Boolean);
  const lines = [`🏛️ <b>주간 투자위원회 ${esc(w.week)}</b>`, `발행 ${esc(w.publishedKst)} KST${w.grounded ? "" : " · 서술 없이 표·목록만"}`];
  if (links.length) lines.push(`🔗 ${links.join(" · ")}`);
  lines.push("", `<i>${esc(NOT_A_BUY_SIGNAL)}</i>`);
  return { text: lines.join("\n") };
}

export function renderEntry(e: EntryCtx, jarvisUrl: string | null | undefined): Reply {
  const b = base(jarvisUrl);
  const sec = (icon: string, name: string, xs: string[]) => `${icon} ${name} ${xs.length}${xs.length ? `: ${xs.slice(0, 8).map(esc).join(" · ")}${xs.length > 8 ? " 외" : ""}` : ""}`;
  const lines = [`🚦 <b>진입 보드</b> (국내 ${esc(e.kr ?? "-")} · 미국 ${esc(e.us ?? "-")} 평가)`, sec("🟢", "진입 신호", e.green), sec("🟡", "관찰", e.yellow), sec("🔵", "실적 돌파(진입 신호 아님)", e.blue)];
  if (b) lines.push(`🔗 <a href="${esc(`${b}/entry`)}">진입 보드 자세히</a>`);
  lines.push("", `<i>${esc(NOT_A_BUY_SIGNAL)}</i>`);
  return { text: lines.join("\n") };
}
