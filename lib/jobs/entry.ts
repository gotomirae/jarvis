/**
 * entry_eval (PRD §7 · §14, P3) — 🟢 진입 신호 · 🟡 관찰 · 🔵 실적 돌파.
 *  ① 원천: 국내 Heimdallr entry_checks · 미국 HermesCall entry_checks_us(M1·M2·M5, D13) + JARVIS M3(industry_heat)·M4(catalyst_events + catalyst_watch)
 *  ② 기대 거래일(지수 일봉 기준)보다 오래된 원천 값은 "원천 지연" — 🟢 를 만들지 않는다
 *  ③ 🟢 = lib/engine/entry.ts entryLevel 하나만(불변 규칙 4). 게이트는 거부만
 *  ④ 발송: 같은 종목 14거래일 재발송 금지, 하루 국내 2·미국 1, 나머지는 대시보드(/entry)만. 첫 🟢 는 SnowBall draft 제출
 *  ⑤ 🟢 이후 20거래일 안에 보유 종목이 무효화선을 이탈하면 ⚠️ 보유 경고(알림 정지 중이면 기록만)
 * 두 시장을 매 실행마다 함께 평가한다 — 원천이 늦게 도착해도 다음 실행(07:12·19:10·21:40)이 이어서 판정한다.
 */
import { linksConfig, taxonomyConfig } from "@/lib/config/load";
import { dbInsert, dbSelect, dbSelectAll, dbUpsertBatched } from "@/lib/db";
import { m4ForEntity, type CatalystEvent } from "@/lib/engine/catalysts";
import { armedOn, fromH1, fromK1, type Breakout } from "@/lib/engine/breakout";
import { conds, entryLevel, entryTag, freshOrStale, invalidationPrice, missing, normalizeCheck, passOf, type Cond, type Level } from "@/lib/engine/entry";
import { condLines, INVALIDATION_BASIS, priceText, TAG_NAME } from "@/lib/engine/entry-view";
import type { AxesEvidence } from "@/lib/engine/explain";
import { featuresOf, perfPrior, type PerfStat } from "@/lib/engine/feedback";
import { gateDecision, selectToSend, tradingDaysBack, type GreenCand } from "@/lib/engine/gate";
import { env } from "@/lib/env";
import { read as heimdallr } from "@/lib/ingest/heimdallr";
import { read as hermes } from "@/lib/ingest/hermescall";
import { chart, naverDaily } from "@/lib/ingest/market";
import { submitIdea } from "@/lib/ingest/snowball";
import { stockKeyboard, type LinkEntity } from "@/lib/links";
import { lastCompleteDate, type Market } from "@/lib/outcomes/returns";
import { sendMessage } from "@/lib/telegram/send";
import { greenText, holdingAlertText } from "@/lib/telegram/templates";
import { kstDate } from "@/lib/time";
import { latestHoldings, loadEntities, rules, type EntityRow } from "./context";
import { currentRegime } from "./pipeline";
import { getState } from "./poll";
import { priUsLiteMap } from "./pri-us";

type Heat = { l1: string; m3_pass: boolean | null; m3_median_rev_yoy_q0: number | null; m3_median_rev_yoy_q1: number | null; m3_members: number | null;
  m3_basis: { bases?: Record<string, boolean>; us_major_broker?: { detail?: { broker: string; value: number; published: string }[] } | null; outlook?: { segment?: string; cagr: number; source: string }[] } | null };
type Raw = Record<string, unknown> & { check_date: string; m1_detail?: Record<string, unknown> | null };

const sg = (x: number | null) => (x === null ? "-" : `${x > 0 ? "+" : ""}${Math.round(x * 10) / 10}%`);

/** 기대 거래일 = 지수 일봉 중 확정 종가 상한 이하 마지막 날짜 (실패하면 null → 원천 최신일로 대체) */
async function expectedDate(market: Market, now: Date): Promise<string | null> {
  const upTo = lastCompleteDate(now, market);
  const bars = market === "KR" ? await naverDaily("KOSPI", 10) : await chart("^GSPC", "1mo").then((r) => (r.ok ? { ok: true as const, data: r.data.closes } : r));
  if (!bars.ok) return null;
  return [...bars.data].reverse().find((b) => b.date <= upTo)?.date ?? null;
}

/** 원천 행: 최근 10일 중 종목별 최신 */
function latestPer<T extends Raw>(rows: T[], key: (r: T) => string): T[] {
  const m = new Map<string, T>();
  for (const r of rows) { const k = key(r); if (!m.has(k) || r.check_date > m.get(k)!.check_date) m.set(k, r); }
  return [...m.values()];
}

function m3Cond(e: EntityRow, heat: Map<string, Heat>, l1Name: (c: string) => string): { cond: Cond; lines: string[]; growth: number | null } {
  const passed = e.l1_codes.filter((c) => heat.get(c)?.m3_pass);
  if (!passed.length) return { cond: { pass: false, reason: e.l1_codes.length ? `산업(${e.l1_codes.map(l1Name).join("·")}) 성장 근거 없음` : "산업 미분류" }, lines: [], growth: null };
  const lines: string[] = [];
  let growth: number | null = null;
  for (const c of passed) {
    const h = heat.get(c)!, b = h.m3_basis?.bases ?? {};
    if (b.realized) { lines.push(`실제 실적 ${l1Name(c)} 매출 전년 대비 중앙값 ${sg(h.m3_median_rev_yoy_q0)}·${sg(h.m3_median_rev_yoy_q1)} (${h.m3_members ?? "-"}개 기업)`); growth = Math.max(growth ?? -Infinity, h.m3_median_rev_yoy_q0 ?? -Infinity); }
    if (b.us_major_broker) for (const d of h.m3_basis?.us_major_broker?.detail ?? []) lines.push(`${d.broker} ${l1Name(c)} 성장 전망 ${d.value}% (${d.published})`);
    if (b.outlook) for (const o of h.m3_basis?.outlook ?? []) lines.push(`${o.source} ${o.segment ?? l1Name(c)} 연평균 ${o.cagr}%`);
  }
  return { cond: { pass: true, reason: null }, lines: lines.slice(0, 3), growth: Number.isFinite(growth as number) ? growth : null };
}

export type EntryOut = Record<string, unknown>;

export async function runEntryEval(now = new Date(), opts: { send?: boolean } = {}): Promise<EntryOut> {
  const R = rules();
  const tx = taxonomyConfig();
  const l1Name = (c: string) => tx.l1.find((r) => r.code === c)?.name ?? c;
  const today = kstDate(now);
  const since10 = kstDate(new Date(now.getTime() - 10 * 86400_000));

  const [ents, holdings, kr, us, heatLast, cats, cw, k1, h1, expKR, expUS, ax] = await Promise.all([
    loadEntities(), latestHoldings(),
    heimdallr<Raw & { code: string }>("entry_checks", { select: "*", filters: { check_date: `gte.${since10}` } }),
    hermes<Raw & { symbol: string }>("entry_checks_us", { select: "*", filters: { check_date: `gte.${since10}` } }),
    dbSelect<{ date: string }>("industry_heat", "select=date&order=date.desc&limit=1"),
    dbSelectAll<CatalystEvent>("catalyst_events", `select=scope,entity_id,l1,title,date,window_end,direction,source,url,origin,dedupe_key&or=(date.gte.${today},window_end.gte.${today})`),
    hermes<{ beneficiary_code: string; leader_symbol: string; event_date: string; leader_ret: number | null; bene_ret: number | null; expires_at: string | null; triggers_timeline: Record<string, { event?: string; expected_by?: string }[]> | null }>("catalyst_watch", { select: "beneficiary_code,leader_symbol,event_date,leader_ret,bene_ret,expires_at,triggers_timeline", filters: { expires_at: `gte.${now.toISOString()}` } }),
    heimdallr<{ code: string; payload: Record<string, unknown> | null }>("notifications", { select: "code,payload", filters: { kind: "eq.earnings_breakout" } }),
    hermes<{ symbol: string; signal: Record<string, unknown> | null; role: string | null }>("technical_ideas", { select: "symbol,signal,role", filters: { setup: "eq.H1" } }),
    expectedDate("KR", now), expectedDate("US", now),
    dbSelectAll<{ entity_id: string; date: string; evidence: AxesEvidence }>("axes_daily", `select=entity_id,date,evidence&date=gte.${kstDate(new Date(now.getTime() - 3 * 86400_000))}&order=date.desc`),
  ]);
  const heat = new Map<string, Heat>();
  if (heatLast.ok && heatLast.data[0]) {
    const h = await dbSelectAll<Heat>("industry_heat", `select=l1,m3_pass,m3_median_rev_yoy_q0,m3_median_rev_yoy_q1,m3_members,m3_basis&date=eq.${heatLast.data[0].date}`);
    for (const x of h.ok ? h.data : []) heat.set(x.l1, x);
  }
  const axBy = new Map<string, AxesEvidence>();
  for (const a of ax.ok ? ax.data : []) if (!axBy.has(a.entity_id)) axBy.set(a.entity_id, a.evidence);
  const heldBy = new Map(holdings.positions.filter((p) => p.entity_id && p.asset_class === "stock").map((p) => [p.entity_id as string, p]));

  // M4 이벤트: catalyst_events + 캐치업 후보(HermesCall catalyst_watch, 대장주 실적 후속)
  const events: CatalystEvent[] = [...(cats.ok ? cats.data : [])];
  const cuSet = new Set<string>();
  for (const c of cw.ok ? cw.data : []) {
    const id = `KR:${c.beneficiary_code}`;
    cuSet.add(id);
    const until = (c.expires_at ?? "").slice(0, 10);
    if (until) events.push({ scope: "company", entity_id: id, l1: null, title: `${c.leader_symbol} 실적 후 캐치업 (대장주 ${sg(c.leader_ret)} · 수혜주 ${sg(c.bene_ret)})`, date: null, window_end: until, direction: "up", source: "HermesCall 캐치업", url: null, origin: "hermes", dedupe_key: `cw:${c.leader_symbol}:${c.event_date}:${c.beneficiary_code}` });
  }
  const BW = R.breakout_watch;
  const breakouts: Breakout[] = [...fromK1(k1.ok ? k1.data : [], BW.K1_kr.arm_days), ...fromH1(h1.ok ? h1.data : [], BW.H1_us.arm_days)].filter((b) => ents.byId.has(b.entity_id));

  // 미국 주가 반영도 (M1 "반영도 낮음" · 게이트)
  const usRows = latestPer(us.ok ? us.data : [], (r) => r.symbol);
  const pri = await priUsLiteMap(usRows.map((r) => r.symbol), now);

  const rows: Record<string, unknown>[] = [];
  const greens: (GreenCand & { row: Record<string, unknown>; e: EntityRow })[] = [];
  const dist: Record<string, number> = { evaluated: 0, stale: 0, m1: 0, m2: 0, m3: 0, m4: 0, m5: 0, yellow: 0, green: 0, gate_blocked: 0 };
  const stats = await perfStats("green");
  const reg = await regimeNow(now);
  const evalOne = (raw: Raw, id: string, market: Market, expected: string | null) => {
    const e = ents.byId.get(id);
    if (!e) return;
    const priUs = market === "US" ? pri.get(e.symbol.toUpperCase()) ?? null : null;
    const sc = freshOrStale(normalizeCheck(raw, market, priUs, R.entry_gate.pri_hard_max), expected);
    dist.evaluated++;
    if (sc.m1.reason?.startsWith("원천 지연")) dist.stale++;
    const m3 = m3Cond(e, heat, l1Name);
    const m4r = m4ForEntity(id, e.l1_codes, events, today, R.entry_core.M4_catalyst_within_6m.horizon_days);
    const m4: Cond = m4r.pass ? { pass: true, reason: null } : { pass: false, reason: "6개월 내 출처 있는 상승 이벤트 없음" };
    const c = conds(sc, m3.cond, m4);
    for (const k of ["m1", "m2", "m3", "m4", "m5"] as const) if (c[k].pass) dist[k]++;
    const armed = armedOn(breakouts, id, today);
    const tag = entryTag({ armedBreakout: !!armed, catalystWatch: cuSet.has(id), priceState: sc.price_state });
    const axe = axBy.get(id);
    const p = market === "KR" ? ((raw.m1_detail?.pri as number | undefined) ?? axe?.P?.value ?? null) : priUs;
    const grade = (raw.m1_detail?.grade as string | undefined) ?? axe?.F?.grade ?? null;
    const h = heldBy.get(id);
    const gate = gateDecision({ market, p, riskOff: reg.risk_off, grade, usFilters: axe?.F?.us_filters ?? axe?.C?.us_filters ?? [], holding: h ? { weight: h.weight, allowed_weight: h.allowed_weight } : null },
      R.entry_gate, R.regime.risk_off_effects.buy_requires);
    const level: Level = entryLevel(passOf(c), gate);
    const keep = level !== "none" || c.m1.pass || (c.m2.pass && c.m5.pass) || !!armed || !!h;
    if (level === "yellow") dist.yellow++;
    if (passOf(c).m1 && passOf(c).m2 && passOf(c).m3 && passOf(c).m4 && passOf(c).m5 && !gate.allowed) dist.gate_blocked++;
    if (!keep) return;
    const inv = invalidationPrice(tag, sc, armed?.d0_low ?? null);
    const evidence = {
      m1: { ...c.m1, detail: sc.detail.m1 }, m2: { ...c.m2, detail: sc.detail.m2 }, m5: { ...c.m5, detail: sc.detail.m5 },
      m3: { ...c.m3, lines: m3.lines }, m4: { ...c.m4, events: m4r.nearest.map((x) => ({ when: (x.date ?? x.window_end ?? "").slice(5).replace("-", "/"), date: x.date ?? x.window_end, title: x.title, source: x.source })) },
      source_date: sc.check_date, expected_date: expected, missing: missing(c), p, grade, families: axe?.families ?? [], pri_us_lite: priUs,
      breakout: armed ? { source: armed.source, d0: armed.d0, d0_low: armed.d0_low } : null, held: !!h,
    };
    const row = { date: expected ?? sc.check_date, entity_id: id, market, m1: c.m1.pass, m2: c.m2.pass, m3: c.m3.pass, m4: c.m4.pass, m5: c.m5.pass, evidence, level, tag, invalidation_price: inv, first_weight_pct: gate.first_weight_pct, gate_result: { allowed: gate.allowed, reasons: gate.reasons, weight_limited: gate.weight_limited } };
    rows.push(row);
    if (level === "green") {
      dist.green++;
      const prior = perfPrior(featuresOf({ families: axe?.families, p, grade, market, l1: e.primary_l1 }), stats, "green", R.feedback);
      greens.push({ entity_id: id, market, families: axe?.families?.length ?? 0, p, m3Growth: m3.growth, nearestEvent: evidence.m4.events[0]?.date ?? null, perf: prior.score, row, e });
    }
  };
  for (const r of latestPer(kr.ok ? kr.data : [], (x) => x.code)) evalOne(r, `KR:${r.code}`, "KR", expKR);
  for (const r of usRows) evalOne(r, `US:${r.symbol.toUpperCase()}`, "US", expUS);

  // 🔵 무장 기록 + 🟢 PEAD_PB 승격 표시
  const bw = breakouts.map((b) => ({ entity_id: b.entity_id, source: b.source, d0: b.d0, d0_low: b.d0_low, armed_until: b.armed_until, evidence: b.evidence }));
  if (bw.length) { const w = await dbUpsertBatched("breakout_watch", bw, "entity_id,source,d0"); if (!w.ok) throw new Error(w.reason); }

  // 발송 선택
  const recent = await dbSelectAll<{ entity_id: string; created_at: string }>("notifications", `select=entity_id,created_at&kind=eq.entry_green&created_at=gte.${tradingDaysBack(today, 30)}`);
  const recentMap = new Map<string, string>();
  const sentToday = { KR: 0, US: 0 };
  for (const n of recent.ok ? recent.data : []) {
    const d = kstDate(new Date(n.created_at));
    if (!recentMap.has(n.entity_id) || d > recentMap.get(n.entity_id)!) recentMap.set(n.entity_id, d);
    if (d === today) sentToday[n.entity_id.startsWith("US:") ? "US" : "KR"]++;
  }
  const pick = selectToSend(greens, recentMap, sentToday, today, R.gate.daily_green_max, R.gate.resend_block_trading_days);
  for (const g of pick.held) Object.assign(g.row.gate_result as object, { sent: false, note: "하루 발송 상한 — 대시보드에만 표시" });
  for (const g of pick.blocked) Object.assign(g.row.gate_result as object, { sent: false, note: `${R.gate.resend_block_trading_days}거래일 안에 이미 보냄` });

  const sent: string[] = [];
  if (opts.send !== false) {
    const chat = env().TELEGRAM_CHAT_ID;
    const lc = linksConfig();
    for (const g of pick.send) {
      const key = `green:${g.entity_id}:${g.row.date}`;
      const dup = await dbSelect("notifications", `select=id&dedupe_key=eq.${encodeURIComponent(key)}`);
      if (dup.ok && dup.data.length) continue;
      const ev = g.row.evidence as Record<string, { detail?: unknown; lines?: string[]; events?: { when: string; title: string; source: string }[] } & Cond>;
      const text = greenText({
        market: g.market, name: g.e.name, code: g.e.symbol, tag: g.row.tag as keyof typeof TAG_NAME | null,
        families: (g.row.evidence as { families: string[] }).families, p: g.p,
        lines: condLines({ m1: ev.m1, m2: ev.m2, m3: ev.m3, m4: ev.m4, m5: ev.m5 }, { m1: ev.m1.detail as never, m2: ev.m2.detail as never, m5: ev.m5.detail as never, m3_lines: ev.m3.lines, m4_events: ev.m4.events }),
        invalidation: g.row.invalidation_price === null ? null : `${priceText(g.row.invalidation_price as number, g.market)}${g.row.tag ? ` (${INVALIDATION_BASIS[g.row.tag as keyof typeof INVALIDATION_BASIS]})` : ""}`,
        firstWeightPct: g.row.first_weight_pct as number | null, riskOff: reg.risk_off,
      });
      const kb = stockKeyboard(g.e as unknown as LinkEntity, { links: lc, taxonomy: tx, jarvisUrl: env().JARVIS_URL });
      const r = chat ? await sendMessage(chat, text, kb) : { ok: false as const, reason: "TELEGRAM_CHAT_ID 미설정" };
      await dbInsert("notifications", [{ kind: "entry_green", dedupe_key: key, entity_id: g.entity_id, payload: { tag: g.row.tag, date: g.row.date, error: r.ok ? undefined : r.reason }, sent_at: r.ok ? new Date().toISOString() : null, telegram_msg_id: r.ok ? r.data[0] : null }], { ignoreDuplicates: true, upsertOn: "dedupe_key" });
      Object.assign(g.row.gate_result as object, { sent: r.ok, sent_at: r.ok ? new Date().toISOString() : null });
      if (r.ok) { sent.push(g.entity_id); await submitGreen(g, now); }
    }
  }
  const w = await dbUpsertBatched("entry_eval", rows, "date,entity_id");
  if (!w.ok) throw new Error(w.reason);
  for (const g of greens) if (g.row.tag === "PEAD_PB") {
    const b = armedOn(breakouts, g.entity_id, today);
    if (b) await dbInsert("breakout_watch", [{ entity_id: b.entity_id, source: b.source, d0: b.d0, d0_low: b.d0_low, armed_until: b.armed_until, evidence: b.evidence, promoted_at: now.toISOString() }], { upsertOn: "entity_id,source,d0" });
  }
  const breaches = await invalidationAlerts(now, heldBy, ents.byId);
  return { expected: { KR: expKR, US: expUS }, source_rows: { KR: kr.ok ? kr.data.length : kr.reason, US: us.ok ? us.data.length : us.reason }, distribution: dist, stored: rows.length,
    green: greens.map((g) => g.entity_id), sent, held: pick.held.map((g) => g.entity_id), blocked: pick.blocked.map((g) => g.entity_id),
    breakouts: breakouts.length, catalyst_watch: cuSet.size, regime: reg, invalidation_alerts: breaches };
}

async function regimeNow(now: Date): Promise<{ risk_off: boolean; reasons: string[] }> {
  const s = await getState<{ risk_off: boolean; reasons: string[]; at: string }>("regime");
  if (s && kstDate(new Date(s.at)) === kstDate(now)) return s;
  return currentRegime();
}

async function perfStats(scope: string): Promise<PerfStat[]> {
  const last = await dbSelect<{ as_of: string }>("perf_stats", "select=as_of&order=as_of.desc&limit=1");
  const asOf = last.ok ? last.data[0]?.as_of : undefined;
  if (!asOf) return [];
  const r = await dbSelectAll<PerfStat>("perf_stats", `select=scope,dimension,bucket,horizon_days,n,median_excess,hit_rate&as_of=eq.${asOf}&scope=eq.${scope}&horizon_days=eq.${rules().feedback.primary_horizon}`);
  return r.ok ? r.data : [];
}

/** 첫 🟢 → SnowBall draft (PRD §6.4, 하루 상한·7일 dedupe 는 파이프라인 제출과 공유) */
async function submitGreen(g: { entity_id: string; e: EntityRow; row: Record<string, unknown> }, now: Date) {
  const S = rules().queues.snowball_submit;
  const day = kstDate(now);
  const today = await dbSelect<{ dedupe_key: string }>("notifications", `select=dedupe_key&kind=eq.snowball_submit&created_at=gte.${day}T00:00:00%2B09:00`);
  if (!today.ok || today.data.length >= S.max_per_day) return;
  const key = `submit:${g.entity_id}:${Math.floor(now.getTime() / (S.dedupe_days * 86400_000))}`;
  const dup = await dbSelect("notifications", `select=id&dedupe_key=eq.${encodeURIComponent(key)}`);
  if (dup.ok && dup.data.length) return;
  const base = env().JARVIS_URL?.replace(/\/$/, "");
  const ev = g.row.evidence as Record<string, unknown>;
  const r = await submitIdea({
    ticker: g.e.symbol,
    idea: {
      headline: `[JARVIS 🟢 진입 신호] ${g.e.name}`,
      why_now: `M1~M5 모두 충족(${g.row.tag ? TAG_NAME[g.row.tag as keyof typeof TAG_NAME] : "태그 없음"}) · 무효화선 ${g.row.invalidation_price ?? "-"}. 매수 확정 신호 아님 — 논지·훼손조건은 SnowBall 에서 작성.`,
      evidence_urls: base ? [`${base}/stock/${encodeURIComponent(g.entity_id)}`] : [],
      jarvis_url: base ? `${base}/entry` : null,
      jarvis_entry: { date: g.row.date, tag: g.row.tag, invalidation_price: g.row.invalidation_price, first_weight_pct: g.row.first_weight_pct, m1: ev.m1, m2: ev.m2, m3: ev.m3, m4: ev.m4, m5: ev.m5 },
      jarvis_signals: [],
      confidence: 0.6,
    },
  });
  await dbInsert("notifications", [{ kind: "snowball_submit", dedupe_key: key, entity_id: g.entity_id, payload: r.ok ? { idea_id: r.data, queue: "green" } : { error: r.reason, queue: "green" }, sent_at: r.ok ? now.toISOString() : null }], { ignoreDuplicates: true, upsertOn: "dedupe_key" });
}

/** 🟢 후 20거래일 안에 보유 종목 종가가 무효화선 아래면 ⚠️ (PRD §7.5) — 알림 정지 중이면 기록만 */
async function invalidationAlerts(now: Date, heldBy: Map<string, { name: string; weight: number | null; allowed_weight: number | null; heat_score: number | null }>, byId: Map<string, EntityRow>): Promise<number> {
  const today = kstDate(now);
  const win = rules().queues.holding_alert.setup_invalidation_window_days ?? 20;
  const greens = await dbSelectAll<{ date: string; entity_id: string; invalidation_price: number | null; market: Market }>("entry_eval", `select=date,entity_id,invalidation_price,market&level=eq.green&date=gte.${tradingDaysBack(today, win)}&order=date.asc`);
  const latest = new Map<string, { date: string; invalidation_price: number | null; market: Market }>();
  for (const g of greens.ok ? greens.data : []) if (heldBy.has(g.entity_id) && g.invalidation_price !== null) latest.set(g.entity_id, g);
  if (!latest.size) return 0;
  const paused = (await getState<{ paused?: boolean }>("holding_alert_pause"))?.paused === true;
  const chat = env().TELEGRAM_CHAT_ID;
  let n = 0;
  for (const [id, g] of latest) {
    const e = byId.get(id);
    if (!e) continue;
    const bars = e.market === "KR" ? await naverDaily(e.symbol, 5) : await chart(e.symbol.replace(/\./g, "-"), "5d").then((r) => (r.ok ? { ok: true as const, data: r.data.closes } : r));
    if (!bars.ok) continue;
    const upTo = lastCompleteDate(now, e.market);
    const last = [...bars.data].reverse().find((b) => b.date <= upTo);
    if (!last || last.close >= (g.invalidation_price as number)) continue;
    const key = `invalidation:${id}:${g.date}`;
    const dup = await dbSelect("notifications", `select=id&dedupe_key=eq.${encodeURIComponent(key)}`);
    if (dup.ok && dup.data.length) continue;
    const h = heldBy.get(id)!;
    const summary = `🟢 진입 신호(${g.date}) 무효화선 ${priceText(g.invalidation_price, e.market)} 이탈 — 종가 ${priceText(last.close, e.market)}`;
    let r: { ok: boolean; data?: number[]; reason?: string } = { ok: false, reason: "알림 정지 중" };
    if (!paused && chat) {
      r = await sendMessage(chat, holdingAlertText({ market: e.market, name: e.name, code: e.symbol, causes: [{ summary, source: "JARVIS 진입 무효화선" }], thesisLink: null, weight: h.weight, allowed: h.allowed_weight, heat: h.heat_score, pri: null }),
        stockKeyboard(e as unknown as LinkEntity, { links: linksConfig(), taxonomy: taxonomyConfig(), jarvisUrl: env().JARVIS_URL }));
    }
    await dbInsert("notifications", [{ kind: "holding_alert", dedupe_key: key, entity_id: id, payload: { cause: "invalidation", summary, source: "JARVIS 진입 무효화선", paused, error: r.ok ? undefined : r.reason }, sent_at: r.ok ? new Date().toISOString() : null, telegram_msg_id: r.ok ? r.data?.[0] ?? null : null }], { ignoreDuplicates: true, upsertOn: "dedupe_key" });
    n++;
  }
  return n;
}
