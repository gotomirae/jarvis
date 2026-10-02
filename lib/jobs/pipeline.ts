/**
 * axes → queues → SnowBall 제출 (PRD §6.2~6.4, §14 07:10·19:10). 🟢 판정은 이어서 entry_eval(lib/jobs/entry.ts).
 *  · 대상: 유효 신호가 있거나 보유 중인 개별 종목(asset_class=stock) — ETF·펀드는 신호 대상 아님(SnowBall 인계)
 *  · 🎯·🔭 에 새로 들어온 종목은 SnowBall draft 로 제출(하루 3건, 같은 종목 7일 1회)
 */
import { dbDelete, dbInsert, dbSelect, dbSelectAll, dbUpsertBatched } from "@/lib/db";
import { taxonomyConfig } from "@/lib/config/load";
import { computeAxes, type Axes, type EntityCtx } from "@/lib/engine/axes";
import { l2Members } from "@/lib/entities";
import { assignQueue, type Queue } from "@/lib/engine/queues";
import { regime } from "@/lib/engine/regime";
import type { ScreenRow } from "@/lib/engine/normalize";
import type { Signal } from "@/lib/engine/types";
import { env } from "@/lib/env";
import { read as heimdallr } from "@/lib/ingest/heimdallr";
import { read as hermes } from "@/lib/ingest/hermescall";
import { chart } from "@/lib/ingest/market";
import { exportMacro, submitIdea } from "@/lib/ingest/snowball";
import { kstDate } from "@/lib/time";
import { activeSignals, latestHoldings, loadEntities, rules, type EntityIndex } from "./context";
import { ideaEvidence } from "./idea";
import { latestScreens } from "./ingest";
import { priUsLiteMap } from "./pri-us";
import { techRefs } from "./tech";

export async function currentRegime(): Promise<{ risk_off: boolean; reasons: string[]; vix: number | null; snowball: number | null }> {
  const R = rules();
  const [macro, vix, kospi] = await Promise.all([exportMacro(), chart(R.market.regime.vix, "5d"), chart(R.market.regime.kospi, "6mo")]);
  const sb = macro.ok ? macro.data.REGIME?.value ?? null : null;
  const v = vix.ok ? vix.data.last : null;
  const r = regime({ snowballRegime: sb, vix: v, kospiCloses: kospi.ok ? kospi.data.closes.map((c) => c.close) : [] }, R.regime);
  return { risk_off: r.risk_off, reasons: r.reasons, vix: v, snowball: sb };
}

/** 국내 다음 실적 예상: 다가오는 분기 보고 기한(분기말+45일) */
function krDaysToEarnings(now: Date): number {
  for (let i = 0; i < 6; i++) {
    const q = Math.floor(now.getUTCMonth() / 3) + i - 1;
    const fy = now.getUTCFullYear() + Math.floor(q / 4);
    const fq = ((q % 4) + 4) % 4;
    const deadline = new Date(Date.UTC(fy, fq * 3 + 3, 0) + 45 * 86400_000);
    const days = Math.ceil((deadline.getTime() - now.getTime()) / 86400_000);
    if (days >= 0) return days;
  }
  return 45;
}

export type PipelineOut = { date: string; evaluated: number; queues: Record<string, number>; removed: number; submitted: string[]; regime: Awaited<ReturnType<typeof currentRegime>> };

export async function runPipeline(now = new Date(), opts: { submit?: boolean } = {}): Promise<PipelineOut> {
  const R = rules();
  const date = kstDate(now);
  const [ents, signals, holdings, sr, ee, recentAlerts, reg, krx] = await Promise.all([
    loadEntities(),
    activeSignals(now),
    latestHoldings(),
    heimdallr<ScreenRow>("screen_results", { select: "code,fiscal_year,fiscal_quarter,grade,gate_passed,score_final,score_delta,pri,base_effect_warning,computed_at" }),
    hermes<{ symbol: string; expected_at: string }>("earnings_events", { select: "symbol,expected_at", filters: { expected_at: `gte.${now.toISOString()}` } }),
    dbSelectAll<{ entity_id: string | null }>("notifications", `select=entity_id&kind=eq.holding_alert&created_at=gte.${new Date(now.getTime() - 7 * 86400_000).toISOString()}`),
    currentRegime(),
    heimdallr<{ code: string; sector: string | null; industry: string | null }>("krx_universe", { select: "code,sector,industry" }),
  ]);
  const scopes = taxonomyConfig().narrative_l2_scope ?? [];
  const krxBy = new Map((krx.ok ? krx.data : []).map((k) => [`KR:${k.code}`, k]));
  const screens = new Map((sr.ok ? latestScreens(sr.data) : []).map((s) => [`KR:${s.code}`, s]));
  const usFilters = new Map<string, string[]>();
  for (const s of signals) if (s.kind === "earnings_quality_us" && s.entity_id) usFilters.set(s.entity_id, (s.evidence.flags as string[]) ?? []);
  const nextUs = new Map<string, number>();
  for (const e of ee.ok ? ee.data : []) {
    const id = `US:${e.symbol}`;
    const d = Math.ceil((new Date(e.expected_at).getTime() - now.getTime()) / 86400_000);
    if (!nextUs.has(id) || d < nextUs.get(id)!) nextUs.set(id, d);
  }
  const heldById = new Map(holdings.positions.filter((p) => p.entity_id && p.asset_class === "stock").map((p) => [p.entity_id as string, p]));
  const alerted = new Set((recentAlerts.ok ? recentAlerts.data : []).map((a) => a.entity_id).filter(Boolean) as string[]);

  // 평가 대상: 종목 단위 신호가 있는 종목 + 보유 종목 (산업 신호만 있는 종목은 F·C 가 없어 큐에 들 수 없다)
  const targets = new Set<string>([...heldById.keys()]);
  for (const s of signals) if (s.entity_id && s.kind !== "holding_risk") targets.add(s.entity_id);
  const krDays = krDaysToEarnings(now);
  // 미국 주가 반영도(간이, PRD §7.6) — P축·💰·⏳ 판정에 사용
  const priUs = await priUsLiteMap([...targets].filter((id) => id.startsWith("US:")).map((id) => id.slice(3)), now);

  const axesRows: Record<string, unknown>[] = [];
  const queueRows: { entity_id: string; queue: Queue; reason: Record<string, unknown> }[] = [];
  const axesById = new Map<string, Axes>();
  for (const id of targets) {
    const e = ents.byId.get(id);
    if (!e || (e.asset_class && e.asset_class !== "stock")) continue;
    const h = heldById.get(id);
    const scr = screens.get(id);
    const ctx: EntityCtx = {
      id, market: e.market, l1_codes: e.l1_codes,
      screen: scr ? { gate_passed: scr.gate_passed, score_final: scr.score_final, pri: scr.pri, grade: scr.grade } : null,
      usFilters: usFilters.get(id) ?? null, priUsLite: e.market === "US" ? priUs.get(e.symbol.toUpperCase()) ?? null : null,
      holding: h ? { weight: h.weight, allowed_weight: h.allowed_weight, heat_score: h.heat_score } : null,
      l2Scope: { scoped: scopes.map((s) => s.l2), member: l2Members({ snowballSector: h?.sector, heimdallrSector: krxBy.get(id)?.sector, krxIndustry: krxBy.get(id)?.industry }, scopes) },
    };
    const a = computeAxes(ctx, signals, R.axes, now);
    axesById.set(id, a);
    axesRows.push({ date, entity_id: id, n_on: a.n, c_on: a.c, f_on: a.f, p_value: a.p, h_held: a.h, evidence: { ...a.evidence, families: a.families } });
    const q = assignQueue({ axes: a, heat: h?.heat_score ?? null, holdingAlert: alerted.has(id), daysToEarnings: e.market === "US" ? nextUs.get(id) ?? null : krDays }, R.queues, R.axes.P);
    if (q) queueRows.push({ entity_id: id, ...q });
  }

  // 큐에 든 종목은 기술적 참고(판정 미사용)를 근거에 저장 — 화면·브리핑은 DB 만 읽는다(PRD §8)
  const tech = await techRefs(queueRows.map((q) => q.entity_id), now);
  for (const r of axesRows) { const t = tech.get(r.entity_id as string); if (t) (r.evidence as Record<string, unknown>).tech = t; }
  // 🎯 매수 검토 종목은 투자 아이디어·매수 근거(원 프로젝트 분석·분기 실적·산업 성장·이벤트·리스크)를 함께 저장 — 표시 전용
  const ideas = await ideaEvidence(queueRows.filter((q) => q.queue === "buy").map((q) => q.entity_id), ents, now);
  for (const r of axesRows) {
    const x = ideas.get(r.entity_id as string);
    if (x) Object.assign(r.evidence as Record<string, unknown>, { idea: x.idea, next_event: x.nextEvent });
  }

  // first_seen 유지: 최근 30일 같은 큐에 있었으면 그때부터
  const prev = await dbSelectAll<{ entity_id: string; queue: string; first_seen: string; date: string }>("queue_items", `select=entity_id,queue,first_seen,date&date=gte.${kstDate(new Date(now.getTime() - 30 * 86400_000))}&date=lt.${date}&order=date.desc`);
  const prevMap = new Map<string, { first_seen: string; queue: string; date: string }>();
  for (const p of prev.ok ? prev.data : []) if (!prevMap.has(`${p.entity_id}|${p.queue}`)) prevMap.set(`${p.entity_id}|${p.queue}`, p);
  const nowIso = now.toISOString();
  const qRows = queueRows.map((q) => ({ date, entity_id: q.entity_id, queue: q.queue, reason: q.reason, first_seen: prevMap.get(`${q.entity_id}|${q.queue}`)?.first_seen ?? nowIso, last_seen: nowIso, status: "open" }));

  const w1 = await dbUpsertBatched("axes_daily", axesRows, "date,entity_id");
  if (!w1.ok) throw new Error(w1.reason);
  const w2 = await dbUpsertBatched("queue_items", qRows, "date,entity_id");
  if (!w2.ok) throw new Error(w2.reason);
  // 같은 날 재실행(07:12 → 19:10)에서 큐를 벗어난 종목은 오늘 행을 지운다 — 남겨 두면 브리핑·대시보드에 옛 판정이 섞인다
  const keep = qRows.map((q) => `"${q.entity_id}"`);
  const stale = await dbDelete("queue_items", `date=eq.${date}${keep.length ? `&entity_id=not.in.(${keep.join(",")})` : ""}`);
  if (!stale.ok) throw new Error(stale.reason);

  await dbInsert("bot_state", [{ key: "regime", value: { ...reg, at: nowIso }, updated_at: nowIso }], { upsertOn: "key" });
  const submitted = opts.submit === false ? [] : await submitNewIdeas(qRows.filter((q) => !prevMap.has(`${q.entity_id}|${q.queue}`)), ents, signals, axesById, now);
  const counts = qRows.reduce<Record<string, number>>((m, q) => ((m[q.queue] = (m[q.queue] ?? 0) + 1), m), {});
  return { date, evaluated: axesRows.length, queues: counts, removed: stale.data, submitted, regime: reg };
}

/** 🎯·🔭 첫 진입 → SnowBall jarvis_submit_idea (draft). 하루 max_per_day, 같은 종목 dedupe_days 안에 재제출 안 함 */
async function submitNewIdeas(fresh: { entity_id: string; queue: string }[], ents: EntityIndex, signals: Signal[], axes: Map<string, Axes>, now: Date): Promise<string[]> {
  const S = rules().queues.snowball_submit;
  const day = kstDate(now);
  const today = await dbSelect<{ dedupe_key: string }>("notifications", `select=dedupe_key&kind=eq.snowball_submit&created_at=gte.${day}T00:00:00%2B09:00`);
  let left = S.max_per_day - (today.ok ? today.data.length : S.max_per_day);
  const out: string[] = [];
  const base = env().JARVIS_URL?.replace(/\/$/, "");
  for (const q of fresh.filter((x) => S.queues.includes(x.queue))) {
    if (left <= 0) break;
    const e = ents.byId.get(q.entity_id);
    if (!e) continue;
    const bucket = Math.floor(now.getTime() / (S.dedupe_days * 86400_000));
    const key = `submit:${e.id}:${bucket}`;
    const dup = await dbSelect("notifications", `select=id&dedupe_key=eq.${encodeURIComponent(key)}`);
    if (dup.ok && dup.data.length) continue;
    const a = axes.get(e.id);
    const mine = signals.filter((s) => s.entity_id === e.id || (s.entity_id === null && s.l1_codes.some((c) => e.l1_codes.includes(c))));
    const label = q.queue === "buy" ? "🎯 매수 검토" : "🔭 선행 레이더";
    const r = await submitIdea({
      ticker: e.symbol,
      idea: {
        headline: `[JARVIS ${label}] ${e.name}`,
        why_now: `JARVIS 축 N=${a?.n ? "ON" : "off"} · C=${a?.c ? "ON" : "off"} · F=${a?.f ? "ON" : "off"} · P=${a?.p ?? "-"} · 계열 ${a?.families.join("/") ?? "-"}. 매수 확정 신호 아님 — 논지·훼손조건은 SnowBall 에서 작성.`,
        evidence_urls: base ? [`${base}/stock/${encodeURIComponent(e.id)}`] : [],
        jarvis_url: base ? `${base}/stock/${encodeURIComponent(e.id)}` : null,
        jarvis_entry: null,
        jarvis_signals: mine.slice(0, 10).map((s) => ({ source: s.source, kind: s.kind, direction: s.direction, strength: s.strength, observed_at: s.observed_at, l1_codes: s.l1_codes })),
        confidence: 0.5,
      },
    });
    await dbInsert("notifications", [{ kind: "snowball_submit", dedupe_key: key, entity_id: e.id, payload: r.ok ? { idea_id: r.data, queue: q.queue } : { error: r.reason, queue: q.queue }, sent_at: r.ok ? now.toISOString() : null }], { ignoreDuplicates: true, upsertOn: "dedupe_key" });
    if (r.ok) { out.push(e.id); left--; }
  }
  return out;
}
