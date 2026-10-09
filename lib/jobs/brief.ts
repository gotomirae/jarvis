/**
 * ☀️ 아침(07:30) · 🌙 저녁(19:20) 브리핑 (PRD §9.2, 부록 B.2). pg_cron → Vercel 라우트(정시), Actions 예비.
 * 같은 날 같은 종류는 한 번만(notifications dedupe `brief:<kind>:<date>`). 🟢🟡🔵 는 P3 전까지 0.
 */
import { linksConfig, taxonomyConfig } from "@/lib/config/load";
import { dbInsert, dbSelect, dbSelectAll } from "@/lib/db";
import { getState } from "./poll";
import type { AxesEvidence } from "@/lib/engine/explain";
import { perfLine, type PerfStat } from "@/lib/engine/feedback";
import { buyReasons, consensusOf, EMPTY_IDEA, ideaCard, rankBuy } from "@/lib/engine/idea";
import { assess, candidatePool, policyFor, type Policy, type PolicySet } from "@/lib/engine/pick-policy";
import { MARKET_PHASE_NAME } from "@/lib/engine/regime";
import { issues } from "@/lib/engine/timing";
import { yahooCandidates } from "@/lib/outcomes/ledger";
import { recHistory, recLine, type BriefNote } from "@/lib/outcomes/rec-history";
import { closeOnOrBefore, lastCompleteDate } from "@/lib/outcomes/returns";
import { FAMILY_NAME } from "@/lib/labels";
import { TAG_NAME } from "@/lib/engine/entry-view";
import { esc } from "@/lib/telegram/format";
import { QUEUE_LABEL, type Queue } from "@/lib/engine/queues";
import { env } from "@/lib/env";
import { read as heimdallr } from "@/lib/ingest/heimdallr";
import { read as hermes } from "@/lib/ingest/hermescall";
import { chart, charts, naverDaily } from "@/lib/ingest/market";
import { dashboardButtons, inlineLinks, linkLine, rows, type LinkEntity } from "@/lib/links";
import { sendMessage } from "@/lib/telegram/send";
import { sendAnalysisPrompt } from "./analysis";
import { BRIEF_SPLIT, briefText, type BriefData } from "@/lib/telegram/templates";
import { briefDate, kstDate, kstString } from "@/lib/time";
import { latestHoldings, loadEntities, rules } from "./context";
import { currentRegime } from "./pipeline";

const OTHERS: Queue[] = ["radar", "pullback_wait", "take_profit"];

export type PickLog = { picks: { id: string; rank: number; price: number | null; price_date: string | null }[]; candidates: unknown[]; policy_as_of: string | null; phase?: Record<string, string | null> };

export async function buildBrief(kind: "morning" | "evening", now = new Date()): Promise<BriefData & { pickLog: PickLog }> {
  const R = rules();
  const date = briefDate(kind, now);
  const market = kind === "morning" ? R.market.morning : R.market.evening;
  const sectors = kind === "morning" ? R.market.us_sectors : [];
  const since24 = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const focus: "KR" | "US" = kind === "morning" ? "US" : "KR";

  const [ents, quotes, reg, qItems, alerts] = await Promise.all([
    loadEntities(),
    charts([...market, ...sectors].map((m) => m.sym)),
    currentRegime(),
    dbSelectAll<{ date: string; entity_id: string; queue: Queue; reason: Record<string, unknown> }>("queue_items", `select=date,entity_id,queue,reason&date=eq.${date}`),
    dbSelectAll<{ entity_id: string | null; payload: { name?: string; summary?: string }; sent_at: string | null }>("notifications", `select=entity_id,payload,sent_at&kind=eq.holding_alert&sent_at=gte.${since24}`),
  ]);
  const ctx = { links: linksConfig(), taxonomy: taxonomyConfig(), jarvisUrl: env().JARVIS_URL };
  const l1Name = new Map(taxonomyConfig().l1.map((r) => [r.code, r.name]));
  const all = qItems.ok ? qItems.data : [];
  const mine = all.filter((x) => ents.byId.get(x.entity_id)?.market === focus);
  // 🎯 후보 = 매수 검토 큐 + ⏳ 눌림 대기(상승 초기 조건 만족 시 승격, D66) — 평가하려면 둘 다 근거가 필요
  const buys = all.filter((x) => (x.queue === "buy" || R.pick_policy.promote_from.includes(x.queue)) && ents.byId.has(x.entity_id));
  const ax = buys.length ? await dbSelectAll<{ entity_id: string; evidence: AxesEvidence }>("axes_daily", `select=entity_id,evidence&date=eq.${date}&entity_id=in.(${buys.map((i) => `"${i.entity_id}"`).join(",")})`) : { ok: true as const, data: [] };
  const evBy = new Map((ax.ok ? ax.data : []).map((a) => [a.entity_id, a.evidence]));

  // 🎯 추천 (D53·D54): 후보마다 ⏱️ 지금 매수 매력을 판정 → TOP 자격(기본: ⏸️ 대기 제외 + 사후 검증으로 배운 기준) →
  //    (과거 성과 표본 30건 이상이면 기대 초과수익 →) 매수 매력 점수 → 신호 계열 수 → 주가 반영도(낮을수록) → 산업 실제 성장률 → 가까운 이벤트 순 최대 top_max 개.
  //    추천 시장(아침 미국 · 저녁 국내)을 먼저 채우고, 모자라면 다른 시장으로 채운다 (아침 07:30 은 국내 장 시작 전이라 국내 추천도 유효)
  const [stats, policy, notes, holdings] = await Promise.all([latestPerfStats(), currentPolicy(), briefNotes(), latestHoldings()]);
  const heldBy = new Map(holdings.positions.filter((h) => h.entity_id).map((h) => [h.entity_id as string, { weight: h.weight, allowed_weight: h.allowed_weight }]));
  const today = kstDate(now);
  const scored = candidatePool(buys.map((b) => {
    const ev = evBy.get(b.entity_id) ?? {};
    const e = ents.byId.get(b.entity_id)!;
    const p = (b.reason as { p?: number | null }).p ?? null;
    const a = assess({ ev, p, market: e.market, l1: e.primary_l1, riskOff: reg.risk_off, today, phase: reg.phase[e.market], holding: heldBy.get(b.entity_id) }, R, policy, stats);
    return { ...b, e, ev, a, families: ev.families?.length ?? 0, p, industryGrowth: ev.idea?.industry?.realized_median ?? null, nextEvent: ev.next_event ?? null, perf: a.prior.score, timing: a.timing.score };
  }), R.pick_policy.promote_from);
  const promoted = new Set(scored.filter((b) => b.promoted).map((b) => b.entity_id));
  const bucketName = (d: string, b: string) => (d === "l1" ? l1Name.get(b) ?? b : d === "sources" ? FAMILY_NAME[b] ?? b : d === "families" ? `${b}개` : d === "market" ? (b === "KR" ? "국내" : "미국") : b);
  const MAX = R.pick_policy.top_max;
  const ok = scored.filter((b) => b.a.admit.ok);
  const first = rankBuy(ok.filter((b) => b.e.market === focus), MAX);
  const ranked = [...first, ...rankBuy(ok.filter((b) => b.e.market !== focus), MAX - first.length)];
  const hist = recHistory(notes, (c) => idOfCode(c, ents));
  const prices = new Map(await Promise.all(ranked.map(async (b) => [b.entity_id, await priceRef(b.entity_id, now, hist.get(b.entity_id)?.first_at ?? null)] as const)));
  const ideas = ranked.map((b, i) => {
    const e = b.e;
    const idea = b.ev.idea ?? EMPTY_IDEA;
    const reasons = buyReasons({ idea, consensus: consensusOf(b.ev), grade: b.ev.F?.grade ?? null, score: b.ev.F?.score ?? null });
    const industry = idea.industry?.name ?? (e.primary_l1 ? l1Name.get(e.primary_l1) ?? "" : "");
    const h = hist.get(b.entity_id), px = prices.get(b.entity_id);
    const history = (b.promoted ? "⏳ 눌림 대기 → 🚀 상승 초기 승격 · " : "") + recLine({ nth: (h?.count ?? 0) + 1, first_at: h?.first_at ?? null, first_price: h?.first_price ?? px?.first ?? null, cur_price: px?.price ?? null, cur_date: px?.date ?? null, currency: e.market === "KR" ? "KRW" : "USD" });
    return ideaCard(i + 1, { name: e.name, symbol: e.symbol, market: e.market, industry }, idea, reasons, b.ev.tech, linkLine(e as unknown as LinkEntity, ctx), perfLine(b.a.prior, R.feedback, bucketName), { timing: b.a.timing, history });
  });
  const picked = new Map(ranked.map((b, i) => [b.entity_id, i + 1]));
  const waiting = scored.filter((b) => !b.a.admit.ok).sort((x, y) => y.a.timing.score - x.a.timing.score)
    .map((b) => ({ name: b.e.name, why: [b.a.admit.why[0], issues(b.a.timing)].filter(Boolean).join(" — ") }));
  const pickLog = {
    picks: ranked.map((b) => ({ id: b.entity_id, rank: picked.get(b.entity_id) as number, price: prices.get(b.entity_id)?.price ?? null, price_date: prices.get(b.entity_id)?.date ?? null })),
    candidates: scored.map((b) => ({ id: b.entity_id, picked: picked.has(b.entity_id), rank: picked.get(b.entity_id) ?? null, features: b.a.features, from: b.queue })),
    policy_as_of: policy?.overall?.as_of ?? null,
    phase: reg.phase,
  };
  const others = OTHERS.map((q) => ({ icon: QUEUE_LABEL[q].split(" ")[0], label: QUEUE_LABEL[q].replace(/^\S+\s/, ""), names: mine.filter((x) => x.queue === q && !promoted.has(x.entity_id)).map((x) => ents.byId.get(x.entity_id)!.name) }));

  // 실적: 아침 = 밤사이 HermesCall 미국 발표, 저녁 = 오늘 Heimdallr ★○
  const earnings: BriefData["earnings"] = { title: kind === "morning" ? "밤사이 미국 실적 (HermesCall)" : "오늘 국내 실적 ★○ (Heimdallr)", lines: [] };
  if (kind === "morning") {
    const ev = await hermes<{ symbol: string; pr_detected_at: string | null }>("earnings_events", { select: "symbol,pr_detected_at", filters: { pr_detected_at: `gte.${since24}` } });
    for (const x of ev.ok ? ev.data : []) earnings.lines.push(`${ents.byId.get(`US:${x.symbol}`)?.name ?? x.symbol} (${x.symbol}) 발표`);
  } else {
    const nt = await heimdallr<{ code: string; kind: string; payload: { grade?: string; score?: number } | null; sent_at: string }>("notifications", { select: "code,kind,payload,sent_at", filters: { sent_at: `gte.${since24}`, kind: "in.(flash,upgrade)" } });
    for (const x of nt.ok ? nt.data : []) {
      const g = x.payload?.grade;
      if (g === "★" || g === "○") earnings.lines.push(`${g} ${ents.byId.get(`KR:${x.code}`)?.name ?? x.code} (${x.code}) 점수 ${x.payload?.score == null ? "-" : Math.round(x.payload.score * 10) / 10}`);
    }
  }

  // 일정: 아침 = 오늘, 저녁 = 내일 (보유·큐 종목 + 산업·매크로 이벤트)
  const day = kind === "morning" ? date : kstDate(new Date(new Date(`${date}T12:00:00+09:00`).getTime() + 86400_000));
  const watched = new Set([...(qItems.ok ? qItems.data.map((x) => x.entity_id) : []), ...[...ents.byId.values()].filter((e) => e.snowball_asset_id).map((e) => e.id)]);
  const cal = await dbSelect<{ entity_id: string | null; l1: string | null; scope: string; title: string; source: string }>("catalyst_events", `select=entity_id,l1,scope,title,source&date=eq.${day}`);
  const schedule = { title: kind === "morning" ? "오늘 일정" : "내일 일정", lines: [] as string[] };
  for (const c of cal.ok ? cal.data : []) {
    if (c.scope === "company" && !(c.entity_id && watched.has(c.entity_id))) continue;
    const who = c.entity_id ? ents.byId.get(c.entity_id)?.name ?? c.entity_id : c.l1 ? taxonomyConfig().l1.find((r) => r.code === c.l1)?.name ?? c.l1 : "매크로";
    schedule.lines.push(`${who}: ${c.title} (${c.source})`);
  }

  // 🟢 🟡 🔵 (추천 시장, PRD 부록 B.2) — entry_eval 최신 평가일 · 최근 3일 🔵
  const entry = await entryLines(focus, now, ents, ctx);
  const al = alerts.ok ? alerts.data : [];
  return {
    kind, date,
    market: market.map((m) => ({ label: m.label, last: quotes[m.sym]?.last ?? null, change_pct: quotes[m.sym]?.change_pct ?? null, level: m.level })),
    sectors: sectors.map((s) => ({ label: s.label, change_pct: quotes[s.sym]?.change_pct ?? null })),
    regime: { risk_off: reg.risk_off, reasons: reg.reasons },
    counts: { ...entry.counts, alert: al.length }, entries: entry.lines,
    alertsPaused: (await getState<{ paused?: boolean }>("holding_alert_pause"))?.paused === true,
    earnings, focus, ideas, buyTotal: buys.length, others, waiting, policy: policyNote(policyFor(policy, reg.phase[focus]), reg.phase[focus]), pickLog,
    holding: al.slice(0, 8).map((a) => `⚠️ ${a.payload?.name ?? a.entity_id ?? "-"}: ${a.payload?.summary ?? ""}`),
    schedule: { ...schedule, lines: schedule.lines.slice(0, 10) },
    asOf: kstString(now),
  };
}

const COND_SHORT: Record<string, string> = { M1: "실적·주가", M2: "MACD", M3: "산업 성장", M4: "이벤트", M5: "수급" };

async function entryLines(market: "KR" | "US", now: Date, ents: Awaited<ReturnType<typeof loadEntities>>, ctx: { links: ReturnType<typeof linksConfig>; taxonomy: ReturnType<typeof taxonomyConfig>; jarvisUrl?: string | null }) {
  const since = kstDate(new Date(now.getTime() - 4 * 86400_000));
  const last = await dbSelect<{ date: string }>("entry_eval", `select=date&market=eq.${market}&date=gte.${since}&order=date.desc&limit=1`);
  const d = last.ok ? last.data[0]?.date : undefined;
  const ev = d ? await dbSelectAll<{ entity_id: string; level: string; tag: string | null; evidence: { p?: number | null; missing?: string[] } }>("entry_eval", `select=entity_id,level,tag,evidence&market=eq.${market}&date=eq.${d}&level=in.(green,yellow)`) : { ok: true as const, data: [] };
  const bw = await dbSelectAll<{ entity_id: string; source: string; d0: string }>("breakout_watch", `select=entity_id,source,d0&d0=gte.${kstDate(new Date(now.getTime() - 3 * 86400_000))}&order=d0.desc`);
  const rowsE = (ev.ok ? ev.data : []).filter((x) => ents.byId.has(x.entity_id));
  const blues = (bw.ok ? bw.data : []).filter((b) => b.entity_id.startsWith(`${market}:`) && ents.byId.has(b.entity_id));
  const link = (id: string) => inlineLinks(ents.byId.get(id) as unknown as LinkEntity, ctx);
  const nm = (id: string) => `<b>${esc(ents.byId.get(id)!.name)}</b>`;
  const lines = [
    ...rowsE.filter((x) => x.level === "green").map((x) => `🟢 ${nm(x.entity_id)} — ${x.tag ? esc(TAG_NAME[x.tag as keyof typeof TAG_NAME]) : "진입"} · 주가 반영도 ${x.evidence.p == null ? "-" : Math.round(x.evidence.p)}  ${link(x.entity_id)}`),
    ...rowsE.filter((x) => x.level === "yellow").slice(0, 5).map((x) => `🟡 ${nm(x.entity_id)} — 빠진 조건: ${esc((x.evidence.missing ?? []).map((m) => COND_SHORT[m] ?? m).join("·") || "게이트")}  ${link(x.entity_id)}`),
    ...blues.slice(0, 3).map((b) => `🔵 ${nm(b.entity_id)} — 실적 돌파(${b.source === "K1" ? "국내" : "미국"}, ${b.d0.slice(5).replace("-", "/")}) · 진입 신호 아님, 60거래일 관찰  ${link(b.entity_id)}`),
  ];
  return { counts: { green: rowsE.filter((x) => x.level === "green").length, yellow: rowsE.filter((x) => x.level === "yellow").length, blue: blues.length }, lines };
}

/** 최신 성과 스냅샷(🎯 매수 검토 · 브리핑 후보 전체, 기준 기간) — outcomes_update 가 매일 20:00 에 쓴다. 없으면 빈 배열(규칙 순위) */
async function latestPerfStats(): Promise<PerfStat[]> {
  const h = rules().feedback.primary_horizon;
  const last = await dbSelect<{ as_of: string }>("perf_stats", "select=as_of&order=as_of.desc&limit=1");
  const asOf = last.ok ? last.data[0]?.as_of : undefined;
  if (!asOf) return [];
  const sc = rules().pick_policy.scope;
  const r = await dbSelectAll<PerfStat>("perf_stats", `select=scope,dimension,bucket,horizon_days,n,median_excess,hit_rate,median_ret&as_of=eq.${asOf}&or=(scope.eq.buy,scope.eq.${sc},scope.like.${encodeURIComponent(`${sc}@*`)})&horizon_days=eq.${h}`);
  return r.ok ? r.data : [];
}

/** 사후 검증으로 배운 추천 기준(전체 + 시장 국면별, D69) — outcomes_update 가 bot_state.pick_policy 에 매일 쓴다 */
export async function currentPolicy(): Promise<PolicySet> {
  const s = await getState<{ policy?: Policy; by_phase?: PolicySet["by_phase"] }>("pick_policy");
  return { overall: s?.policy ?? null, by_phase: s?.by_phase ?? {} };
}

function policyNote(p: Policy | null, phase: Parameters<typeof policyFor>[1]): string | null {
  if (!p?.overall || !p.overall.n) return null;
  const o = p.overall;
  const where = p.phase ? `${MARKET_PHASE_NAME[p.phase]} 기준` : phase ? `지금 ${MARKET_PHASE_NAME[phase]} — 국면 표본 부족, 전체 기준` : "전체 기준";
  const head = `사후 검증 ${o.n}건(${where}) · ${p.horizon}거래일 뒤 승률 ${o.hit_rate === null ? "-" : `${Math.round(o.hit_rate * 100)}%`}`;
  if (!p.exclude.length) return `${head} — 아직 추가로 뺀 기준 없음`;
  return `${head} — ${p.applied ? "제외 적용 중" : "제외 제안(미적용)"}: ${p.exclude.slice(0, 3).map((x) => x.title).join(" · ")}`;
}

/** 지난 브리핑(발송 성공) — 추천 횟수·첫 추천가 */
async function briefNotes(): Promise<BriefNote[]> {
  const r = await dbSelectAll<BriefNote>("notifications", "select=sent_at,payload&kind=in.(brief_morning,brief_evening)&sent_at=not.is.null&order=sent_at.asc");
  return r.ok ? r.data : [];
}

/** 옛 브리핑 payload.ideas(종목 코드) → 종목 ID */
const idOfCode = (code: string, ents: Awaited<ReturnType<typeof loadEntities>>) => (ents.byId.has(`KR:${code}`) ? `KR:${code}` : ents.byId.has(`US:${code}`) ? `US:${code}` : null);

/** 추천 기준가 = 지금 확정된 마지막 종가 (국내 네이버 공식 종가 · 미국 야후 — 성과 원장과 같은 출처). 첫 추천가가 없던 옛 브리핑은 그날 종가로 */
async function priceRef(id: string, now: Date, firstAt: string | null): Promise<{ price: number | null; date: string | null; first: number | null }> {
  const market = id.startsWith("US:") ? "US" : "KR";
  const bars = market === "KR" ? await naverDaily(id.slice(3), 300) : await chart(yahooCandidates(id, null)[0], "1y").then((r) => (r.ok ? { ok: true as const, data: r.data.closes } : r));
  if (!bars.ok) return { price: null, date: null, first: null };
  const cur = closeOnOrBefore(bars.data, lastCompleteDate(now, market));
  const first = firstAt ? closeOnOrBefore(bars.data, lastCompleteDate(new Date(firstAt), market)) : null;
  return { price: cur?.close ?? null, date: cur?.date ?? null, first: first?.close ?? null };
}

export async function sendBrief(kind: "morning" | "evening", now = new Date(), opts: { force?: boolean } = {}): Promise<Record<string, unknown>> {
  const date = briefDate(kind, now);
  const key = `brief:${kind}:${date}`;
  const done = await dbSelect<{ sent_at: string | null }>("notifications", `select=sent_at&dedupe_key=eq.${encodeURIComponent(key)}`);
  if (!opts.force && done.ok && done.data[0]?.sent_at) return { skipped: "이미 발송", key };
  const data = await buildBrief(kind, now);
  const chat = env().TELEGRAM_CHAT_ID;
  const buttons = rows(dashboardButtons(linksConfig().dashboards, env().JARVIS_URL), 3);
  const r = chat ? await sendMessage(chat, briefText(data), buttons, BRIEF_SPLIT) : { ok: false as const, reason: "TELEGRAM_CHAT_ID 미설정" };
  await dbInsert("notifications", [{ kind: `brief_${kind}`, dedupe_key: key, payload: { ideas: data.ideas.map((c) => c.code), ...data.pickLog, buy_total: data.buyTotal, alerts: data.counts.alert, error: r.ok ? undefined : r.reason, scheduled_kst: kind === "morning" ? "07:30" : "19:20" },
    sent_at: r.ok ? new Date().toISOString() : null, telegram_msg_id: r.ok ? r.data[0] : null }], { upsertOn: "dedupe_key" });
  if (!r.ok) throw new Error(`브리핑 발송 실패: ${r.reason}`);
  // 🔎 추천 종목 심층 분석 버튼 (D59) — 실패해도 브리핑은 성공으로 둔다
  if (chat) await sendAnalysisPrompt(chat, data.ideas.map((c) => ({ entityId: `${c.flag === "🇺🇸" ? "US" : "KR"}:${c.code}`, name: c.name, industry: c.industry || null })));
  return { sent: key, ideas: data.ideas.map((c) => c.code), alerts: data.counts.alert, sent_at_kst: kstString(new Date()) };
}
