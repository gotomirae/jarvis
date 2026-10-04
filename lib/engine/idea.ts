/**
 * 🎯 매수 검토 추천의 "투자 아이디어·매수 근거" (브리핑·대시보드 공용) — 순수 함수. 판정은 하지 않는다.
 *  · 매수 근거는 둘로 나눈다(D53): 🏢 좋은 기업인가(실적·산업·합의 — 이 파일) / ⏱️ 지금 사기 좋은가(가격·추세·수급 — timing.ts)
 *  · 순위: 과거 성과 → 지금 매수 매력 점수 ↓ → 신호 계열 수 ↓ → 주가 반영도 ↑(낮을수록 먼저) → 산업 실제 성장률 ↓ → 가까운 이벤트
 *  · 숫자는 원천의 결정적 값(분기 실적·반영도·산업 중앙값)만 쓴다. 논지 문장은 원 프로젝트 분석을 출처와 함께 인용한다.
 */
import { describeSignal, rsiBand, type AxesEvidence, type TechRef } from "./explain";
import type { ChartRef } from "./technicals";
import { checkLines, VERDICT_NAME, type FlowRef, type Timing } from "./timing";

export type IdeaEvidence = {
  thesis: { text: string; source: string; as_of: string | null } | null;
  growth: { fiscal: string; rev_yoy: number | null; op_yoy: number | null; prev_fiscal: string | null; prev_rev_yoy: number | null; prev_op_yoy: number | null; op_label: string; source: string } | null;
  industry: { name: string; pass: boolean; realized_median: number | null; brokers: { broker: string; value: number }[]; outlook: { source: string; cagr: number }[] } | null;
  events: { when: string; title: string; source: string }[];
  risk: { text: string; watch: string | null; source: string } | null;
  chart?: ChartRef | null;     // 일봉으로 계산한 가격·기술 지표(표시 전용)
  flow?: FlowRef | null;       // 외국인·기관 일별 순매수(국내) · 매집일 대용(미국)
};

export type RankInput = { entity_id: string; families: number; p: number | null; industryGrowth: number | null; nextEvent: string | null; perf?: number | null; timing?: number | null };

/** perf(과거 성과 기대 초과수익) 큰 순, 없는 후보는 뒤 — 둘 다 없으면 0 */
const byPerf = (a?: number | null, b?: number | null) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : b - a);

/**
 * 추천 순위 (최대 n개). 표본 30건 이상 구간의 과거 성과(perf, lib/engine/feedback.ts)가 있으면 그것이 첫 기준이다
 * (PRD §7.3 진입 게이트 6 "표본이 30건을 넘으면 성과 순위로 교체", D49). 없으면 규칙 순위.
 */
export function rankBuy<T extends RankInput>(xs: T[], n = 5): T[] {
  const inf = Number.POSITIVE_INFINITY;
  return [...xs].sort((a, b) =>
    byPerf(a.perf, b.perf)
    || (b.timing ?? -inf) - (a.timing ?? -inf)
    || b.families - a.families
    || (a.p ?? inf) - (b.p ?? inf)
    || (b.industryGrowth ?? -inf) - (a.industryGrowth ?? -inf)
    || (a.nextEvent ?? "9999").localeCompare(b.nextEvent ?? "9999")
    || a.entity_id.localeCompare(b.entity_id),
  ).slice(0, n);
}

/** 글자가 하나라도 있는 문장인지 ("..."·"unused"·"N/A" 같은 자리표시 제외) */
export const hasText = (s: string | null | undefined): s is string => !!s && /\p{L}/u.test(s) && !/^\s*(unused|n\/?a|none|null|tbd|없음)\s*$/i.test(s);

/** 원 프로젝트 LLM 문장의 편집 흔적 정리 ("[검증 불가 수치 삭제]"·"[[F 값]]") — 내용은 바꾸지 않고 흔적만 지운다 */
export function cleanThesis(s: string, max = 220): string {
  const t = s
    .replace(/\[\[F\s+([^\]]*)\]\]/g, (_, inner: string) => (/^[a-z][a-z0-9_]*\s/.test(inner) ? "" : inner))   // 사실 표식 [[F 218.8억]] → 값, [[F 필드명 값]] → 삭제
    .replace(/\s*\[[^\]]*(?:삭제|검증 불가)[^\]]*\]\s*/g, " ")
    .replace(/\(\s*[,·]?\s*\)/g, "").replace(/\s+([,.)])/g, "$1").replace(/\s{2,}/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

const sign = (x: number) => `${x > 0 ? "+" : ""}${Math.round(x)}%`;

/** 🏢 좋은 기업인가 — ① 실적 ② 산업 ③ 신호 합의 (주가·가격·수급은 ⏱️ timing.ts) */
export function buyReasons(x: { idea: IdeaEvidence; consensus: string[]; grade?: string | null; score?: number | null }): string[] {
  const out: string[] = [];
  const g = x.idea.growth;
  if (g && (g.rev_yoy !== null || g.op_yoy !== null)) {
    const now = [g.rev_yoy !== null && `매출 ${sign(g.rev_yoy)}`, g.op_yoy !== null && `${g.op_label} ${sign(g.op_yoy)}`].filter(Boolean).join(" · ");
    const accel = g.prev_rev_yoy !== null && g.rev_yoy !== null && g.rev_yoy > g.prev_rev_yoy
      && (g.prev_op_yoy === null || g.op_yoy === null || g.op_yoy > g.prev_op_yoy);
    const prev = g.prev_fiscal && (g.prev_rev_yoy !== null || g.prev_op_yoy !== null)
      ? ` ← 직전 ${g.prev_fiscal} ${[g.prev_rev_yoy !== null && sign(g.prev_rev_yoy), g.prev_op_yoy !== null && sign(g.prev_op_yoy)].filter(Boolean).join(" · ")}` : "";
    const grade = x.grade ? ` · Heimdallr ${x.grade}${x.score !== null && x.score !== undefined ? ` ${Math.round(x.score)}점` : ""}` : "";
    out.push(`① 실적${accel ? " 가속" : ""}: ${now} (${g.fiscal}, 전년 대비)${prev}${grade}`);
  } else if (x.grade) {
    out.push(`① 실적: Heimdallr ${x.grade}${x.score !== null && x.score !== undefined ? ` ${Math.round(x.score)}점` : ""}`);
  }
  const ind = x.idea.industry;
  if (ind) {
    const bits = [
      ind.realized_median !== null && `실적 중앙값 ${sign(ind.realized_median)}`,
      ...ind.brokers.slice(0, 2).map((b) => `${b.broker} 연평균 ${b.value}%`),
      ...ind.outlook.slice(0, 1).map((o) => `${o.source} 연평균 ${o.cagr}%`),
    ].filter(Boolean);
    out.push(`② 산업 ${ind.pass ? "고성장 ✅" : "성장 근거 부족"}: ${ind.name}${bits.length ? ` (${bits.join(" · ")})` : ""}`);
  }
  if (x.consensus.length) out.push(`③ 신호 합의: ${x.consensus.join(" · ")}`);
  return out;
}

/** ③ 신호 합의 문장: 이야기(N) + 실적 촉매(C) */
export function consensusOf(ev: AxesEvidence): string[] {
  return [
    ...(ev.N ?? []).map((s) => s.detail ?? describeSignal(s.kind, s.strength, {})),
    ...(ev.C?.catalyst ? [ev.C.catalyst.detail ?? `실적 촉매 수혜 강도 ${ev.C.catalyst.strength}/10`] : []),
  ];
}

export const EMPTY_IDEA: IdeaEvidence = { thesis: null, growth: null, industry: null, events: [], risk: null };

export type IdeaCard = {
  rank: number; name: string; code: string; industry: string; flag: string;
  thesis: string | null; reasons: string[]; events: string[]; risk: string | null; tech: string | null; links: string;
  perf?: string | null;        // 과거 성과 피드백 한 줄(lib/engine/feedback.ts perfLine)
  verdict?: string | null;     // ⏱️ 지금 매수 매력 (🔥 · ⚖️ · ⏸️) + 점수
  timing?: string[];           // ⏱️ 지금 사기 좋은가 — ✅/⚠️/❌/➖ 줄
  history?: string | null;     // 🔁 몇 번째 추천 · 첫 추천 이후 수익률 (lib/outcomes/rec-history.ts)
};

export function techLine(t: TechRef | null | undefined): string | null {
  if (!t || (t.rsi === null && !t.macd_note && !t.price_note)) return null;
  return [t.macd_note && `MACD ${t.macd_note}`, t.rsi !== null && `RSI ${Math.round(t.rsi)}(${rsiBand(t.rsi)})`, t.price_note && `가격 ${t.price_note}`].filter(Boolean).join(" · ");
}

export function ideaCard(rank: number, e: { name: string; symbol: string; market: "KR" | "US"; industry: string }, idea: IdeaEvidence, reasons: string[], tech: TechRef | null | undefined, links: string, perf: string | null = null,
  extra: { timing?: Timing | null; history?: string | null } = {}): IdeaCard {
  const t = extra.timing;
  return {
    perf,
    verdict: t ? `${VERDICT_NAME[t.verdict]} (점수 ${t.score > 0 ? "+" : ""}${t.score})` : null,
    timing: t ? checkLines(t) : [],
    history: extra.history ?? null,
    rank, name: e.name, code: e.symbol, industry: e.industry, flag: e.market === "US" ? "🇺🇸" : "🇰🇷",
    thesis: idea.thesis ? `${cleanThesis(idea.thesis.text)} (${idea.thesis.source}${idea.thesis.as_of ? ` ${idea.thesis.as_of}` : ""})` : null,
    reasons,
    events: idea.events.slice(0, 2).map((v) => `${v.when} ${cleanThesis(v.title, 70)} (${v.source})`),
    risk: idea.risk && hasText(idea.risk.text) ? `${cleanThesis(idea.risk.text, 140)}${hasText(idea.risk.watch) ? ` → 확인: ${cleanThesis(idea.risk.watch, 80)}` : ""}` : null,
    tech: idea.chart ? null : techLine(tech), links,   // 일봉 지표(⏱️ 타이밍)가 있으면 원 프로젝트 기술 참고 줄은 생략
  };
}
