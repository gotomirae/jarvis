/**
 * 진입 게이트 (PRD §7.3 "진입 게이트", §6.3 레짐) — 순수 함수. **🟢 를 막을 수만 있다(거부권).**
 *  1. 주가 반영도(국내 PRI · 미국 pri_us_lite) < pri_hard_max 재확인
 *  2. 위험 회피 국면: 국내 ★ · 미국 F1∧F3∧F4 만 허용, 1차 비중 절반
 *  3. SnowBall 허용 비중 여유가 없으면 "비중 한도"
 * 발송 선택(selectToSend): 같은 종목 14거래일 내 재발송 금지, 하루 상한(국내 2·미국 1), 우선순위 정렬. 상한 밖은 대시보드에만.
 */
import type { GateDecision } from "./entry";

export type GateRules = { pri_hard_max: number; risk_off_weight_multiplier: number; first_tranche: number; weight_capacity_required: boolean };
export type RiskOffRules = { kr_grade: string; us_filters_all: string[] };

export type GateInput = {
  market: "KR" | "US";
  p: number | null;
  riskOff: boolean;
  grade: string | null;
  usFilters: string[];
  holding: { weight: number | null; allowed_weight: number | null } | null;
};

export type GateResult = GateDecision & { first_weight_pct: number | null; weight_limited: boolean };

const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function gateDecision(x: GateInput, g: GateRules, ro: RiskOffRules): GateResult {
  const reasons: string[] = [];
  if (x.p === null) reasons.push("주가 반영도 없음");
  else if (x.p >= g.pri_hard_max) reasons.push(`주가 반영도 ${x.p} ≥ ${g.pri_hard_max}`);
  if (x.riskOff) {
    const okRo = x.market === "KR" ? x.grade === ro.kr_grade : ro.us_filters_all.every((f) => x.usFilters.includes(f));
    if (!okRo) reasons.push(x.market === "KR" ? `위험 회피 국면 — 등급 ${ro.kr_grade} 만 허용` : `위험 회피 국면 — ${ro.us_filters_all.join("·")} 모두 충족만 허용`);
  }
  const allowed = x.holding?.allowed_weight ?? null;
  const weightLimited = g.weight_capacity_required && allowed !== null && (x.holding?.weight ?? 0) >= allowed;
  if (weightLimited) reasons.push("비중 한도 — SnowBall 허용 비중 여유 없음");
  const first = allowed === null ? null : r3(allowed * 100 * g.first_tranche * (x.riskOff ? g.risk_off_weight_multiplier : 1));
  return { allowed: reasons.length === 0, reasons, first_weight_pct: first, weight_limited: weightLimited };
}

/** 오늘 이전 n 거래일(주말 제외 근사 — 휴장일은 모름)이 시작되는 날짜 */
export function tradingDaysBack(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  for (let left = n; left > 0;) {
    d.setUTCDate(d.getUTCDate() - 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}

/** 오늘 이후 n 거래일 뒤(주말 제외 근사) — 🔵 무장 기한 */
export function tradingDaysAhead(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  for (let left = n; left > 0;) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}

export type GreenCand = { entity_id: string; market: "KR" | "US"; families: number; p: number | null; m3Growth: number | null; nearestEvent: string | null; perf?: number | null };

const byPerf = (a?: number | null, b?: number | null) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : b - a);

/** 우선순위: (성과 표본 충분 시 기대 초과수익 →) 신호 계열 수 ↓ → 반영도 ↑ → 산업 실적 성장 ↓ → 가까운 이벤트 */
export function rankGreen<T extends GreenCand>(xs: T[]): T[] {
  const inf = Number.POSITIVE_INFINITY;
  return [...xs].sort((a, b) => byPerf(a.perf, b.perf) || b.families - a.families || (a.p ?? inf) - (b.p ?? inf)
    || (b.m3Growth ?? -inf) - (a.m3Growth ?? -inf) || (a.nearestEvent ?? "9999").localeCompare(b.nearestEvent ?? "9999") || a.entity_id.localeCompare(b.entity_id));
}

/**
 * 오늘 보낼 🟢 고르기. recent = 최근 🟢 발송(entity → 발송일), sentToday = 오늘 시장별 이미 보낸 수.
 * 반환: send(발송), held(상한 초과 — 대시보드만), blocked(14거래일 재발송 금지)
 */
export function selectToSend<T extends GreenCand>(cands: T[], recent: Map<string, string>, sentToday: Record<"KR" | "US", number>, today: string, caps: Record<"KR" | "US", number>, resendDays: number) {
  const since = tradingDaysBack(today, resendDays);
  const send: T[] = [], held: T[] = [], blocked: T[] = [];
  const used = { ...sentToday };
  for (const c of rankGreen(cands)) {
    const last = recent.get(c.entity_id);
    if (last && last > since) { blocked.push(c); continue; }
    if (used[c.market] >= caps[c.market]) { held.push(c); continue; }
    used[c.market]++;
    send.push(c);
  }
  return { send, held, blocked };
}
