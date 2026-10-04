/**
 * 텔레그램 메시지 템플릿 (PRD §9.2, 부록 B) — 순수 함수. 동적 텍스트는 모두 esc() 를 거친다(불변 규칙 8).
 * 종목 링크는 호출부가 lib/links.ts 로 만든 HTML(inlineLinks)·버튼을 넘긴다(불변 규칙 7). 모든 메시지에 "매수 확정 신호 아님"(불변 규칙 3).
 */
import { TAG_NAME } from "@/lib/engine/entry-view";
import type { Tag } from "@/lib/engine/entry";
import type { IdeaCard } from "@/lib/engine/idea";
import { FAMILY_NAME } from "@/lib/labels";
import type { Proposal } from "@/lib/outcomes/review";
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
    `⚠️ <b>보유 경고</b> · ${flag} <b>${esc(v.name)}</b> (${esc(v.code)})`,
    `결론: 투자 논지를 다시 확인할 때입니다${v.causes[0] ? ` — ${esc(v.causes[0].summary)}` : ""}`,
    ...v.causes.map((c) => ` · ${esc(c.summary)} (${esc(c.source)})`),
  ];
  if (v.thesisLink) lines.push(` · 연결된 투자 논지: ${esc(v.thesisLink)}`);
  lines.push(` · 비중 ${w(v.weight)} (허용 비중 ${w(v.allowed)}) · 과열 점수 ${v.heat ?? "-"} · 주가 반영도 ${v.pri === null ? "-" : Math.round(v.pri)}`);
  lines.push("할 일: 논지 재검토 → SnowBall에 결정 기록", "", FOOT);
  return lines.join("\n");
}

// ── ☀️ 아침 / 🌙 저녁 브리핑 (부록 B.2) ───────────────
export type MarketLine = { label: string; last: number | null; change_pct: number | null; level?: boolean };
/** 🎯 외 큐 요약 (이름만 — 자세한 근거는 대시보드) */
export type QueueSummary = { icon: string; label: string; names: string[] };
export type BriefData = {
  kind: "morning" | "evening"; date: string;
  market: MarketLine[];
  sectors?: { label: string; change_pct: number | null }[];
  regime: { risk_off: boolean; reasons: string[] };
  counts: { green: number; yellow: number; blue: number; alert: number };
  entries?: string[];                                 // 🟢 🟡 🔵 한 줄씩(이름·사유·텍스트 링크 — brief.ts 가 escape 해서 만든 HTML)
  alertsPaused?: boolean;                             // 보유 경고 알림 일시 정지(/alerts off)
  earnings: { title: string; lines: string[] };
  focus: "KR" | "US";                                 // 추천 대상 시장 (아침 미국 · 저녁 국내)
  ideas: IdeaCard[];                                  // 🎯 지금 사기 좋은 종목 TOP — 추천 시장 먼저 채우고 모자라면 다른 시장 (rankBuy, D53)
  buyTotal: number;                                   // 🎯 후보 전체 수 (추천 밖 종목은 대시보드)
  waiting?: { name: string; why: string }[];          // ⏸️ 좋은 기업이지만 지금은 대기(TOP 자격 미달) — D53·D54
  policy?: string | null;                             // 📐 사후 검증 요약 한 줄
  others: QueueSummary[];                             // 🔭 ⏳ 💰
  holding: string[];                                  // 보유 영향·경고 요약
  schedule: { title: string; lines: string[] };
  asOf: string;                                       // 기준 시각 KST
};

const arrow = (x: number | null) => (x === null || !Number.isFinite(x) ? "➖" : x > 0 ? "📈" : x < 0 ? "📉" : "➖");

export function marketLine(m: MarketLine): string {
  return m.level ? `${esc(m.label)} ${num(m.last)} (${pct(m.change_pct)})` : `${esc(m.label)} ${pct(m.change_pct)}`;
}

const NUM = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"];
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
/** 긴 브리핑을 나눌 때 끊을 자리: 종목 카드·구분선·섹션 제목 앞 (lib/telegram/send.ts splitBefore) */
export const BRIEF_SPLIT = /^(?:\d️⃣|\d+\. |━|👀|📣|💼|📅|🚦|⏸️ <b>)/u;
const RULE = "━━━━━━━━━━━━━━";

/** 추천 종목 카드: 이름 → 추천 이력 → 지금 매수 매력 → 아이디어 → 🏢 좋은 기업인가 → ⏱️ 지금 사기 좋은가 → 이벤트·리스크 → 링크(맨 끝 줄) */
export function ideaBlock(c: IdeaCard): string[] {
  const out = ["", `${NUM[c.rank - 1] ?? `${c.rank}.`} ${c.flag} <b>${esc(c.name)}</b> (${esc(c.code)})${c.industry ? ` · ${esc(c.industry)}` : ""}`];
  if (c.history) out.push(esc(c.history));
  if (c.verdict) out.push(`<b>${esc(c.verdict)}</b>`);
  if (c.thesis) out.push("", "💡 <b>투자 아이디어</b>", esc(c.thesis));
  if (c.reasons.length) out.push("", "🏢 <b>좋은 기업인가</b>", ...c.reasons.map(esc));
  if (c.timing?.length) out.push("", "⏱️ <b>지금 사기 좋은가</b>", ...c.timing.map(esc));
  if (c.events.length || c.risk || c.tech || c.perf) out.push("");
  if (c.events.length) out.push(`⏰ 다음 확인: ${c.events.map(esc).join(" / ")}`);
  if (c.risk) out.push(`⚠️ 리스크: ${esc(c.risk)}`);
  if (c.tech) out.push(`📊 기술적 참고(판정 미사용): ${esc(c.tech)}`);
  if (c.perf) out.push(`🧾 과거 성과: ${esc(c.perf)}`);
  if (c.links) out.push(c.links);
  return out;
}

export function briefText(d: BriefData): string {
  const dow = DOW[new Date(`${d.date}T00:00:00Z`).getUTCDay()] ?? "";
  const head = d.kind === "morning" ? "☀️ <b>JARVIS 아침 브리핑</b>" : "🌙 <b>JARVIS 저녁 브리핑</b>";
  const out = [head, `📆 ${esc(d.date)}${dow ? ` (${dow})` : ""}`, "", RULE, `🌎 <b>${d.kind === "morning" ? "밤사이 미국 시장" : "오늘 국내 시장"}</b>`, RULE];
  if (d.market.length) out.push(...d.market.map((m) => `${arrow(m.change_pct)} ${marketLine(m)}`));
  else out.push("시세 수집 실패");
  if (d.sectors?.length) {
    const s = [...d.sectors].filter((x) => x.change_pct !== null).sort((a, b) => (b.change_pct as number) - (a.change_pct as number));
    if (s.length) out.push("", `💪 강한 섹터: ${s.slice(0, 2).map((x) => `${esc(x.label)} ${pct(x.change_pct)}`).join(" · ")}`, `🥶 약한 섹터: ${s.slice(-2).reverse().map((x) => `${esc(x.label)} ${pct(x.change_pct)}`).join(" · ")}`);
  }
  out.push("", d.regime.risk_off ? `🔴 <b>시장 국면: 위험 회피</b>\n   ↳ ${esc(d.regime.reasons.join(", "))} (진입 1차 비중 절반)` : "🟢 <b>시장 국면: 정상</b>");
  out.push("", "🚦 <b>오늘의 신호</b>", `🟢 진입 ${d.counts.green} · 🟡 관찰 ${d.counts.yellow} · 🔵 실적 돌파 ${d.counts.blue} · ⚠️ 보유 경고 ${d.counts.alert}${d.alertsPaused ? " (⏸ 알림 정지 중)" : ""}`);
  if (d.entries?.length) out.push(...d.entries);

  const where = d.focus === "US" ? "🇺🇸 미국 우선" : "🇰🇷 국내 우선";
  out.push("", RULE, `🎯 <b>매수 검토 추천</b> · ${where}`,
    d.ideas.length ? `✨ 지금 사기 좋은 종목 <b>TOP ${d.ideas.length}</b> (후보 ${d.buyTotal}개 중)` : `✨ 오늘은 지금 사기 좋은 종목이 없습니다${d.buyTotal ? ` (후보 ${d.buyTotal}개 모두 타이밍 대기)` : ""}`);
  if (d.policy) out.push(`📐 ${esc(d.policy)}`);
  out.push(RULE);
  for (const c of d.ideas) out.push(...ideaBlock(c));

  const wait = d.waiting ?? [];
  if (wait.length) {
    out.push("", `⏸️ <b>좋은 기업이지만 지금은 대기</b> (${wait.length})`);
    for (const w of wait.slice(0, 6)) out.push(`· ${esc(w.name)}${w.why ? ` — ${esc(w.why)}` : ""}`);
    if (wait.length > 6) out.push(`· 외 ${wait.length - 6}개 (대시보드)`);
  }
  const others = d.others.filter((o) => o.names.length);
  if (others.length) {
    out.push("", "👀 <b>그 밖의 관찰 종목</b> (자세한 근거는 대시보드)");
    for (const o of others) out.push(`${esc(o.icon)} ${esc(o.label)} ${o.names.length}: ${o.names.slice(0, 6).map(esc).join(" · ")}${o.names.length > 6 ? " 외" : ""}`);
  }
  if (d.earnings.lines.length) out.push("", `📣 <b>${esc(d.earnings.title)}</b>`, ...d.earnings.lines.map((l) => `· ${esc(l)}`));
  if (d.holding.length) out.push("", "💼 <b>보유</b>", ...d.holding.map(esc));
  if (d.schedule.lines.length) out.push("", `📅 <b>${esc(d.schedule.title)}</b>`, ...d.schedule.lines.map((l) => `· ${esc(l)}`));
  out.push("", `🕒 <i>기준 ${esc(d.asOf)} KST</i>`, FOOT);
  return out.join("\n");
}

// ── 🔧 시스템 이상 ────────────────────────────────────
export function systemText(title: string, lines: string[]): string {
  return [`🔧 <b>${esc(title)}</b>`, ...lines.map(esc), "", FOOT].join("\n");
}

export type QueuePerf = { label: string; n: number; median_excess: number | null; hit_rate: number | null; ranking_active: boolean };

/** 📊 분기 신호원 성적표 + 보정 제안 (PRD §12·§14, D49) — 제안만, 적용은 사용자 승인 후 */
export function calibrationText(period: string, horizon: number, queues: QueuePerf[], proposals: Proposal[], url?: string): string {
  const out = [`📊 <b>${esc(period)} 신호 성적표 · 보정 제안</b>`, "", `<b>큐별 ${horizon}거래일 뒤 시장 대비 초과수익(중앙값)</b>`];
  if (!queues.length) out.push("아직 측정이 끝난 신호가 없습니다.");
  for (const q of queues) out.push(`${esc(q.label)}: ${pct(q.median_excess, 2)}${q.hit_rate === null ? "" : ` · 이긴 비율 ${Math.round(q.hit_rate * 100)}%`} (${q.n}건${q.ranking_active ? " · 추천 순위 반영 중" : " · 표본 부족"})`);
  out.push("", `<b>보정 제안 ${proposals.length}건</b>${proposals.length ? " — 자동 적용하지 않습니다. 승인하면 설정 변경과 결정 기록을 남깁니다." : " — 바꿀 근거가 충분하지 않습니다(표본 30건 미만 구간은 비교하지 않음)."}`);
  proposals.forEach((p, i) => {
    out.push(`${i + 1}. ${p.kind === "threshold" ? "🔧" : "ℹ️"} ${esc(p.title)}${p.rule ? ` — ${esc(String(p.current))} → ${esc(String(p.suggested))}` : ""}`, `   근거: ${esc(p.evidence)}`);
  });
  if (url) out.push("", `<a href="${esc(url)}">대시보드 성적표 보기</a>`);
  out.push("", FOOT);
  return out.join("\n");
}

// ── 🟢 진입 신호 (부록 B.1, D38 약어 없이) ───────────────
export type GreenView = {
  market: "KR" | "US"; name: string; code: string; tag: Tag | null;
  families: string[]; p: number | null;
  lines: string[];                     // lib/engine/entry-view condLines
  invalidation: string | null; firstWeightPct: number | null; riskOff: boolean;
};

export function greenText(v: GreenView): string {
  const flag = v.market === "KR" ? "🇰🇷" : "🇺🇸";
  const head = `🟢 <b>진입 신호</b>${v.tag ? ` · ${esc(TAG_NAME[v.tag])}` : ""} · ${flag} <b>${esc(v.name)}</b> (${esc(v.code)})`;
  const fam = v.families.map((f) => FAMILY_NAME[f] ?? f).join(" · ");
  const out = [head, `합의한 신호: ${esc(fam || "-")} · 주가 반영도 ${v.p === null ? "-" : Math.round(v.p)}${v.market === "US" ? "(간이)" : ""}`, "━━━━ 필수 조건 5개 ━━━━", ...v.lines.map(esc), "━━━━━━━━━━━━━━"];
  const weight = v.firstWeightPct === null ? "1차 비중: SnowBall 허용 비중의 1/3" : `1차 비중 ${v.firstWeightPct.toFixed(1)}%(허용 비중의 1/3${v.riskOff ? " · 위험 회피 국면이라 절반" : ""})`;
  out.push(`무효화: 종가 < ${esc(v.invalidation ?? "-")} · ${weight}`);
  out.push("분할 진입: 1차 → 무효화선 위 5거래일 유지·20일선 회복 시 2차 → 다음 실적 확인 시 3차");
  if (v.market === "US") out.push("※ 미국 수급은 투자자별 자료가 없어 대용 지표(종가 상승·거래량)입니다");
  out.push("", FOOT);
  return out.join("\n");
}

// ── 🏛️ 주간 투자위원회 요약 (PRD §10.4 ④) ───────────────
export type WeeklyView = {
  week: string; range: string; stance: string; market: string[]; krTop: string[]; krBottom: string[]; buy: string[];
  scenarios: { name: string; probability: number }[]; decisions: string[]; grounded: boolean; note: string | null; flywheel: string;
  url: string | null; notionUrl: string | null;
};

export function weeklyText(v: WeeklyView): string {
  const out = [`🏛️ <b>JARVIS 주간 투자위원회 ${esc(v.week)}</b>`, esc(v.range), "", `🧭 ${esc(v.stance)}`, `📈 ${v.market.map(esc).join(" · ")}`];
  if (v.krTop.length) out.push(`🏭 국내 산업 ▲ ${v.krTop.map(esc).join(", ")}${v.krBottom.length ? ` / ▼ ${v.krBottom.map(esc).join(", ")}` : ""}`);
  out.push(`🎯 매수 검토: ${v.buy.length ? v.buy.map(esc).join(" · ") : "없음"}`);
  if (v.scenarios.length) out.push(`🔮 시나리오: ${v.scenarios.map((s) => `${esc(s.name)} ${s.probability}%`).join(" · ")}`);
  if (v.decisions.length) out.push("", "<b>이번 주말 결정할 것</b>", ...v.decisions.map((d, i) => `${i + 1}. ${esc(d)}`));
  if (!v.grounded) out.push("", `⚠️ ${esc(v.note ?? "서술 없이 표·목록만 발행")}`);
  out.push("", `📚 ${esc(v.flywheel)}`);
  const links = [v.url && `<a href="${esc(v.url)}">대시보드 전문</a>`, v.notionUrl && `<a href="${esc(v.notionUrl)}">노션</a>`].filter(Boolean);
  if (links.length) out.push(`🔗 ${links.join(" · ")}`);
  out.push("", FOOT);
  return out.join("\n");
}
