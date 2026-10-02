/**
 * 신호 원장 `signal_ledger` 행 만들기 (PRD §12, D47) — 순수 함수.
 *  · 큐 진입: 같은 종목·같은 큐의 연속 구간(first_seen 이 같음)을 1건으로 센다. 신호 시각 = first_seen.
 *  · SnowBall 제출: 성공한 제출(sent_at 있음)을 종목·신호일당 1행으로 센다(수동 버튼 연타 중복 제거). 큐 없는 제출 = 수동(manual).
 *  · 첫 파이프라인 실행일(원장 시작일)의 큐는 새 신호가 아니라 시작 시점에 이미 있던 상태 → payload.initial_state=true
 * 매수 쪽(🎯·🔭·⏳)은 초과수익이 클수록, 매도 쪽(⚠️·💰)은 초과수익이 작을수록(이후 하락) 좋은 신호다.
 */
import { marketDate, type Market } from "./returns";

export type Side = "buy" | "sell";
export const QUEUE_SIDE: Record<string, Side> = { buy: "buy", radar: "buy", pullback_wait: "buy", take_profit: "sell", holding_alert: "sell", green: "buy", yellow: "buy", blue: "buy" };

export type Benchmark = "KOSPI" | "KOSDAQ" | "SPX";

export type QueueItem = { date: string; entity_id: string; queue: string; reason: Record<string, unknown> | null; first_seen: string };
export type SubmitNote = { entity_id: string | null; dedupe_key: string; sent_at: string | null; payload: Record<string, unknown> | null };

export type LedgerInsert = {
  event_type: "queue" | "snowball_submit" | "green" | "yellow" | "blue";
  entity_id: string;
  market: Market;
  tag: string;
  level: Side;
  signal_date: string;
  benchmark: Benchmark | null;
  payload: Record<string, unknown>;
  dedupe_key: string;
};

/** 벤치마크: 미국 S&P 500, 국내는 거래소(야후 접미사 .KQ = 코스닥). 거래소를 모르면 null(진입가 확정 때 정함) */
export function benchmarkFor(market: Market, yahooSymbol: string | null): Benchmark | null {
  if (market === "US") return "SPX";
  if (!yahooSymbol) return null;
  return /\.KQ$/i.test(yahooSymbol) ? "KOSDAQ" : "KOSPI";
}

const marketOfId = (id: string): Market | null => (id.startsWith("KR:") ? "KR" : id.startsWith("US:") ? "US" : null);
const iso = (s: string) => new Date(s).toISOString();

export function ledgerFromQueues(items: QueueItem[], yahoo: Map<string, string>): LedgerInsert[] {
  const startDate = items.reduce<string | null>((m, q) => (m === null || q.date < m ? q.date : m), null);
  const first = new Map<string, QueueItem>();
  for (const q of [...items].sort((a, b) => a.date.localeCompare(b.date))) {
    const key = `queue:${q.queue}:${q.entity_id}:${iso(q.first_seen)}`;
    if (!first.has(key)) first.set(key, q);
  }
  const out: LedgerInsert[] = [];
  for (const [key, q] of first) {
    const market = marketOfId(q.entity_id);
    const side = QUEUE_SIDE[q.queue];
    if (!market || !side) continue;
    out.push({
      event_type: "queue", entity_id: q.entity_id, market, tag: q.queue, level: side,
      signal_date: marketDate(new Date(q.first_seen), market),
      benchmark: benchmarkFor(market, yahoo.get(q.entity_id) ?? null),
      payload: { queue: q.queue, queue_date: q.date, signal_at: iso(q.first_seen), reason: q.reason ?? {}, ...(q.date === startDate ? { initial_state: true } : {}) },
      dedupe_key: key,
    });
  }
  return out;
}

export function ledgerFromSubmits(notes: SubmitNote[], yahoo: Map<string, string>): LedgerInsert[] {
  const out = new Map<string, LedgerInsert>();
  for (const n of [...notes].sort((a, b) => String(a.sent_at).localeCompare(String(b.sent_at)))) {
    const market = n.entity_id ? marketOfId(n.entity_id) : null;
    if (!n.entity_id || !market || !n.sent_at) continue;
    const signal_date = marketDate(new Date(n.sent_at), market);
    const key = `snowball_submit:${n.entity_id}:${signal_date}`;
    if (out.has(key)) continue;
    out.set(key, {
      event_type: "snowball_submit", entity_id: n.entity_id, market, tag: String(n.payload?.queue ?? "manual"), level: "buy",
      signal_date, benchmark: benchmarkFor(market, yahoo.get(n.entity_id) ?? null),
      payload: { idea_id: n.payload?.idea_id ?? null, queue: n.payload?.queue ?? null, signal_at: iso(n.sent_at), source_key: n.dedupe_key },
      dedupe_key: key,
    });
  }
  return [...out.values()];
}

/** 야후 심볼 후보: 미국은 티커, 국내는 거래소를 알면 그 심볼, 모르면 코스닥 → 코스피 순 */
export function yahooCandidates(entityId: string, known: string | null): string[] {
  const [m, s] = entityId.split(":");
  if (m === "US") return [s.replace(/\./g, "-")];   // BRK.B → 야후 BRK-B
  return known ? [known] : [`${s}.KQ`, `${s}.KS`];
}

export type EntryEvalRow = { date: string; entity_id: string; market: Market; level: string; tag: string | null; invalidation_price: number | null; evidence: { families?: string[]; p?: number | null; grade?: string | null; missing?: string[] } | null };
export type BreakoutRow = { entity_id: string; source: string; d0: string; d0_low: number | null };

/**
 * 🟢·🟡 진입 판정 → 원장 (PRD §12). 같은 종목·같은 단계가 이어지는 동안은 1건(직전 같은 단계 평가가 gapDays 넘게 떨어져 있으면 새 구간).
 * 신호 시점 특징(계열·반영도·등급·산업)을 바로 고정 저장한다 — 평가일이 곧 시장 날짜.
 */
export function ledgerFromEntry(rows: EntryEvalRow[], l1Of: (id: string) => string | null, gapDays = 5): LedgerInsert[] {
  const out: LedgerInsert[] = [];
  const last = new Map<string, string>();
  for (const r of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
    if (r.level !== "green" && r.level !== "yellow") continue;
    const k = `${r.level}:${r.entity_id}`;
    const prev = last.get(k);
    last.set(k, r.date);
    if (prev && (new Date(`${r.date}T00:00:00Z`).getTime() - new Date(`${prev}T00:00:00Z`).getTime()) / 86400_000 <= gapDays) continue;
    const ev = r.evidence ?? {};
    out.push({
      event_type: r.level, entity_id: r.entity_id, market: r.market, tag: r.tag ?? r.level, level: "buy", signal_date: r.date, benchmark: r.market === "US" ? "SPX" : null,
      payload: { tag: r.tag, invalidation_price: r.invalidation_price, missing: ev.missing ?? [],
        features: { families: [...(ev.families ?? [])].sort(), p: ev.p ?? null, grade: ev.grade ?? null, market: r.market, l1: l1Of(r.entity_id) }, features_source: "entry_eval" },
      dedupe_key: `${r.level}:${r.entity_id}:${r.date}`,
    });
  }
  return out;
}

/** 🔵 실적 돌파 → 원장 (진입 신호 아님 — 돌파 이후 성과를 따로 본다) */
export function ledgerFromBreakouts(rows: BreakoutRow[]): LedgerInsert[] {
  return rows.flatMap((b) => {
    const market = marketOfId(b.entity_id);
    return market ? [{ event_type: "blue" as const, entity_id: b.entity_id, market, tag: b.source, level: "buy" as const, signal_date: b.d0, benchmark: market === "US" ? "SPX" as const : null,
      payload: { source: b.source, d0_low: b.d0_low }, dedupe_key: `blue:${b.entity_id}:${b.source}:${b.d0}` }] : [];
  });
}
