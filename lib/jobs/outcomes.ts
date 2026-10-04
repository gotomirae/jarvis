/**
 * outcomes_update (PRD §12·§14 20:00, D47) — 신호 원장 동기화 → 진입가 확정 → D+5·20·40·60 성과 기록.
 *  ① queue_items(큐 진입 구간)·SnowBall 제출 → signal_ledger (dedupe_key 로 멱등, 과거분도 자동 소급)
 *  ② 아직 측정이 끝나지 않은 원장 행만 일봉을 받아 진입가·기간별 수익률·벤치마크 대비 초과수익 계산
 *     시세: 국내 = 네이버 일봉(거래소 공식 종가), 미국 = 야후. 국내 벤치마크(KOSPI/KOSDAQ)는 거래소 구분으로 정한다
 *  ③ outcomes 는 한 번 기록하면 바꾸지 않는다(ignore-duplicates). 재생성 불가 데이터 → D24 백업 대상
 *  ④ 신호 특징(신호 시점 축 근거)을 원장에 고정 저장하고, 큐·특징 구간별 성과를 perf_stats 에 매일 스냅샷 (D49)
 *     → 브리핑 🎯 순위·카드의 "과거 성과"와 분기 보정 제안(calibration_review)이 읽는다
 *  ⑤ 사후 검증(D54): 브리핑 🎯 후보 전체(추천 top + 미추천 candidate)를 원장 `pick` 으로 남겨 똑같이 측정한다.
 *     성과는 scope `pick`(실제 추천) · `pick_all`(후보 전체 — 학습 표본)으로 집계하고, 승률 낮은 구간을 찾아
 *     bot_state.pick_policy 에 "배운 추천 기준"을 매일 쓴다 → 다음 브리핑 TOP 선별·/verify 화면이 읽는다
 * 시세 실패 종목은 건너뛰고 다음 실행에서 다시 시도한다(불변 규칙 6).
 */
import { dbDelete, dbInsert, dbSelectAll, dbUpdate } from "@/lib/db";
import { derivePolicy, type Policy } from "@/lib/engine/pick-policy";
import { featuresOf, type SignalFeatures } from "@/lib/engine/feedback";
import type { AxesEvidence } from "@/lib/engine/explain";
import { read as heimdallr } from "@/lib/ingest/heimdallr";
import { chart, naverDaily } from "@/lib/ingest/market";
import { ledgerFromBreakouts, ledgerFromEntry, ledgerFromPicks, ledgerFromQueues, ledgerFromSubmits, benchmarkFor, type BreakoutRow, type EntryEvalRow, type PickNote, yahooCandidates, type Benchmark, type QueueItem, type Side, type SubmitNote } from "@/lib/outcomes/ledger";
import { lastCompleteDate, measure, type Bar, type Market } from "@/lib/outcomes/returns";
import { attribute, type Sample } from "@/lib/outcomes/attribution";
import { scorecard, type ScoreInput } from "@/lib/outcomes/scorecard";
import { kstDate } from "@/lib/time";
import { loadEntities, rules } from "./context";
import { getState } from "./poll";

type LedgerRow = { id: number; event_type: string; entity_id: string | null; market: Market; tag: string; level: Side; signal_date: string; entry_date: string | null; benchmark: Benchmark | null; payload: Record<string, unknown> };
type OutRow = { ledger_id: number; horizon_days: number; ret_pct: number; excess_pct: number | null };

/** 국내 코드 → 야후 심볼(.KS/.KQ) — Heimdallr krx_universe (코스닥을 .KS 로 받으면 하루 늦은 시세, D44) */
async function krYahoo(ids: string[]): Promise<Map<string, string>> {
  const codes = [...new Set(ids.filter((id) => id.startsWith("KR:")).map((id) => id.slice(3)))];
  const out = new Map<string, string>();
  for (let i = 0; i < codes.length; i += 100) {
    const r = await heimdallr<{ code: string; symbol: string | null }>("krx_universe", { select: "code,symbol", filters: { code: `in.(${codes.slice(i, i + 100).join(",")})` } });
    for (const k of r.ok ? r.data : []) if (k.symbol) out.set(`KR:${k.code}`, k.symbol);
  }
  return out;
}

type Series = { source: "naver" | "yahoo"; symbol: string; exchange: string | null; bars: Bar[] };

/** 종목 일봉. 국내는 네이버 공식 종가 + 거래소 구분(krx_universe, 모르면 야후 .KQ → .KS 존재로 판별) */
async function series(id: string, knownYahoo: string | null): Promise<Series | null> {
  const [m, sym] = id.split(":");
  if (m === "US") {
    const [y] = yahooCandidates(id, null);
    const q = await chart(y, "1y");
    return q.ok && q.data.closes.length ? { source: "yahoo", symbol: y, exchange: y, bars: q.data.closes } : null;
  }
  const n = await naverDaily(sym, 300);
  if (!n.ok) return null;
  let exchange = knownYahoo;
  for (const c of knownYahoo ? [] : yahooCandidates(id, null)) {
    if ((await chart(c, "5d")).ok) { exchange = c; break; }
  }
  return { source: "naver", symbol: sym, exchange, bars: n.data };
}

async function benchSeries(src: { source: "naver" | "yahoo"; sym: string }): Promise<Bar[] | null> {
  if (src.source === "naver") { const n = await naverDaily(src.sym, 300); return n.ok ? n.data : null; }
  const q = await chart(src.sym, "1y");
  return q.ok ? q.data.closes : null;
}

export async function syncLedger(): Promise<Record<string, number>> {
  const [qi, sn, ee, bw, ents, br] = await Promise.all([
    dbSelectAll<QueueItem>("queue_items", "select=date,entity_id,queue,reason,first_seen&order=date.asc,entity_id.asc"),
    dbSelectAll<SubmitNote>("notifications", "select=entity_id,dedupe_key,sent_at,payload&kind=eq.snowball_submit&order=created_at.asc"),
    dbSelectAll<EntryEvalRow>("entry_eval", "select=date,entity_id,market,level,tag,invalidation_price,evidence&level=in.(green,yellow)&order=date.asc,entity_id.asc"),
    dbSelectAll<BreakoutRow>("breakout_watch", "select=entity_id,source,d0,d0_low&order=id.asc"),
    loadEntities(),
    dbSelectAll<PickNote>("notifications", "select=kind,sent_at,payload&kind=in.(brief_morning,brief_evening)&sent_at=not.is.null&order=sent_at.asc"),
  ]);
  const idOf = (c: string) => (ents.byId.has(`KR:${c}`) ? `KR:${c}` : ents.byId.has(`US:${c}`) ? `US:${c}` : null);
  const picks = ledgerFromPicks(br.ok ? br.data : [], idOf);
  if (!qi.ok) throw new Error(qi.reason);
  const ids = [...qi.data.map((q) => q.entity_id), ...(sn.ok ? sn.data.map((n) => n.entity_id ?? "") : [])];
  const yahoo = await krYahoo(ids);
  const rows = [...ledgerFromQueues(qi.data, yahoo), ...ledgerFromSubmits(sn.ok ? sn.data : [], yahoo),
    ...ledgerFromEntry(ee.ok ? ee.data : [], (id) => ents.byId.get(id)?.primary_l1 ?? null), ...ledgerFromBreakouts(bw.ok ? bw.data : []), ...picks];
  const existing = await dbSelectAll<{ id: number; dedupe_key: string; tag: string | null; payload: Record<string, unknown> }>("signal_ledger", "select=id,dedupe_key,tag,payload&order=id.asc");
  if (!existing.ok) throw new Error(existing.reason);
  const have = new Set(existing.data.map((r) => r.dedupe_key));
  // 같은 시장 날짜에 미추천 후보로 먼저 기록됐다가 다음 브리핑에서 추천된 종목 → top 으로 갱신(진입가·측정은 그대로)
  const byKey = new Map(existing.data.map((r) => [r.dedupe_key, r]));
  let promoted = 0;
  for (const p of picks) {
    const cur = byKey.get(p.dedupe_key);
    if (cur && p.payload.picked && !cur.payload.picked) {
      const u = await dbUpdate("signal_ledger", `id=eq.${cur.id}`, { tag: "top", payload: { ...cur.payload, picked: true, rank: p.payload.rank, brief: p.payload.brief } });
      if (u.ok) promoted++;
    }
  }
  const fresh = rows.filter((r) => !have.has(r.dedupe_key));
  for (let i = 0; i < fresh.length; i += 500) {
    const w = await dbInsert("signal_ledger", fresh.slice(i, i + 500), { upsertOn: "dedupe_key", ignoreDuplicates: true });
    if (!w.ok) throw new Error(w.reason);
  }
  const features = await attachFeatures();
  const count = (t: string) => rows.filter((r) => r.event_type === t).length;
  return { queue: count("queue"), submits: count("snowball_submit"), green: count("green"), yellow: count("yellow"), blue: count("blue"), picks: count("pick"), picks_promoted: promoted, inserted: fresh.length, features_attached: features };
}

/** 큐 원장 행에 신호 시점 특징을 고정 저장 — 그날(queue_date) axes_daily 근거 + 종목 대표 산업. 이미 있으면 건드리지 않음 */
async function attachFeatures(): Promise<number> {
  const lr = await dbSelectAll<{ id: number; entity_id: string; market: Market; payload: Record<string, unknown> }>("signal_ledger", "select=id,entity_id,market,payload&event_type=eq.queue&payload->features=is.null&entity_id=not.is.null&order=id.asc");
  if (!lr.ok || !lr.data.length) return 0;
  const ents = await loadEntities();
  const dates = [...new Set(lr.data.map((l) => String(l.payload.queue_date)))];
  const ax = await dbSelectAll<{ date: string; entity_id: string; p_value: number | null; evidence: AxesEvidence }>("axes_daily", `select=date,entity_id,p_value,evidence&date=in.(${dates.join(",")})&entity_id=in.(${[...new Set(lr.data.map((l) => `"${l.entity_id}"`))].join(",")})`);
  const axBy = new Map((ax.ok ? ax.data : []).map((a) => [`${a.date}|${a.entity_id}`, a]));
  let n = 0;
  for (const l of lr.data) {
    const a = axBy.get(`${l.payload.queue_date}|${l.entity_id}`);
    const reason = (l.payload.reason ?? {}) as { p?: number | null; families?: string[] };
    const f: SignalFeatures = featuresOf({
      families: a?.evidence.families ?? reason.families ?? [], p: reason.p ?? a?.p_value ?? null,
      grade: a?.evidence.F?.grade ?? null, market: l.market, l1: ents.byId.get(l.entity_id)?.primary_l1 ?? null,
    });
    const u = await dbUpdate("signal_ledger", `id=eq.${l.id}`, { payload: { ...l.payload, features: f, features_source: a ? "axes_daily" : "queue_reason" } });
    if (u.ok) n++;
  }
  return n;
}

/** 큐·특징 구간별 성과 → perf_stats (as_of 하루 1벌, 재실행 시 교체) */
async function writePerfStats(asOf: string, samples: Sample[]) {
  const F = rules().feedback;
  const stats = attribute(samples, F);
  const del = await dbDelete("perf_stats", `as_of=eq.${asOf}`);
  if (!del.ok) throw new Error(del.reason);
  for (let i = 0; i < stats.length; i += 500) {
    const w = await dbInsert("perf_stats", stats.slice(i, i + 500).map((s) => ({ as_of: asOf, ...s })));
    if (!w.ok) throw new Error(w.reason);
  }
  const primary = stats.filter((s) => s.horizon_days === F.primary_horizon && s.dimension === "all");
  return { stats, rows: stats.length, primary_horizon: F.primary_horizon, by_queue: primary.map((s) => ({ queue: s.scope, n: s.n, median_excess: s.median_excess, hit_rate: s.hit_rate, ranking_active: s.n >= F.min_samples })) };
}

/** 사후 검증 → 배운 추천 기준(bot_state.pick_policy). 기준이 바뀐 날은 이력에 남긴다(최근 30개) */
async function writePolicy(asOf: string, stats: Parameters<typeof derivePolicy>[0]) {
  const R = rules();
  const policy = derivePolicy(stats, R.pick_policy, R.feedback.primary_horizon, asOf);
  const prev = await getState<{ policy?: Policy; history?: { as_of: string; added: string[]; removed: string[] }[] }>("pick_policy");
  const was = new Set((prev?.policy?.exclude ?? []).map((x) => x.title));
  const now = new Set(policy.exclude.map((x) => x.title));
  const added = [...now].filter((t) => !was.has(t)), removed = [...was].filter((t) => !now.has(t));
  const history = [...(added.length || removed.length ? [{ as_of: asOf, added, removed }] : []), ...(prev?.history ?? [])].slice(0, 30);
  const at = new Date().toISOString();
  const w = await dbInsert("bot_state", [{ key: "pick_policy", value: { policy, history, at }, updated_at: at }], { upsertOn: "key" });
  if (!w.ok) throw new Error(w.reason);
  return { exclude: policy.exclude.map((x) => x.title), prefer: policy.prefer.map((x) => x.title), added, removed, overall: policy.overall };
}

export async function updateOutcomes(now = new Date()) {
  const R = rules().outcomes;
  const horizons = R.horizons_days;
  const maxH = Math.max(...horizons);
  const ledger = await syncLedger();

  // 측정 대상: 최근 1년 신호 중 진입가 미확정 또는 일부 기간 미측정
  const since = kstDate(new Date(now.getTime() - 365 * 86400_000));
  const lr = await dbSelectAll<LedgerRow>("signal_ledger", "select=id,event_type,entity_id,market,tag,level,signal_date,entry_date,benchmark,payload&order=id.asc");
  if (!lr.ok) throw new Error(lr.reason);
  const or = await dbSelectAll<OutRow>("outcomes", "select=ledger_id,horizon_days,ret_pct,excess_pct&order=ledger_id.asc,horizon_days.asc");
  if (!or.ok) throw new Error(or.reason);
  const done = new Map<number, Set<number>>();
  for (const o of or.data) done.set(o.ledger_id, (done.get(o.ledger_id) ?? new Set()).add(o.horizon_days));
  const pending = lr.data.filter((l) => l.entity_id && l.signal_date >= since && (!l.entry_date || horizons.some((h) => !done.get(l.id)?.has(h))));

  const yahooKnown = await krYahoo(pending.map((l) => l.entity_id as string));
  const benchBars = new Map<Benchmark, Bar[]>();
  for (const [b, src] of Object.entries(R.benchmark_symbols) as [Benchmark, { source: "naver" | "yahoo"; sym: string }][]) {
    const x = await benchSeries(src);
    if (x) benchBars.set(b, x);
  }

  const cache = new Map<string, Series | null>();
  const failed: string[] = [];
  let entries = 0, inserted = 0;
  for (const l of pending) {
    const id = l.entity_id as string;
    if (!cache.has(id)) cache.set(id, await series(id, (l.payload.exchange as string | undefined) ?? yahooKnown.get(id) ?? null));
    const px = cache.get(id);
    if (!px) { failed.push(id); continue; }
    const bench = l.benchmark ?? benchmarkFor(l.market, px.exchange);
    const m = measure(px.bars, bench ? benchBars.get(bench) ?? null : null, l.signal_date, horizons, lastCompleteDate(now, l.market));
    if (!m.entry) continue;
    if (!l.entry_date || !l.benchmark) {
      const u = await dbUpdate("signal_ledger", `id=eq.${l.id}`, { entry_date: m.entry.date, entry_price: m.entry.close, benchmark: bench, payload: { ...l.payload, price_source: px.source, price_symbol: px.symbol, exchange: px.exchange } });
      if (u.ok) entries++;
    }
    const rows = m.outcomes.filter((o) => !done.get(l.id)?.has(o.horizon_days)).map((o) => ({ ledger_id: l.id, ...o, measured_at: now.toISOString() }));
    if (rows.length) {
      const w = await dbInsert("outcomes", rows, { upsertOn: "ledger_id,horizon_days", ignoreDuplicates: true });
      if (!w.ok) throw new Error(w.reason);
      inserted += rows.length;
      for (const o of rows) done.set(l.id, (done.get(l.id) ?? new Set()).add(o.horizon_days));
      or.data.push(...rows.map((o) => ({ ledger_id: o.ledger_id, horizon_days: o.horizon_days, ret_pct: o.ret_pct, excess_pct: o.excess_pct })));
    }
  }

  // 요약 (참고용 — 표본 30건 미만은 보정 근거 아님)
  const byId = new Map(lr.data.map((l) => [l.id, l]));
  const score: ScoreInput[] = [];
  const samples: Sample[] = [];
  for (const o of or.data) {
    const l = byId.get(o.ledger_id);
    if (!l) continue;
    const ret = Number(o.ret_pct), ex = o.excess_pct === null ? null : Number(o.excess_pct);
    score.push({ event_type: l.event_type, tag: l.tag, level: l.level, market: l.market, horizon_days: o.horizon_days, ret_pct: ret, excess_pct: ex });
    // 성과 귀속: 큐 진입은 큐별, 🟢🟡🔵 는 단계별(제출은 같은 신호의 중복이라 제외), 브리핑 후보는 후보 전체(pick_all) + 실제 추천(pick)
    const base = { level: l.level, horizon_days: o.horizon_days, ret_pct: ret, excess_pct: ex, features: (l.payload.features as SignalFeatures | undefined) ?? null };
    if (l.event_type === "pick") {
      samples.push({ ...base, scope: "pick_all" });
      if (l.payload.picked) samples.push({ ...base, scope: "pick" });
    } else if (l.event_type !== "snowball_submit") samples.push({ ...base, scope: l.event_type === "queue" ? l.tag : l.event_type });
  }
  return {
    ledger, measured_targets: pending.length, entries_filled: entries, outcomes_inserted: inserted,
    awaiting_full: lr.data.filter((l) => !done.get(l.id)?.has(maxH)).length,
    price_failed: [...new Set(failed)], benchmarks: [...benchBars.keys()],
    scorecard: scorecard(score, R.min_samples_for_calibration),
    ...(await (async () => {
      const { stats, ...perf } = await writePerfStats(kstDate(now), samples);
      return { perf_stats: perf, pick_policy: await writePolicy(kstDate(now), stats) };
    })()),
  };
}
