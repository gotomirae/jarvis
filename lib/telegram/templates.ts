/**
 * 텔레그램 메시지 템플릿 (PRD §9.2, 부록 B) — 순수 함수. 동적 텍스트는 모두 esc() 를 거친다(불변 규칙 8).
 * 종목 링크는 호출부가 lib/links.ts 로 만든 HTML(inlineLinks)·버튼을 넘긴다(불변 규칙 7). 모든 메시지에 "매수 확정 신호 아님"(불변 규칙 3).
 */
import { esc, NOT_A_BUY_SIGNAL } from "./format";

const pct = (x: number | null | undefined, digits = 1) => (x === null || x === undefined || !Number.isFinite(x) ? "-" : `${x > 0 ? "+" : ""}${x.toFixed(digits)}%`);
const num = (x: number | null | undefined, digits = 2) => (x === null || x === undefined || !Number.isFinite(x) ? "-" : x.toLocaleString("en-US", { maximumFractionDigits: digits }));
const w = (x: number | null | undefined) => (x === null || x === undefined ? "-" : `${(x * 100).toFixed(1)}%`);
const FOOT = `<i>${esc(NOT_A_BUY_SIGNAL)}</i>`;

// ── ⚠️ 보유 경고 (부록 B.3) ───────────────────────────
export type HoldingAlertView = {
  market: "KR" | "US" | null; name: string; code: string;
  causes: { summary: string; source: string }[];
  thesisLink: string | null;                         // 훼손조건 연결 설명
  weight: number | null; allowed: number | null; heat: number | null; pri: number | null;
};

export function holdingAlertText(v: HoldingAlertView): string {
  const flag = v.market === "KR" ? "🇰🇷" : v.market === "US" ? "🇺🇸" : "";
  const lines = [
    `⚠️ <b>보유 경고</b> · ${flag} ${esc(v.name)} (${esc(v.code)})`,
    ...v.causes.map((c) => `원인: ${esc(c.summary)} <i>(${esc(c.source)})</i>`),
  ];
  if (v.thesisLink) lines.push(`연결 논지: ${esc(v.thesisLink)}`);
  lines.push(`비중 ${w(v.weight)} (허용 ${w(v.allowed)}) · 과열 ${v.heat ?? "-"} · PRI ${v.pri ?? "-"}`);
  lines.push("권장: 논지 재검토 → SnowBall 결정 기록", "", FOOT);
  return lines.join("\n");
}

// ── ☀️ 아침 / 🌙 저녁 브리핑 (부록 B.2) ───────────────
export type MarketLine = { label: string; last: number | null; change_pct: number | null; level?: boolean };
export type BriefItem = { icon: string; html: string; note: string };            // html = inlineLinks(entity)
export type BriefData = {
  kind: "morning" | "evening"; date: string;
  market: MarketLine[];
  sectors?: { label: string; change_pct: number | null }[];
  regime: { risk_off: boolean; reasons: string[] };
  counts: { green: number; yellow: number; blue: number; alert: number };
  earnings: { title: string; lines: string[] };
  items: BriefItem[];                                 // 🟢🟡🔵🎯🔭⏳ (P2: 🎯🔭⏳💰)
  holding: string[];                                  // 보유 영향·경고 요약
  schedule: { title: string; lines: string[] };
  asOf: string;                                       // 기준 시각 KST
};

export function marketLine(m: MarketLine): string {
  return m.level ? `${esc(m.label)} ${num(m.last)} (${pct(m.change_pct)})` : `${esc(m.label)} ${pct(m.change_pct)}`;
}

export function briefText(d: BriefData): string {
  const head = d.kind === "morning" ? `☀️ <b>${esc(d.date)} 아침 브리핑</b>` : `🌙 <b>${esc(d.date)} 저녁 브리핑</b>`;
  const out = [head, d.market.map(marketLine).join(" · ") || "시세 수집 실패"];
  if (d.sectors?.length) {
    const s = [...d.sectors].filter((x) => x.change_pct !== null).sort((a, b) => (b.change_pct as number) - (a.change_pct as number));
    if (s.length) out.push(`섹터 ▲ ${s.slice(0, 2).map((x) => `${esc(x.label)} ${pct(x.change_pct)}`).join(", ")} / ▼ ${s.slice(-2).reverse().map((x) => `${esc(x.label)} ${pct(x.change_pct)}`).join(", ")}`);
  }
  out.push(d.regime.risk_off ? `🔴 레짐 risk_off — ${esc(d.regime.reasons.join(", "))}` : "🟢 레짐 정상");
  out.push(`🟢 진입 ${d.counts.green} · 🟡 관찰 ${d.counts.yellow} · 🔵 돌파 ${d.counts.blue} · ⚠️ 보유 경고 ${d.counts.alert}`);
  if (d.earnings.lines.length) out.push("", `<b>${esc(d.earnings.title)}</b>`, ...d.earnings.lines.map(esc));
  if (d.items.length) out.push("", ...d.items.map((i) => `${i.icon} ${i.html} — ${esc(i.note)}`));
  if (d.holding.length) out.push("", "<b>보유</b>", ...d.holding.map(esc));
  if (d.schedule.lines.length) out.push("", `<b>${esc(d.schedule.title)}</b>`, ...d.schedule.lines.map(esc));
  out.push("", `<i>기준 ${esc(d.asOf)} KST</i>`, FOOT);
  return out.join("\n");
}

// ── 🔧 시스템 이상 ────────────────────────────────────
export function systemText(title: string, lines: string[]): string {
  return [`🔧 <b>${esc(title)}</b>`, ...lines.map(esc), "", FOOT].join("\n");
}
