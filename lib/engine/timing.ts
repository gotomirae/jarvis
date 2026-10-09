/**
 * ⏱️ "지금 사기 좋은가" — 좋은 기업(실적·산업·합의)과 분리한 가격·타이밍 판정 (사용자 지정 2026-10-04, D53). 순수 함수·결정론 규칙.
 *  · 좋은 기업이어도 이미 많이 오르거나 과열·추세 이탈·수급 이탈이면 "지금은 대기" — 투자하기 좋은 주식만 TOP 추천에 올린다.
 *  · 점수·임계값은 rules.yaml `buy_timing`. 🎯 추천 선별·순위·표시 전용 — 🟢 진입 신호(M1~M5, lib/engine/entry.ts)와 무관(불변 규칙 4).
 *  · 자료가 없는 항목은 0점(➖ 자료 없음) — 없는 자료를 좋게도 나쁘게도 보지 않는다.
 *  · 🎯 필수 조건(setup — 상승 초기 진입, 사용자 지정 10/8 → 10/9 D69):
 *      MACD 시그널 상향 돌파 직전·직후  그리고  주가 위치 둘 중 하나
 *        A. 5일선이 10일선 상향 돌파 직전·직후(3거래일 이내) + 고점 대비 눌림(신고가 추격 방지)
 *        B. 고점 대비 10~20% 조정 후 10거래일 이상 횡보
 *    아니면 TOP 추천 제외(pick-policy.admits). 주가 반영도는 보정 중이라 점수 비중을 p_weight 로 낮춘다.
 */
import type { ChartRef, CrossState } from "./technicals";

/** 수급: 국내 = 네이버 종목별 투자자 동향(일별 순매수 수량, 오래된 날 → 최신) · 미국 = HermesCall 매집일 대용(D15) */
export type FlowRef =
  | { kind: "investor"; as_of: string; dates: string[]; foreign: number[]; institution: number[] }
  | { kind: "proxy"; as_of: string; pass: boolean; streak: number };

export type TimingRules = {
  p: { great_max: number; good_max: number };
  p_weight: number;                                    // 주가 반영도 점수 배율 (보정 중 → 작게, 10/8)
  setup: { require: boolean; just_after_days: number; base: { drawdown_min_pct: number; drawdown_max_pct: number; days_min: number } }; // 🎯 필수 조건 · 상향 돌파 후 N거래일 이내 = "바로 직후" · B 조정 후 횡보
  position: { chase_above_pct: number; deep_below_pct: number };
  rsi: { overheat_min: number; near_hot_min: number; rebound_max: number };
  flow_days: number;
  event_within_days: number;
  points: {
    p_great: number; p_good: number; p_high: number;
    pullback: number; chase: number; deep: number;
    rsi_hot: number; rsi_rebound: number;
    cross: number; trend_down: number; base: number;
    flow_buy: number; flow_proxy: number; flow_sell: number;
    event: number; risk_off: number;
  };
  verdict: { high_min: number; mid_min: number };
};

export type CheckKey = "p" | "position" | "rsi" | "macd" | "ma" | "base" | "flow" | "event" | "regime";
export type Mark = "pass" | "warn" | "fail" | "none";
export type Check = { key: CheckKey; mark: Mark; pts: number; text: string };
export type Verdict = "high" | "mid" | "wait";
/** 주가 위치 경로 — A 5·10일선 돌파(ma) · B 조정 후 횡보(base) · 둘 다(both) */
export type SetupPath = "ma" | "base" | "both";
export type Setup = { required: boolean; ok: boolean; why: string[]; path: SetupPath | null; parts: { pullback: boolean; ma: CrossPhase; base: boolean; macd: CrossPhase } | null };
export type Timing = { score: number; verdict: Verdict; checks: Check[]; setup: Setup };
/** 상향 돌파 국면 — 직전(pre) · 오늘(today) · 직후 N일 이내(post) · 아님(no) */
export type CrossPhase = "pre" | "today" | "post" | "no";

export const MARK_ICON: Record<Mark, string> = { pass: "✅", warn: "⚠️", fail: "❌", none: "➖" };
export const VERDICT_NAME: Record<Verdict, string> = { high: "🔥 지금 매수 매력 높음", mid: "⚖️ 분할 접근 가능", wait: "⏸️ 좋은 기업이지만 지금은 대기" };
export const VERDICT_SHORT: Record<Verdict, string> = { high: "🔥 매력 높음", mid: "⚖️ 분할 접근", wait: "⏸️ 대기" };
export const CHECK_NAME: Record<CheckKey, string> = { p: "주가 반영도", position: "고점 대비 위치", rsi: "RSI 과열", macd: "MACD 추세", ma: "5일·10일선", base: "조정 후 횡보", flow: "외국인·기관 수급", event: "가까운 상승 이벤트", regime: "시장 국면" };
export const PATH_NAME: Record<SetupPath, string> = { ma: "A 5·10일선 돌파", base: "B 조정 후 횡보", both: "A+B" };

const money = (v: number, c: ChartRef["currency"]) => (c === "KRW" ? `${Math.round(v).toLocaleString("en-US")}원` : `$${v.toFixed(2)}`);
const pct1 = (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(1)}%`;
const ymd = (d: string) => d.slice(2).replace(/-/g, "/");
const short = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/** 걸린(⚠️·❌) 항목 요약 — "RSI 75 → 과열권 · 52주 최고가 경신 중" (대기 이유 표시용) */
export const issues = (t: Timing): string => t.checks.filter((k) => k.mark === "fail" || k.mark === "warn").map((k) => k.text.split(" — ")[0].replace(/ \(.*$/, "")).join(" · ");

/** 최신일부터 같은 부호가 이어진 일수 — 순매수 연속이면 +N, 순매도 연속이면 −N, 0 이면 0 */
export function streakOf(xs: number[]): number {
  const last = xs[xs.length - 1];
  if (!last) return 0;
  let n = 0;
  for (let i = xs.length - 1; i >= 0 && Math.sign(xs[i]) === Math.sign(last); i--) n++;
  return last > 0 ? n : -n;
}

/** 수량 표기: 12,345 → "+1.2만", 980 → "+980" */
export function qty(x: number): string {
  const s = x > 0 ? "+" : x < 0 ? "-" : "";
  const a = Math.abs(x);
  return a >= 10000 ? `${s}${(a / 10000).toFixed(1)}만` : `${s}${a.toLocaleString("en-US")}`;
}

const streakWord = (who: string, s: number) => (s > 0 ? `${who} ${s}일 연속 순매수` : s < 0 ? `${who} ${-s}일 연속 순매도` : `${who} 보합`);

/** 수급 줄 — 외국인 또는 기관이 flow_days 이상 연속 순매수면 ✅ (사용자 지정 매수 근거) */
export function flowCheck(f: FlowRef | null | undefined, r: TimingRules): Check {
  if (!f) return { key: "flow", mark: "none", pts: 0, text: "외국인·기관 수급 자료 없음" };
  if (f.kind === "proxy") {
    return f.pass
      ? { key: "flow", mark: "pass", pts: r.points.flow_proxy, text: `매집일 ${f.streak}일 연속(종가 상승·거래량 평균 이상) — 미국은 투자자별 수급 미공개라 대용 지표` }
      : { key: "flow", mark: "none", pts: 0, text: "매집일 연속 아님 (미국 대용 지표)" };
  }
  const fs = streakOf(f.foreign), is = streakOf(f.institution);
  const recent = (xs: number[]) => xs.slice(-3).map(qty).join("·");
  const detail = `외국인 ${recent(f.foreign)}주 / 기관 ${recent(f.institution)}주 (최근 ${Math.min(3, f.foreign.length)}일, ${ymd(f.as_of)} 기준)`;
  const buyers = [fs >= r.flow_days && `외국인 ${fs}일`, is >= r.flow_days && `기관 ${is}일`].filter(Boolean);
  if (buyers.length) return { key: "flow", mark: "pass", pts: r.points.flow_buy, text: `${buyers.join("·")} 연속 순매수 — ${detail}` };
  if (fs <= -r.flow_days && is <= -r.flow_days) return { key: "flow", mark: "fail", pts: r.points.flow_sell, text: `외국인·기관 모두 연속 순매도 — ${detail}` };
  return { key: "flow", mark: "none", pts: 0, text: `연속 순매수 아님 (${streakWord("외국인", fs)} · ${streakWord("기관", is)}) — ${detail}` };
}

export function crossPhase(x: { state: CrossState; streak: number } | null | undefined, justAfter: number): CrossPhase {
  if (!x) return "no";
  return x.state === "near" ? "pre" : x.state === "cross_today" ? "today" : x.state === "above" && x.streak <= justAfter ? "post" : "no";
}

function crossCheck(key: "macd" | "ma", state: CrossState, streak: number, widening: boolean, label: string, r: TimingRules): Check {
  if (state === "cross_today") return { key, mark: "pass", pts: r.points.cross, text: `${label} 오늘 상향 돌파 — 추세 전환` };
  if (state === "near") return { key, mark: "pass", pts: r.points.cross, text: `${label} 상향 돌파 직전 — 추세 전환 임박` };
  if (state === "above" && streak <= r.setup.just_after_days) return { key, mark: "pass", pts: r.points.cross, text: `${label} 상향 돌파 ${streak}일째 — 상승 초기` };
  if (state === "above") return { key, mark: "none", pts: 0, text: `${label} 이미 위 — 상승 추세 유지` };
  return widening
    ? { key, mark: "fail", pts: r.points.trend_down, text: `${label} 아래로 벌어지는 중 — 하락 추세` }
    : { key, mark: "none", pts: 0, text: `${label} 아래지만 좁혀지는 중` };
}

/** B 조정 후 횡보 — 고점 대비 drawdown_max~min(−10~−20%) 이고 최근 days_min(10)거래일 이상 좁은 폭에서 횡보 (D69) */
export function isBase(c: ChartRef, r: TimingRules): boolean {
  const b = r.setup.base, dd = c.high.drawdown_pct;
  return !!c.base && c.base.days >= b.days_min && dd <= b.drawdown_max_pct && dd >= b.drawdown_min_pct;
}

function baseCheck(c: ChartRef, r: TimingRules): Check {
  const b = r.setup.base, days = c.base?.days ?? 0, dd = c.high.drawdown_pct;
  const band = `${Math.abs(b.drawdown_max_pct)}~${Math.abs(b.drawdown_min_pct)}%`;
  if (isBase(c, r)) return { key: "base", mark: "pass", pts: r.points.base, text: `고점 대비 ${pct1(dd)} 조정 후 ${days}거래일 횡보 (폭 ${c.base!.range_pct.toFixed(1)}%) — 바닥 다지기` };
  return { key: "base", mark: "none", pts: 0, text: `조정 후 횡보 아님 (고점 대비 ${pct1(dd)} · 횡보 ${days}거래일 — 기준 ${band} 조정 + ${b.days_min}거래일 이상)` };
}

export type TimingInput = { p: number | null; chart: ChartRef | null | undefined; flow: FlowRef | null | undefined; eventDays: number | null; eventTitle?: string | null; riskOff: boolean };

export function timingOf(x: TimingInput, r: TimingRules): Timing {
  const P = r.points;
  const checks: Check[] = [];
  if (x.p === null) checks.push({ key: "p", mark: "none", pts: 0, text: "주가 반영도 계산 전" });
  else {
    const v = Math.round(x.p);
    const w = r.p_weight;
    checks.push(x.p < r.p.great_max ? { key: "p", mark: "pass", pts: P.p_great * w, text: `주가 반영도 ${v}/100 — 실적에 비해 주가가 크게 덜 오름` }
      : x.p < r.p.good_max ? { key: "p", mark: "pass", pts: P.p_good * w, text: `주가 반영도 ${v}/100 — 실적에 비해 주가가 덜 오름` }
      : { key: "p", mark: "fail", pts: P.p_high * w, text: `주가 반영도 ${v}/100 — 이미 많이 반영됨` });
  }
  const c = x.chart;
  if (!c) checks.push({ key: "position", mark: "none", pts: 0, text: "가격 자료 없음" });
  else {
    const dd = c.high.drawdown_pct;
    const where = `(52주 최고 ${money(c.high.value, c.currency)} · ${ymd(c.high.date)}, 현재 ${money(c.close, c.currency)})`;
    checks.push(c.high.days === 0 ? { key: "position", mark: "warn", pts: P.chase, text: `52주 최고가 경신 중 (현재 ${money(c.close, c.currency)}) — 추격 매수 주의` }
      : dd > r.position.chase_above_pct ? { key: "position", mark: "warn", pts: P.chase, text: `고점 대비 ${pct1(dd)} — 고점 근처, 추격 매수 주의 ${where}` }
      : dd < r.position.deep_below_pct ? { key: "position", mark: "warn", pts: P.deep, text: `고점 대비 ${pct1(dd)} — 낙폭이 커 하락 추세 확인 필요 ${where}` }
      : { key: "position", mark: "pass", pts: P.pullback, text: `고점 대비 ${pct1(dd)} 눌림 — 싸게 살 구간 ${where}` });
    if (c.rsi) {
      const v = Math.floor(c.rsi.value);   // 69.6 을 "70"으로 올려 과열처럼 보이지 않게 내림 표시
      const dir = c.rsi.dir === "up" ? "↗" : c.rsi.dir === "down" ? "↘" : "→";
      checks.push(c.rsi.value >= r.rsi.overheat_min ? { key: "rsi", mark: "fail", pts: P.rsi_hot, text: `RSI ${v} ${dir} 과열권 — 단기 급등, 식은 뒤 접근` }
        : c.rsi.value >= r.rsi.near_hot_min ? { key: "rsi", mark: "warn", pts: 0, text: `RSI ${v} ${dir} 과열 근접 (${r.rsi.overheat_min} 이상 과열) — 급하게 따라 사지 않기` }
        : c.rsi.value <= r.rsi.rebound_max && c.rsi.dir === "up" ? { key: "rsi", mark: "pass", pts: P.rsi_rebound, text: `RSI ${v} ${dir} 낮은 곳에서 반등 시작 (${c.rsi.days}일 전 ${Math.floor(c.rsi.prev)})` }
        : { key: "rsi", mark: "none", pts: 0, text: `RSI ${v} ${dir} 과열 아님` });
    }
    if (c.macd) checks.push(crossCheck("macd", c.macd.state, c.macd.streak, !c.macd.improving, "MACD가 시그널선", r));
    if (c.ma) checks.push(crossCheck("ma", c.ma.state, c.ma.streak, c.ma.streak === 0, `${c.ma.n[0]}일선이 ${c.ma.n[1]}일선`, r));
    if (c.base) checks.push(baseCheck(c, r));
  }
  checks.push(flowCheck(x.flow, r));
  checks.push(x.eventDays !== null && x.eventDays >= 0 && x.eventDays <= r.event_within_days
    ? { key: "event", mark: "pass", pts: P.event, text: `상승 이벤트 D-${x.eventDays}${x.eventTitle ? ` (${short(x.eventTitle, 40)})` : ""}` }
    : { key: "event", mark: "none", pts: 0, text: `${r.event_within_days}일 안 상승 이벤트 없음` });
  if (x.riskOff) checks.push({ key: "regime", mark: "warn", pts: P.risk_off, text: "시장 위험 회피 국면 — 나눠서 적게" });
  const score = checks.reduce((a, k) => a + k.pts, 0);
  return { score, verdict: score >= r.verdict.high_min ? "high" : score >= r.verdict.mid_min ? "mid" : "wait", checks, setup: setupOf(c, checks, r) };
}

const PHASE_WORD: Record<CrossPhase, string> = { pre: "돌파 직전", today: "오늘 돌파", post: "돌파 직후", no: "아님" };

/**
 * 🎯 필수 조건 (상승 초기 진입, D65 → D69): MACD 상향 돌파 직전·직후 ∧ 주가 위치(A ∨ B)
 *   A = 5·10일선 상향 돌파 직전·직후(just_after_days 이내) ∧ 고점 대비 눌림   B = 조정 후 횡보(isBase)
 */
export function setupOf(c: ChartRef | null | undefined, checks: Check[], r: TimingRules): Setup {
  if (!c) return { required: r.setup.require, ok: false, why: ["가격 자료 없음"], path: null, parts: null };
  const parts = { pullback: checks.some((k) => k.key === "position" && k.mark === "pass"), ma: crossPhase(c.ma, r.setup.just_after_days), base: isBase(c, r), macd: crossPhase(c.macd, r.setup.just_after_days) };
  const a = parts.ma !== "no" && parts.pullback;
  const path: SetupPath | null = a && parts.base ? "both" : a ? "ma" : parts.base ? "base" : null;
  const why: string[] = [];
  const maName = c.ma ? `${c.ma.n[0]}·${c.ma.n[1]}일선` : "이동평균선";
  if (!path) {
    const aWhy = parts.ma === "no" ? `${maName} 상향 돌파 직전·직후 아님` : `${maName} ${PHASE_WORD[parts.ma]}이지만 고점 대비 눌림 아님(${c.high.days === 0 ? "신고가" : pct1(c.high.drawdown_pct)})`;
    const b = r.setup.base;
    const bWhy = `조정 후 횡보 아님(고점 대비 ${pct1(c.high.drawdown_pct)} · 횡보 ${c.base?.days ?? 0}일, 기준 ${Math.abs(b.drawdown_max_pct)}~${Math.abs(b.drawdown_min_pct)}% 조정 + ${b.days_min}일)`;
    why.push(`주가 위치: ${aWhy} / ${bWhy}`);
  }
  if (parts.macd === "no") why.push("MACD 시그널 상향 돌파 직전·직후 아님");
  return { required: r.setup.require, ok: why.length === 0, why, path, parts };
}

/** 필수 조건 한 줄 — "✅ 상승 초기 조건 — ✅ 주가 위치 A 5·10일선 돌파 직전 · ✅ MACD 돌파 직후" */
export function setupLine(t: Timing): string {
  const s = t.setup;
  if (!s.parts) return `❌ 상승 초기 조건 — ${s.why.join(" · ")}`;
  const p = s.parts;
  const pos = s.path === "base" ? "✅ 주가 위치 B 조정 후 횡보"
    : s.path ? `✅ 주가 위치 A 5·10일선 ${PHASE_WORD[p.ma]}${s.path === "both" ? " + B 조정 후 횡보" : ""}`
    : `❌ 주가 위치(A 5·10일선 ${PHASE_WORD[p.ma]}${p.ma !== "no" && !p.pullback ? "·눌림 아님" : ""} / B 횡보 아님)`;
  const body = [pos, `${p.macd !== "no" ? "✅" : "❌"} MACD ${PHASE_WORD[p.macd]}`].join(" · ");
  return `${s.ok ? "✅" : "❌"} 상승 초기 조건 — ${body}`;
}

/** 표시 줄: "✅ 주가 반영도 33/100 — …" */
export const checkLines = (t: Timing): string[] => t.checks.map((k) => `${MARK_ICON[k.mark]} ${k.text}`);

/** 원장 특징용 요약 — { p: "pass", rsi: "fail", … } */
export const checkMarks = (t: Timing): Record<string, Mark> => Object.fromEntries(t.checks.map((k) => [k.key, k.mark]));

/** 다음 이벤트까지 일수 (YYYY-MM-DD 기준, 없으면 null) */
export function daysUntil(date: string | null | undefined, today: string): number | null {
  if (!date) return null;
  return Math.round((new Date(`${date.slice(0, 10)}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86400_000);
}
