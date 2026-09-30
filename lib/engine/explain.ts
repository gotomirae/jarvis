/**
 * 결론·근거 문장 만들기 — 텔레그램 브리핑과 대시보드가 같은 함수를 쓴다(약어 없이 쉬운 말).
 * 판정은 하지 않는다. 이미 계산된 축·큐·참고 기술 지표를 사람이 읽는 문장으로 바꿀 뿐이다.
 */
import type { IdeaEvidence } from "./idea";
import type { Queue } from "./queues";

/** 축 이름 (약어 대신) */
export const AXIS_NAME = {
  n: "산업·종목 이야기", c: "실적 촉매", f: "실적 숫자", p: "주가 반영도", h: "보유",
} as const;

export const PROJECT_NAME: Record<string, string> = {
  flywheel: "FlyWheel", sage: "Sage", hermescall: "HermesCall", heimdallr: "Heimdallr", snowball: "SnowBall",
};

/** 신호 한 건을 쉬운 말로 */
export function describeSignal(kind: string, strength: number, ev: Record<string, unknown>): string {
  switch (kind) {
    case "industry_narrative": return `FlyWheel ${ev.l2 ?? "산업"} 흐름 강도 ${ev.signal_strength ?? Math.round(strength / 2)}/5`;
    case "company_mention_fw": return `FlyWheel 위키 최근 14일 언급 ${ev.mentions_14d ?? "?"}건`;
    case "mentor_consensus": { const b = (ev.bullish as string[] | undefined)?.length; return `Sage 멘토 ${b ?? "?"}명 강세${ev.scope === "industry" ? "(산업 전체)" : ""}`; }
    case "earnings_catalyst": return `HermesCall ${ev.leader ?? "미국 대장주"} 실적 수혜 강도 ${strength}/10`;
    default: return `${kind} ${strength}`;
  }
}

export type TechRef = { source: string; as_of: string | null; rsi: number | null; rsi_note: string | null; macd_note: string | null; price_note: string | null };
export type AxesEvidence = {
  N?: { kind: string; strength: number; detail?: string }[];
  C?: { catalyst: { strength: number; detail?: string } | null; us_filters: string[] };
  F?: { gate_passed?: boolean | null; score?: number | null; grade?: string | null; us_filters?: string[] };
  P?: { value: number | null; basis: string };
  families?: string[];
  tech?: TechRef | null;       // 파이프라인이 저장한 기술적 참고(판정 미사용)
  idea?: IdeaEvidence;         // 🎯 매수 검토 종목의 투자 아이디어·매수 근거(표시 전용)
  next_event?: string | null;  // 가장 가까운 종목 이벤트 날짜(추천 순위용)
};
export type ExplainInput = {
  queue: Queue; market: "KR" | "US"; evidence: AxesEvidence;
  p: number | null; daysToEarnings?: number | null; heat?: number | null;
  tech?: TechRef | null;
};

const US_FILTER: Record<string, string> = { F1: "주당순이익 예상 상회", F2: "가이던스 상향", F3: "성장 가속", F4: "영업이익률 개선" };

/** RSI 해석: 70 이상 과열권 · 30 이하 과매도권 · 그 사이 중립 */
export function rsiBand(rsi: number): string {
  return rsi >= 70 ? "과열권" : rsi <= 30 ? "과매도권" : "중립";
}

export function pLevel(p: number | null): string {
  if (p === null) return "계산 전";
  if (p < 40) return "덜 반영";
  if (p < 65) return "보통";
  return "많이 반영";
}

export function explain(x: ExplainInput): { conclusion: string; reasons: string[] } {
  const e = x.evidence;
  const reasons: string[] = [];
  const p = x.p === null ? null : Math.round(x.p);
  const fam = (e.families ?? []).map((f) => PROJECT_NAME[f] ?? f);

  // 실적 숫자
  if (x.market === "KR" && e.F && (e.F.grade || e.F.score !== undefined)) {
    const sc = e.F.score === null || e.F.score === undefined ? "-" : String(Math.round(e.F.score));
    reasons.push(`실적 숫자: Heimdallr ${e.F.grade ?? "등급 없음"} · 점수 ${sc}${e.F.gate_passed ? " · 게이트 통과" : e.F.gate_passed === false ? " · 게이트 미통과" : ""}`);
  } else if (x.market === "US" && (e.F?.us_filters ?? e.C?.us_filters)?.length) {
    reasons.push(`실적 숫자: ${(e.F?.us_filters ?? e.C?.us_filters ?? []).map((f) => US_FILTER[f] ?? f).join(" · ")}`);
  }
  // 주가 반영도
  if (p !== null) reasons.push(`주가 반영도: ${p}/100 (${pLevel(p)}) — 낮을수록 좋은 실적이 주가에 덜 반영됨`);
  // 이야기·촉매
  if (e.N?.length) reasons.push(`산업·종목 이야기: ${e.N.map((s) => s.detail ?? describeSignal(s.kind, s.strength, {})).join(" · ")}`);
  if (e.C?.catalyst) reasons.push(`실적 촉매: ${e.C.catalyst.detail ?? `수혜 강도 ${e.C.catalyst.strength}/10`}`);
  // 참고 기술 지표 (판정 미사용)
  const tech = x.tech ?? e.tech ?? null;
  if (tech && (tech.rsi !== null || tech.macd_note || tech.price_note)) {
    const parts = [
      tech.macd_note && `MACD ${tech.macd_note}`,
      tech.rsi !== null && `RSI ${Math.round(tech.rsi)}(${[rsiBand(tech.rsi), tech.rsi_note].filter(Boolean).join(", ")})`,
      tech.price_note && `가격 ${tech.price_note}`,
    ].filter(Boolean);
    reasons.push(`기술적 참고(판정 미사용): ${parts.join(" · ")} — ${tech.source}${tech.as_of ? ` ${tech.as_of}` : ""}`);
  }

  const who = fam.length ? `${fam.join("·")} ${fam.length}곳 신호 합의` : "신호";
  const conclusion =
    x.queue === "buy" ? `매수 검토 후보 — 실적 숫자가 좋고 주가는 ${pLevel(x.p)}(${p ?? "-"}), ${who}`
    : x.queue === "radar" ? `실적 발표 ${x.daysToEarnings ?? "?"}일 전 선행 관찰 — 이야기·촉매는 켜졌고 실적 숫자는 아직 확인 전`
    : x.queue === "pullback_wait" ? `눌림 대기 — 실적은 좋지만 주가가 이미 ${pLevel(x.p)}(${p ?? "-"}), 반영도 50 아래로 내려오면 재검토`
    : x.queue === "take_profit" ? `익절 검토 — 과열 ${x.heat ?? "-"}점, 주가 반영도 ${p ?? "-"}로 높음 (SnowBall 익절 사다리 확인)`
    : "보유 경고 — 논지 재검토 후 SnowBall 결정 기록";
  return { conclusion, reasons };
}
