/**
 * 🎯 매수 검토 추천의 "투자 아이디어·매수 근거" (브리핑·대시보드 공용) — 순수 함수. 판정은 하지 않는다.
 *  · 순위: PRD §7.3 진입 게이트 우선순위 — 신호 계열 수 ↓ → 주가 반영도 ↑(낮을수록 먼저) → 산업 실제 성장률 ↓ → 가까운 이벤트
 *  · 숫자는 원천의 결정적 값(분기 실적·반영도·산업 중앙값)만 쓴다. 논지 문장은 원 프로젝트 분석을 출처와 함께 인용한다.
 */
import { describeSignal, pLevel, rsiBand, type AxesEvidence, type TechRef } from "./explain";
import type { ChartRef } from "./technicals";

export type IdeaEvidence = {
  thesis: { text: string; source: string; as_of: string | null } | null;
  growth: { fiscal: string; rev_yoy: number | null; op_yoy: number | null; prev_fiscal: string | null; prev_rev_yoy: number | null; prev_op_yoy: number | null; op_label: string; source: string } | null;
  industry: { name: string; pass: boolean; realized_median: number | null; brokers: { broker: string; value: number }[]; outlook: { source: string; cagr: number }[] } | null;
  events: { when: string; title: string; source: string }[];
  risk: { text: string; watch: string | null; source: string } | null;
  chart?: ChartRef | null;     // 일봉으로 계산한 가격·기술 지표(표시 전용)
};

export type RankInput = { entity_id: string; families: number; p: number | null; industryGrowth: number | null; nextEvent: string | null };

/** 추천 순위 (최대 n개) */
export function rankBuy<T extends RankInput>(xs: T[], n = 5): T[] {
  const inf = Number.POSITIVE_INFINITY;
  return [...xs].sort((a, b) =>
    b.families - a.families
    || (a.p ?? inf) - (b.p ?? inf)
    || (b.industryGrowth ?? -inf) - (a.industryGrowth ?? -inf)
    || (a.nextEvent ?? "9999").localeCompare(b.nextEvent ?? "9999")
    || a.entity_id.localeCompare(b.entity_id),
  ).slice(0, n);
}

/** 글자가 하나라도 있는 문장인지 ("..." 같은 자리표시 제외) */
export const hasText = (s: string | null | undefined): s is string => !!s && /\p{L}/u.test(s);

/** 원 프로젝트 LLM 문장의 편집 흔적 정리 ("[검증 불가 수치 삭제]"·"[[F 값]]") — 내용은 바꾸지 않고 흔적만 지운다 */
export function cleanThesis(s: string, max = 220): string {
  const t = s
    .replace(/\[\[F\s+([^\]]*)\]\]/g, (_, inner: string) => (/^[a-z][a-z0-9_]*\s/.test(inner) ? "" : inner))   // 사실 표식 [[F 218.8억]] → 값, [[F 필드명 값]] → 삭제
    .replace(/\s*\[[^\]]*(?:삭제|검증 불가)[^\]]*\]\s*/g, " ")
    .replace(/\(\s*[,·]?\s*\)/g, "").replace(/\s+([,.)])/g, "$1").replace(/\s{2,}/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

const sign = (x: number) => `${x > 0 ? "+" : ""}${Math.round(x)}%`;

const money = (v: number, c: ChartRef["currency"]) => (c === "KRW" ? `${Math.round(v).toLocaleString("en-US")}원` : `$${v.toFixed(2)}`);
const ymd = (d: string) => d.slice(2).replace(/-/g, "/");
const pct1 = (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(1)}%`;

/** ⑤ 고점 대비 하락률 ⑥ 5일선·20일선 ⑦ MACD·Signal ⑧ RSI 수치·방향 — 참고 지표(판정 미사용) */
export function chartLines(c: ChartRef): string[] {
  const out: string[] = [];
  out.push(c.high.days === 0
    ? `⑤ 고점 대비: 52주 최고가 경신 중 (현재 ${money(c.close, c.currency)})`
    : `⑤ 고점 대비: ${pct1(c.high.drawdown_pct)} (52주 최고 ${money(c.high.value, c.currency)} · ${ymd(c.high.date)}, 현재 ${money(c.close, c.currency)})`);
  if (c.ma) {
    const [f, s] = c.ma.n;
    const g = Math.abs(c.ma.gap_pct).toFixed(1);
    const body = c.ma.state === "cross_today" ? `오늘 상향 통과 ✅`
      : c.ma.state === "near" ? `상향 통과 직전 ✅ (${f}일선이 ${s}일선 아래 ${g}%, ${c.ma.streak}일째 좁혀짐)`
      : c.ma.state === "above" ? `이미 위 (${c.ma.streak}일째, ${s}일선보다 +${g}%)`
      : `아래 (${s}일선보다 -${g}%, ${c.ma.streak ? `${c.ma.streak}일째 좁혀지는 중` : "벌어지는 중"}) — 통과 직전 아님`;
    out.push(`⑥ ${f}일선·${s}일선: ${body}`);
  }
  if (c.macd) {
    const g = c.macd.gap_pct.toFixed(2);
    const body = c.macd.state === "cross_today" ? `오늘 시그널 상향 통과 ✅`
      : c.macd.state === "near" ? `시그널 상향 통과 직전 ✅ (격차 종가의 ${g}%${c.macd.bars_to_cross ? `, 약 ${c.macd.bars_to_cross}일 후 예상` : ""})`
      : c.macd.state === "above" ? `이미 시그널 위 (${c.macd.streak}일째)`
      : `시그널 아래 (격차 종가의 ${g}%, ${c.macd.improving ? "좁혀지는 중" : "벌어지는 중"}) — 통과 직전 아님`;
    out.push(`⑦ MACD: ${body}`);
  }
  if (c.rsi) {
    const dir = c.rsi.dir === "up" ? "↗ 상승" : c.rsi.dir === "down" ? "↘ 하락" : "→ 보합";
    out.push(`⑧ RSI ${Math.round(c.rsi.value)} ${dir} (${c.rsi.days}일 전 ${Math.round(c.rsi.prev)} · ${rsiBand(c.rsi.value)})`);
  }
  out.push(`※ ⑤~⑧ 가격·기술 지표는 참고용 — 매수 검토 판정 조건 아님 (${ymd(c.as_of)} 종가 기준)`);
  return out;
}

/** 매수 근거 줄 (① 실적 ② 주가 ③ 산업 ④ 합의 ⑤~⑧ 가격·기술 지표) */
export function buyReasons(x: { idea: IdeaEvidence; p: number | null; consensus: string[]; grade?: string | null; score?: number | null }): string[] {
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
  if (x.p !== null) out.push(`② 주가 ${pLevel(x.p)}: 반영도 ${Math.round(x.p)}/100 — 실적에 비해 주가가 ${x.p < 40 ? "아직 덜 올랐음" : "이미 반영됨"}`);
  const ind = x.idea.industry;
  if (ind) {
    const bits = [
      ind.realized_median !== null && `실적 중앙값 ${sign(ind.realized_median)}`,
      ...ind.brokers.slice(0, 2).map((b) => `${b.broker} 연평균 ${b.value}%`),
      ...ind.outlook.slice(0, 1).map((o) => `${o.source} 연평균 ${o.cagr}%`),
    ].filter(Boolean);
    out.push(`③ 산업 ${ind.pass ? "고성장 ✅" : "성장 근거 부족"}: ${ind.name}${bits.length ? ` (${bits.join(" · ")})` : ""}`);
  }
  if (x.consensus.length) out.push(`④ 신호 합의: ${x.consensus.join(" · ")}`);
  if (x.idea.chart) out.push(...chartLines(x.idea.chart));
  return out;
}

/** ④ 신호 합의 문장: 이야기(N) + 실적 촉매(C) */
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
};

export function techLine(t: TechRef | null | undefined): string | null {
  if (!t || (t.rsi === null && !t.macd_note && !t.price_note)) return null;
  return [t.macd_note && `MACD ${t.macd_note}`, t.rsi !== null && `RSI ${Math.round(t.rsi)}(${rsiBand(t.rsi)})`, t.price_note && `가격 ${t.price_note}`].filter(Boolean).join(" · ");
}

export function ideaCard(rank: number, e: { name: string; symbol: string; market: "KR" | "US"; industry: string }, idea: IdeaEvidence, reasons: string[], tech: TechRef | null | undefined, links: string): IdeaCard {
  return {
    rank, name: e.name, code: e.symbol, industry: e.industry, flag: e.market === "US" ? "🇺🇸" : "🇰🇷",
    thesis: idea.thesis ? `${cleanThesis(idea.thesis.text)} (${idea.thesis.source}${idea.thesis.as_of ? ` ${idea.thesis.as_of}` : ""})` : null,
    reasons,
    events: idea.events.slice(0, 2).map((v) => `${v.when} ${cleanThesis(v.title, 70)} (${v.source})`),
    risk: idea.risk && hasText(idea.risk.text) ? `${cleanThesis(idea.risk.text, 140)}${hasText(idea.risk.watch) ? ` → 확인: ${cleanThesis(idea.risk.watch, 80)}` : ""}` : null,
    tech: idea.chart ? null : techLine(tech), links,   // 일봉 지표(⑤~⑧)가 있으면 원 프로젝트 기술 참고 줄은 생략
  };
}
