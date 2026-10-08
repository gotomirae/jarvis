/**
 * 진입 판정 근거 → 사람이 읽는 줄 (PRD 부록 B.1, D38 약어 없이) — 순수 함수. 텔레그램 🟢 메시지·/entry 화면 공용.
 * 원 프로젝트 detail 필드가 없으면 그 조각만 생략한다(부분 결측 방어).
 */
import type { Conds, Tag } from "./entry";

export const TAG_NAME: Record<Tag, string> = { PB: "눌림", SW: "횡보", CU: "캐치업", PEAD_PB: "실적 돌파 후 눌림" };
export const COND_NAME = { m1: "① 실적 가속 또는 영익 턴어라운드, 주가 미반영", m2: "② MACD 상향 교차 직전", m3: "③ 산업 고성장", m4: "④ 6개월 내 상승 이벤트", m5: "⑤ 매수 수급 2일 연속" } as const;

type D = Record<string, unknown> | null | undefined;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pair = (v: unknown): [number, number] | null => (Array.isArray(v) && num(v[0]) !== null && num(v[1]) !== null ? [v[0] as number, v[1] as number] : null);
const sg = (x: number, d = 1) => `${x > 0 ? "+" : ""}${x.toFixed(d)}`;

export function m1Text(d: D): string {
  if (!d) return "";
  const out: string[] = [];
  const rev = pair(d.rev_yoy), op = pair(d.op_yoy);
  const profit = d.profit_basis === "eps" ? "주당순이익" : "영업이익";
  if (d.earnings_path === "turnaround") {   // 원 프로젝트가 영업이익 턴어라운드 경로로 통과시킨 경우(D68, INTEGRATION_TASKS L)
    out.push(`${profit} 흑자 전환(턴어라운드)`);
    const r0 = rev?.[0] ?? (Array.isArray(d.rev_yoy) ? num(d.rev_yoy[0]) : null);
    if (r0 !== null) out.push(`매출 전년 대비 ${sg(r0)}%`);
  } else {
    if (rev) out.push(`매출 전년 대비 ${sg(rev[1])}→${sg(rev[0])}%`);
    if (op) out.push(`${profit} 전년 대비 ${sg(op[1])}→${sg(op[0])}%`);
  }
  const pe = num(d.drawdown_from_post_earnings_high), hi = num(d.drawdown_from_52w_high);
  if (d.price_state === "PB") {
    if (pe !== null && pe <= -10) out.push(`실적 발표 후 고점 대비 ${sg(pe)}%`);
    else if (hi !== null) out.push(`52주 고점 대비 ${sg(hi)}%`);
  } else if (d.price_state === "SW") {
    const rg = num(d.range_20d_pct) ?? num(d.range_20d), rt = num(d.ret_20d_pct) ?? num(d.ret_20d);
    if (rg !== null) out.push(`20일 가격 범위 ${rg.toFixed(1)}%${rt !== null ? ` · 20일 수익률 ${sg(rt)}%` : ""}`);
  }
  return out.join(" · ");
}

export function m2Text(d: D): string {
  if (!d) return "";
  if (d.cross_today === true) return "오늘 상향 교차";
  const out: string[] = [];
  const gap = num(d.gap_pct_of_close), bars = num(d.projected_bars), rising = num(d.hist_rising_bars);
  if (gap !== null) out.push(`시그널까지 종가의 ${Math.abs(gap).toFixed(2)}%`);
  if (rising !== null && rising > 0) out.push(`막대 ${rising}일 연속 개선`);
  else if (d.hist_rising_2d === true) out.push("막대 2일 연속 개선");
  if (bars !== null) out.push(`예상 교차 ${Math.ceil(bars)}봉 뒤`);
  return out.join(" · ");
}

const FLOW: Record<string, string> = { foreign: "외국인", institution: "기관", combined: "외국인+기관" };
export function m5Text(d: D): string {
  if (!d) return "";
  const days = num(d.streak_days);
  if (typeof d.path === "string" && FLOW[d.path]) return `${FLOW[d.path]} ${days ?? 2}일 연속 순매수`;
  if (d.label) return `${String(d.label)} — 종가 상승·거래량 평균 이상 ${days ?? 2}일 연속`;
  return days ? `${days}일 연속` : "";
}

export type ViewEvidence = {
  m1: D; m2: D; m5: D;
  m3_lines?: string[];
  m4_events?: { when: string; title: string; source: string }[];
};

/** 다섯 조건 줄 — ✅/❌ + 이름 + 근거(통과) 또는 사유(미통과) */
export function condLines(c: Conds, ev: ViewEvidence): string[] {
  const body = {
    m1: m1Text(ev.m1), m2: m2Text(ev.m2), m5: m5Text(ev.m5),
    m3: (ev.m3_lines ?? []).join(" · "),
    m4: (ev.m4_events ?? []).slice(0, 2).map((e) => `${e.when} ${e.title} (${e.source})`).join(" · "),
  };
  return (["m1", "m2", "m3", "m4", "m5"] as const).map((k) => {
    const pass = c[k].pass;
    const text = pass ? body[k] : c[k].reason ?? body[k];
    return `${pass ? "✅" : "❌"} ${COND_NAME[k]}${text ? ` — ${text}` : ""}`;
  });
}

/** 가격 표기 */
export function priceText(v: number | null, market: "KR" | "US"): string {
  if (v === null) return "-";
  return market === "KR" ? `${Math.round(v).toLocaleString("en-US")}원` : `$${v.toFixed(2)}`;
}

export const INVALIDATION_BASIS: Record<Tag, string> = { PB: "10일 최저가", SW: "20일 최저가", CU: "캐치업 무효화선", PEAD_PB: "돌파일 저가" };
