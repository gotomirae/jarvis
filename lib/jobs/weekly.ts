/**
 * weekly_memo — 🏛️ 주간 투자위원회 (PRD §10, P4). 토 09:30 KST 발행 목표, FlyWheel 주간 리포트가 없으면 10:30 까지 재확인 후 "미도착"으로 발행.
 *  ① 결정론적 수집 → 사실표(F###) — 모든 숫자·날짜는 사실표 표식([[F012]])으로 표·목록에 들어간다
 *  ② LLM(lib/llm/router.ts) 은 서술·시나리오·확률만, 숫자는 표식으로만 → grounding gate → 실패 시 1회 재생성 → 그래도 실패면 표·목록만
 *  ③ 저장(weekly_memos) · 노션(2_3 > JARVIS 주간 투자위원회) · 텔레그램 요약 · /weekly
 * 같은 주가 이미 발행됐으면 즉시 끝난다(멱등, --force 로 재발행).
 */
import { linksConfig, taxonomyConfig } from "@/lib/config/load";
import { dbInsert, dbSelect, dbSelectAll, dbUpdate } from "@/lib/db";
import { env } from "@/lib/env";
import { read as heimdallr } from "@/lib/ingest/heimdallr";
import { read as hermes } from "@/lib/ingest/hermescall";
import { chart, naverDaily, naverInvestorTrend, type Bar } from "@/lib/ingest/market";
import { exportPerformance } from "@/lib/ingest/snowball";
import { createNotionPage } from "@/lib/ingest/notion";
import { dashboardButtons, rows as btnRows } from "@/lib/links";
import { llmJson } from "@/lib/llm/router";
import { briefOf, composeMemo, mdToNotion, type MemoData, type NarrativeText, type Table } from "@/lib/memo/compose";
import { factBook, factLines, type FactBook } from "@/lib/memo/fact-table";
import { checkAll, checkProbabilities, render } from "@/lib/memo/grounding";
import { NarrativeSchema, SYSTEM, userPrompt, type Narrative } from "@/lib/memo/prompt";
import { sendMessage } from "@/lib/telegram/send";
import { weeklyText } from "@/lib/telegram/templates";
import { kstDate, kstString, memoWeek } from "@/lib/time";
import { latestHoldings, loadEntities, rules } from "./context";
import { getState } from "./poll";

const DAY = 86400_000;
const addDays = (ymd: string, n: number) => new Date(new Date(`${ymd}T00:00:00Z`).getTime() + n * DAY).toISOString().slice(0, 10);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** 주간 수익률: 기간 마지막 종가 / 기간 시작 전 마지막 종가 */
function weekRet(bars: Bar[], start: string, end: string): number | null {
  const e = [...bars].reverse().find((b) => b.date <= end), s = [...bars].reverse().find((b) => b.date < start);
  return e && s ? (e.close / s.close - 1) * 100 : null;
}
const lastOn = (bars: Bar[], end: string) => [...bars].reverse().find((b) => b.date <= end) ?? null;

async function pool<T, R>(xs: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => { while (i < xs.length) { const k = i++; out[k] = await f(xs[k]); } }));
  return out;
}

/** 숫자가 섞인 자유 텍스트(이벤트 제목 등)는 통째로 사실표 텍스트 항목으로 — LLM 은 표식으로만 인용 */
function txt(fb: FactBook, group: string, label: string, s: string): string {
  return /[0-9]/.test(s) ? `[[${fb.add(group, label, s, "text")}]]` : s;
}

export async function collectMemo(now = new Date()): Promise<{ data: MemoData; fb: FactBook; flywheelFound: boolean; krBaskets: { l1: string; w: number | null; m: number | null }[]; heatDate: string | null }> {
  const R = rules(), W = R.weekly;
  const tx = taxonomyConfig();
  const l1Name = (c: string | null | undefined) => (c ? tx.l1.find((r) => r.code === c)?.name ?? c : "기타");
  const { week, start, end } = memoWeek(now);
  const fb = factBook();
  const F = (group: string, label: string, v: number | string | null, format: Parameters<FactBook["add"]>[3], digits = 1) => `[[${fb.add(group, label, v, format, digits)}]]`;
  const ents = await loadEntities();
  const nextStart = addDays(end, 3), nextEnd = addDays(end, 9);

  // Ⅰ-1 시장
  const market: Table = { head: ["지표", "주간", "수준"], rows: [] };
  for (const m of W.market.returns) {
    const b = m.source === "naver" ? await naverDaily(m.sym, 30) : await chart(m.sym, "1mo").then((r) => (r.ok ? { ok: true as const, data: r.data.closes } : r));
    const bars = b.ok ? b.data : [];
    market.rows.push([m.label, F("시장", `${m.label} 주간 수익률`, weekRet(bars, start, end), "pct_signed"), F("시장", `${m.label} 주말 종가`, lastOn(bars, end)?.close ?? null, "num", 2)]);
  }
  for (const m of W.market.levels) {
    const q = await chart(m.sym, "1mo");
    const bars = q.ok ? q.data.closes : [];
    market.rows.push([m.label, F("시장", `${m.label} 주간 변화율`, weekRet(bars, start, end), "pct_signed"), F("시장", `${m.label} 수준`, lastOn(bars, end)?.close ?? null, "num", 2)]);
  }

  // Ⅰ-2 수급 (국내, 억원) — 기간 거래일 합계
  const kospi = await naverDaily("KOSPI", 15);
  const days = (kospi.ok ? kospi.data : []).filter((b) => b.date >= start && b.date <= end).map((b) => b.date);
  let flows: Table | null = null;
  if (days.length) {
    flows = { head: ["지수", "개인", "외국인", "기관"], rows: [] };
    for (const idx of ["KOSPI", "KOSDAQ"] as const) {
      const r = await Promise.all(days.map((d) => naverInvestorTrend(idx, d)));
      const okd = r.filter((x) => x.ok).map((x) => (x as { data: { personal: number; foreign: number; institutional: number } }).data);
      const sum = (k: "personal" | "foreign" | "institutional") => (okd.length === days.length ? okd.reduce((a, x) => a + x[k], 0) : null);
      flows.rows.push([idx, F("수급", `${idx} 개인 주간 순매수`, sum("personal"), "eok"), F("수급", `${idx} 외국인 주간 순매수`, sum("foreign"), "eok"), F("수급", `${idx} 기관 주간 순매수`, sum("institutional"), "eok")]);
    }
  }

  // Ⅰ-3 산업 바스켓 — 국내: Heimdallr 시세 스냅샷(5일·1개월 수익률, 시총 1,000억+) · 미국: 종목 마스터 미국 종목 야후 일봉
  const snapLast = await heimdallr<{ snap_date: string }>("price_snapshots", { select: "snap_date", filters: { snap_date: `lte.${end}` }, order: "snap_date.desc", limit: 1 });
  const snapDate = snapLast.ok ? snapLast.data[0]?.snap_date : undefined;
  const snaps = snapDate ? await heimdallr<{ code: string; ret_5d: number | null; ret_1m: number | null; market_cap_krw: number | null }>("price_snapshots", { select: "code,ret_5d,ret_1m,market_cap_krw", filters: { snap_date: `eq.${snapDate}` } }) : null;
  const kr5 = new Map<string, number>();
  const krBasket = new Map<string, { w: number[]; m: number[] }>();
  for (const s of snaps?.ok ? snaps.data : []) {
    const id = `KR:${s.code}`, e = ents.byId.get(id);
    if (s.ret_5d !== null) kr5.set(id, Number(s.ret_5d));
    if (!e?.primary_l1 || /^[A-Z]+$/.test(e.primary_l1) || (s.market_cap_krw ?? 0) < W.basket_min_market_cap_krw || s.ret_5d === null) continue;
    const b = krBasket.get(e.primary_l1) ?? { w: [], m: [] };
    b.w.push(Number(s.ret_5d)); if (s.ret_1m !== null) b.m.push(Number(s.ret_1m));
    krBasket.set(e.primary_l1, b);
  }
  const usEnts = [...ents.byId.values()].filter((e) => e.market === "US");
  const usBars = new Map<string, Bar[]>();
  await pool(usEnts, 6, async (e) => { const q = await chart(e.symbol.replace(/\./g, "-"), "3mo"); if (q.ok) usBars.set(e.id, q.data.closes); });
  const us5 = new Map<string, number>();
  const usBasket = new Map<string, { w: number[]; m: number[] }>();
  for (const e of usEnts) {
    const bars = usBars.get(e.id); if (!bars) continue;
    const w = weekRet(bars, start, end); if (w === null) continue;
    us5.set(e.id, w);
    const last = lastOn(bars, end), m0 = [...bars].reverse().find((b) => b.date <= addDays(end, -30));
    if (!e.primary_l1 || /^[A-Z]+$/.test(e.primary_l1)) continue;
    const b = usBasket.get(e.primary_l1) ?? { w: [], m: [] };
    b.w.push(w); if (last && m0) b.m.push((last.close / m0.close - 1) * 100);
    usBasket.set(e.primary_l1, b);
  }
  // 산업별 근거: 산업 흐름 강도(FlyWheel)·실적 촉매(HermesCall) — industry_heat, 이번 주 ★○(Heimdallr)
  const heatLast = await dbSelect<{ date: string }>("industry_heat", `select=date&date=lte.${end}&order=date.desc&limit=1`);
  const heat = heatLast.ok && heatLast.data[0] ? await dbSelectAll<{ l1: string; n_score: number | null; c_score: number | null; m3_pass: boolean | null; m3_median_rev_yoy_q0: number | null; m3_basis: { bases?: Record<string, boolean> } | null }>("industry_heat", `select=l1,n_score,c_score,m3_pass,m3_median_rev_yoy_q0,m3_basis&date=eq.${heatLast.data[0].date}`) : null;
  const heatBy = new Map((heat?.ok ? heat.data : []).map((h) => [h.l1, h]));
  const stars = await heimdallr<{ code: string; payload: { grade?: string } | null; sent_at: string }>("notifications", { select: "code,payload,sent_at", filters: { kind: "in.(flash,upgrade)", sent_at: `gte.${start}T00:00:00+09:00` } });
  const starList = (stars.ok ? stars.data : []).filter((s) => s.payload?.grade === "★" || s.payload?.grade === "○" ).filter((s) => kstDate(new Date(s.sent_at)) <= end);
  const starsByL1 = new Map<string, number>();
  for (const s of starList) { const l = ents.byId.get(`KR:${s.code}`)?.primary_l1; if (l) starsByL1.set(l, (starsByL1.get(l) ?? 0) + 1); }
  const basketTable = (bk: Map<string, { w: number[]; m: number[] }>, mk: string): Table => {
    const rowsAll = [...bk.entries()].filter(([, b]) => b.w.length >= W.basket_min_members).map(([l1, b]) => ({ l1, w: mean(b.w) as number, m: mean(b.m), n: b.w.length })).sort((a, b) => b.w - a.w);
    const pick = rowsAll.length > 6 ? [...rowsAll.slice(0, 3), ...rowsAll.slice(-3)] : rowsAll;
    return { head: ["구분", "산업", "주간", "1개월", "종목 수", "산업 흐름 강도", "이번 주 ★○"], rows: pick.map((r, i) => [
      rowsAll.length > 6 ? (i < 3 ? "상위" : "하위") : "-", l1Name(r.l1), F("산업", `${mk} ${l1Name(r.l1)} 바스켓 주간`, r.w, "pct_signed"), F("산업", `${mk} ${l1Name(r.l1)} 바스켓 1개월`, r.m, "pct_signed"),
      F("산업", `${mk} ${l1Name(r.l1)} 바스켓 종목 수`, r.n, "int"), F("산업", `${l1Name(r.l1)} 산업 흐름 강도(0~10)`, heatBy.get(r.l1)?.n_score ?? null, "num"), F("산업", `${l1Name(r.l1)} 이번 주 ★○ 수`, starsByL1.get(r.l1) ?? 0, "int")]) };
  };
  const industries = { kr: basketTable(krBasket, "국내"), us: basketTable(usBasket, "미국") };

  // Ⅰ-4 실적 · Ⅰ-5 매크로 · Ⅰ-6 멘토
  const ee = await hermes<{ symbol: string; pr_detected_at: string | null }>("earnings_events", { select: "symbol,pr_detected_at", filters: { pr_detected_at: `gte.${start}T00:00:00+09:00` } });
  const sigs = await dbSelectAll<{ kind: string; entity_id: string | null; l1_codes: string[]; strength: number; evidence: Record<string, unknown>; observed_at: string }>("signals", `select=kind,entity_id,l1_codes,strength,evidence,observed_at&observed_at=gte.${start}T00:00:00%2B09:00&kind=in.(earnings_quality_us,mentor_consensus)`);
  const sigList = (sigs.ok ? sigs.data : []).filter((s) => kstDate(new Date(s.observed_at)) <= addDays(end, 1));
  const earnings: string[] = [];
  for (const e of (ee.ok ? ee.data : []).filter((x) => x.pr_detected_at && kstDate(new Date(x.pr_detected_at)) <= addDays(end, 1))) {
    const flags = sigList.find((s) => s.kind === "earnings_quality_us" && s.entity_id === `US:${e.symbol}`)?.evidence.flags as string[] | undefined;
    earnings.push(`미국 ${ents.byId.get(`US:${e.symbol}`)?.name ?? e.symbol} (${e.symbol}) 실적 발표${flags?.length ? ` — 충족 필터 ${flags.join("·")}` : ""}`);
  }
  for (const s of starList) earnings.push(`국내 ${s.payload?.grade} ${ents.byId.get(`KR:${s.code}`)?.name ?? s.code} 잠정실적`);
  const bo = await dbSelectAll<{ entity_id: string; source: string; d0: string }>("breakout_watch", `select=entity_id,source,d0&d0=gte.${start}&d0=lte.${end}`);
  for (const b of bo.ok ? bo.data : []) earnings.push(`🔵 실적 돌파 ${ents.byId.get(b.entity_id)?.name ?? b.entity_id}`);
  const cats = await dbSelectAll<{ scope: string; entity_id: string | null; l1: string | null; title: string; date: string | null; source: string }>("catalyst_events", `select=scope,entity_id,l1,title,date,source&date=gte.${start}&date=lte.${nextEnd}`);
  const catList = cats.ok ? cats.data : [];
  const macro = catList.filter((c) => c.scope === "macro" && c.date && c.date <= end).map((c) => `${txt(fb, "매크로", "이벤트 날짜", c.date!.slice(5))} ${txt(fb, "매크로", "이벤트", c.title)} (${c.source})`);
  // 멘토 합의: 같은 대상(산업·종목)은 최대 강세 멘토 수로 묶고 상위 10개
  const sageBy = new Map<string, number>();
  for (const s of sigList.filter((x) => x.kind === "mentor_consensus")) {
    const who = s.l1_codes.length && !s.entity_id ? `${s.l1_codes.map(l1Name).join("·")}(산업)` : s.entity_id ? ents.byId.get(s.entity_id)?.name ?? s.entity_id : "-";
    const bull = (s.evidence.bullish as string[] | undefined)?.length ?? 0;
    sageBy.set(who, Math.max(sageBy.get(who) ?? 0, bull));
  }
  const sage = [...sageBy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([who, n]) => `${txt(fb, "멘토", "대상", who)} — 강세 멘토 ${F("멘토", `${who} 강세 멘토 수`, n, "int")}명`);

  // Ⅰ-7 포트폴리오 (비율만 — 금액 미저장, D26)
  const holdings = await latestHoldings();
  const perf = await exportPerformance(addDays(start, -10), end);
  const portfolio: Table = { head: ["구분", "주간 수익률"], rows: [] };
  if (perf.ok) {
    const nw = (perf.data.net_worth as { date: string; net_worth: number }[]).map((x) => ({ date: x.date, close: Number(x.net_worth) }));
    portfolio.rows.push(["내 포트폴리오(순자산)", F("포트폴리오", "내 포트폴리오 주간 수익률", weekRet(nw, start, end), "pct_signed")]);
    const byKey = new Map<string, Bar[]>();
    for (const b of perf.data.benchmarks as { key: string; date: string; close: number }[]) byKey.set(b.key, [...(byKey.get(b.key) ?? []), { date: b.date, close: Number(b.close) }]);
    const BENCH: Record<string, string> = { SPX: "S&P 500", KOSPI: "KOSPI", KOSDAQ: "KOSDAQ", NDX: "NASDAQ 100" };
    for (const [k, bars] of byKey) portfolio.rows.push([`${BENCH[k] ?? k} (벤치마크)`, F("포트폴리오", `${BENCH[k] ?? k} 주간 수익률(벤치마크)`, weekRet(bars, start, end), "pct_signed")]);
  }
  const contribRows = holdings.positions.filter((p) => p.entity_id && p.asset_class === "stock" && p.weight !== null).map((p) => {
    const r = kr5.get(p.entity_id!) ?? us5.get(p.entity_id!) ?? null;
    return { name: p.name, w: p.weight as number, r, c: r === null ? null : (p.weight as number) * r };
  }).filter((x) => x.c !== null).sort((a, b) => (b.c as number) - (a.c as number));
  const cpick = contribRows.length > 6 ? [...contribRows.slice(0, 3), ...contribRows.slice(-3)] : contribRows;
  const contrib: Table = { head: ["종목", "비중", "주간 수익률", "기여(비중×수익률)"], rows: cpick.map((x) => [txt(fb, "종목", "종목명", x.name), F("포트폴리오", `${x.name} 비중`, x.w * 100, "pct"), F("포트폴리오", `${x.name} 주간 수익률`, x.r, "pct_signed"), F("포트폴리오", `${x.name} 기여`, x.c, "pctp", 2)]) };
  const reg = await getState<{ risk_off: boolean; reasons: string[]; vix: number | null }>("regime");
  const regime = txt(fb, "국면", "시장 국면", reg ? (reg.risk_off ? `위험 회피 — ${reg.reasons.join(", ")}` : "정상") : "자료 없음");
  const nmx = (s: string) => txt(fb, "종목", "종목명", s);

  // Ⅰ-8 신호 복기
  const greens = await dbSelectAll<{ entity_id: string; signal_date: string; entry_price: number | null; market: "KR" | "US"; tag: string }>("signal_ledger", `select=entity_id,signal_date,entry_price,market,tag&event_type=eq.green&signal_date=gte.${addDays(end, -90)}`);
  const review: string[] = [];
  for (const g of greens.ok ? greens.data : []) {
    const e = ents.byId.get(g.entity_id);
    const bars = g.market === "KR" ? await naverDaily(g.entity_id.slice(3), 5).then((r) => (r.ok ? r.data : [])) : usBars.get(g.entity_id) ?? [];
    const last = lastOn(bars, end);
    const ret = last && g.entry_price ? (last.close / Number(g.entry_price) - 1) * 100 : null;
    review.push(`🟢 ${nmx(e?.name ?? g.entity_id)} (${F("신호 복기", `${e?.name ?? g.entity_id} 신호일`, g.signal_date.slice(5), "text")}) — 진입가 대비 ${F("신호 복기", `${e?.name ?? g.entity_id} 진입 후 수익률`, ret, "pct_signed")}`);
  }
  const inv = await dbSelectAll<{ entity_id: string }>("notifications", `select=entity_id&kind=eq.holding_alert&dedupe_key=like.invalidation*&created_at=gte.${start}T00:00:00%2B09:00`);
  review.push(`이번 주 무효화선 이탈 ${F("신호 복기", "이번 주 무효화선 이탈 수", inv.ok ? inv.data.length : null, "int")}건`);
  const evs = await dbSelectAll<{ entity_id: string; date: string; m1: boolean; m2: boolean; m3: boolean; m4: boolean; m5: boolean }>("entry_eval", `select=entity_id,date,m1,m2,m3,m4,m5&date=gte.${start}&date=lte.${end}&m1=eq.true`);
  const ev = evs.ok ? evs.data : [];
  const failDist: Table = { head: ["조건", "탈락(종목·일)"], rows: ev.length ? [
    ["② MACD 교차 직전", F("탈락 분포", "② 탈락", ev.filter((x) => !x.m2).length, "int")], ["③ 산업 고성장", F("탈락 분포", "③ 탈락", ev.filter((x) => !x.m3).length, "int")],
    ["④ 6개월 내 이벤트", F("탈락 분포", "④ 탈락", ev.filter((x) => !x.m4).length, "int")], ["⑤ 매수 수급", F("탈락 분포", "⑤ 탈락", ev.filter((x) => !x.m5).length, "int")],
    ["다섯 조건 모두 통과", F("탈락 분포", "모두 통과", ev.filter((x) => x.m2 && x.m3 && x.m4 && x.m5).length, "int")],
  ] : [] };

  // Ⅱ-1 스탠스 · Ⅱ-2 캘린더
  const band = reg?.risk_off ? W.cash_band.risk_off : W.cash_band.normal;
  const stance = `시장 국면 ${regime} · 권장 현금 비중 밴드 ${F("스탠스", "권장 현금 비중 밴드", band, "text")} (규칙 기반 참고값)`;
  const heldIds = new Set(holdings.positions.map((p) => p.entity_id).filter(Boolean) as string[]);
  const nextEe = await hermes<{ symbol: string; expected_at: string }>("earnings_events", { select: "symbol,expected_at", filters: { expected_at: `gte.${nextStart}T00:00:00+09:00` } });
  const calendar: string[] = [];
  const cal = [
    ...(nextEe.ok ? nextEe.data : []).filter((x) => kstDate(new Date(x.expected_at)) <= nextEnd).map((x) => ({ id: `US:${x.symbol}`, date: kstDate(new Date(x.expected_at)), title: `${ents.byId.get(`US:${x.symbol}`)?.name ?? x.symbol} 실적 발표`, source: "HermesCall" })),
    ...catList.filter((c) => c.date && c.date >= nextStart && c.date <= nextEnd && (c.scope === "macro" || (c.entity_id && heldIds.has(c.entity_id)))).map((c) => ({ id: c.entity_id ?? "", date: c.date!, title: c.scope === "macro" ? c.title : `${ents.byId.get(c.entity_id!)?.name ?? c.entity_id} ${c.title}`, source: c.source })),
  ].sort((a, b) => Number(heldIds.has(b.id)) - Number(heldIds.has(a.id)) || a.date.localeCompare(b.date)).slice(0, 15);
  for (const c of cal) calendar.push(`${heldIds.has(c.id) ? "💼 " : ""}${txt(fb, "캘린더", "날짜", c.date.slice(5))} ${txt(fb, "캘린더", "일정", c.title)} (${c.source})`);

  // Ⅱ-3 산업 근거 · 성장 근거 없음 · 증권사 근거 변화
  const BASIS: Record<string, string> = { realized: "실제 실적", us_major_broker: "미국 증권사 전망", outlook: "전망 자료" };
  const industryView: Table = { head: ["산업", "고성장", "근거", "실적 매출 중앙값(전년 대비)", "산업 흐름 강도"], rows: tx.l1.map((r) => {
    const h = heatBy.get(r.code);
    const bases = Object.entries(h?.m3_basis?.bases ?? {}).filter(([, v]) => v).map(([k]) => BASIS[k] ?? k).join("·") || "-";
    return [r.name, h?.m3_pass ? "✓" : "—", bases, F("산업 근거", `${r.name} 실적 매출 중앙값`, h?.m3_median_rev_yoy_q0 ?? null, "pct_signed"), F("산업 근거", `${r.name} 산업 흐름 강도`, h?.n_score ?? null, "num")];
  }) };
  const noBasis = tx.l1.filter((r) => !heatBy.get(r.code)?.m3_pass).map((r) => r.name);
  const outs = await dbSelectAll<{ broker: string; l1: string | null; value_pct: number; published_date: string; url: string; status: string; adopted_at: string | null; expires_at: string | null }>("industry_outlooks", `select=broker,l1,value_pct,published_date,url,status,adopted_at,expires_at&or=(adopted_at.gte.${start},expires_at.gte.${start})`);
  const outlooks = (outs.ok ? outs.data : []).filter((o) => (o.status === "adopted" && o.adopted_at && kstDate(new Date(o.adopted_at)) <= end) || (o.status === "expired" && o.expires_at && kstDate(new Date(o.expires_at)) <= end))
    .map((o) => `${o.status === "adopted" ? "채택" : "만료"} · ${o.broker} ${l1Name(o.l1)} 성장 전망 ${F("증권사 근거", `${o.broker} ${l1Name(o.l1)} 전망`, Number(o.value_pct), "pct")} (${F("증권사 근거", "발표일", o.published_date, "text")}) ${txt(fb, "증권사 근거", "원문 링크", o.url)}`);

  // Ⅱ-4 매수 검토 리스트 · Ⅱ-5 보유 대응
  const lastEv = await dbSelectAll<{ date: string; entity_id: string; level: string; m1: boolean; m2: boolean; m3: boolean; m4: boolean; m5: boolean; invalidation_price: number | null; first_weight_pct: number | null; market: string }>("entry_eval", `select=date,entity_id,level,m1,m2,m3,m4,m5,invalidation_price,first_weight_pct,market&level=in.(green,yellow)&date=gte.${addDays(end, -4)}&order=date.desc`);
  const qLast = await dbSelect<{ date: string }>("queue_items", `select=date&date=lte.${addDays(end, 1)}&order=date.desc&limit=1`);
  const qItems = qLast.ok && qLast.data[0] ? await dbSelectAll<{ entity_id: string; queue: string; reason: { p?: number | null } }>("queue_items", `select=entity_id,queue,reason&date=eq.${qLast.data[0].date}`) : null;
  const seen = new Set<string>();
  const buyRows: string[][] = [];
  const ck = (x: { m1: boolean; m2: boolean; m3: boolean; m4: boolean; m5: boolean }) => [x.m1, x.m2, x.m3, x.m4, x.m5].map((b) => (b ? "✓" : "✗")).join("");
  for (const x of [...(lastEv.ok ? lastEv.data : [])].sort((a, b) => (a.level === "green" ? 0 : 1) - (b.level === "green" ? 0 : 1))) {
    if (seen.has(x.entity_id) || buyRows.length >= W.buy_list_max) continue;
    seen.add(x.entity_id);
    const nm = ents.byId.get(x.entity_id)?.name ?? x.entity_id;
    buyRows.push([nmx(nm), x.level === "green" ? "🟢 진입 신호" : "🟡 관찰", ck(x), F("매수 검토", `${nm} 무효화선`, x.invalidation_price === null ? null : Number(x.invalidation_price), x.market === "KR" ? "krw" : "usd"), x.first_weight_pct === null ? "SnowBall 허용 비중의 1/3" : F("매수 검토", `${nm} 1차 비중`, Number(x.first_weight_pct), "pct")]);
  }
  for (const q of (qItems?.ok ? qItems.data : []).filter((i) => i.queue === "buy").sort((a, b) => (a.reason.p ?? 99) - (b.reason.p ?? 99))) {
    if (seen.has(q.entity_id) || buyRows.length >= W.buy_list_max) continue;
    seen.add(q.entity_id);
    const nm = ents.byId.get(q.entity_id)?.name ?? q.entity_id;
    buyRows.push([nmx(nm), "🎯 매수 검토", "-", "-", F("매수 검토", `${nm} 주가 반영도`, q.reason.p ?? null, "num")]);
  }
  const buyList: Table = { head: ["종목", "단계", "조건 ①②③④⑤", "무효화선", "1차 비중(🎯는 주가 반영도)"], rows: buyRows };
  const alerts = await dbSelectAll<{ entity_id: string | null; payload: { name?: string; summary?: string } }>("notifications", `select=entity_id,payload&kind=eq.holding_alert&created_at=gte.${start}T00:00:00%2B09:00`);
  const hold = new Map<string, string>();
  for (const a of alerts.ok ? alerts.data : []) if (a.entity_id && !hold.has(a.entity_id)) hold.set(a.entity_id, `⚠️ ${ents.byId.get(a.entity_id)?.name ?? a.payload.name ?? a.entity_id} — ${txt(fb, "보유 대응", "경고 사유", a.payload.summary ?? "경고")} → 논지 재검토, SnowBall에 결정 기록`);
  for (const q of (qItems?.ok ? qItems.data : []).filter((i) => i.queue === "take_profit")) hold.set(`tp:${q.entity_id}`, `💰 ${ents.byId.get(q.entity_id)?.name ?? q.entity_id} — 과열·주가 반영도 높음 → 1/3 익절 검토`);
  // 보유 대응은 비중 초과(동적 허용) → 깊은 하락 순으로 12건까지, 나머지는 건수만
  const holdAll = [...hold.values()].sort((x, y) => Number(y.includes("허용")) - Number(x.includes("허용")) || Number(y.startsWith("💰")) - Number(x.startsWith("💰")));
  const holdList = holdAll.length > 12 ? [...holdAll.slice(0, 12), `외 ${F("보유 대응", "위 목록에 보이지 않은 나머지 보유 경고 수(전체가 아님)", holdAll.length - 12, "int")}건 — 대시보드 아이언맨의 포트폴리오 참고`] : holdAll;

  // FlyWheel 주간 리포트 (노션)
  const fw = await findFlywheelReport(week, start);
  const flywheel = fw ? `FlyWheel 주간 리포트 도착 (${fw})` : "FlyWheel 주간 리포트 미도착";

  const data: MemoData = {
    week, range: `${F("기간", "시작일", start, "text")} ~ ${F("기간", "종료일", end, "text")}`, asOf: kstString(now), flywheel,
    market, flows, industries, earnings: earnings.map((e) => txt(fb, "이번 주 실적(이미 발표)", "이번 주 실적 항목", e)), macro, sage,
    portfolio, contrib, regime, review, failDist, stance, calendar, industryView, noBasis, outlooks, buyList, holdings: holdList,
  };
  const krBaskets = [...krBasket.entries()].filter(([, b]) => b.w.length >= W.basket_min_members).map(([l1, b]) => ({ l1, w: mean(b.w), m: mean(b.m) }));
  return { data, fb, flywheelFound: !!fw, krBaskets, heatDate: heatLast.ok ? heatLast.data[0]?.date ?? null : null };
}

async function findFlywheelReport(week: string, start: string): Promise<string | null> {
  const key = env().NOTION_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.notion.com/v1/search", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
      // 노션 검색은 "2026-W40" 같은 토큰을 못 찾는다(10/3 실측) → 제목 문구로 찾고 주차는 아래에서 거른다
      body: JSON.stringify({ query: rules().weekly.flywheel_report_query, filter: { property: "object", value: "page" }, sort: { direction: "descending", timestamp: "last_edited_time" }, page_size: 20 }), signal: AbortSignal.timeout(20_000) });
    if (res.status !== 200) return null;
    const j = (await res.json()) as { results?: { url: string; created_time: string; properties?: Record<string, { title?: { plain_text: string }[] }> }[] };
    const hit = (j.results ?? []).find((r) => r.created_time >= `${start}T00:00:00Z` && Object.values(r.properties ?? {}).some((p) => p.title?.map((t) => t.plain_text).join("").includes(week)));
    return hit?.url ?? null;
  } catch { return null; }
}

/** 서술 요청 → 검증 → (실패 시 1회 재생성) */
async function narrate(data: MemoData, fb: FactBook, now: Date): Promise<{ n: NarrativeText | null; note: string | null; attempts: number; usd: number; violations: string[] }> {
  const ids = new Set(fb.facts.map((f) => f.id));
  // 숫자가 원래 들어간 고유명사·용어 — 산업명·지수명은 설정에서, 용어는 JARVIS 표기
  const R = rules();
  const allow = [...taxonomyConfig().l1.map((r) => r.name), ...R.weekly.market.returns.map((m) => m.label), ...R.weekly.market.levels.map((m) => m.label), "에스앤피500", "에스앤피 500", "러셀2000", "러셀 2000", "1차 비중", "1차 매수", "2차 매수", "3차 매수", "1차", "2차", "3차", "1/3", "1개월", "3개월", "6개월", "12개월", "52주", "10년물", "20일선", "5일선", "60일선"]
    .filter((x) => /[0-9]/.test(x)).flatMap((x) => [x, x.replace(/\s+/g, "")]);
  let user = userPrompt(data.week, factLines(fb.facts), briefOf(data));
  let usd = 0, last: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await llmJson<Narrative>({ purpose: "weekly_memo", system: SYSTEM, user, schema: NarrativeSchema, now });
    if (!r.ok) return { n: null, note: `서술 생성 실패(${r.reason}) — 표·목록만 발행`, attempts: attempt, usd, violations: last };
    usd += r.data.usd;
    const x = r.data.data;
    const sc = ["Bull", "Base", "Bear"].map((nm) => x.scenarios.find((s) => s.name === nm)).filter((s): s is Narrative["scenarios"][number] => !!s);
    const texts = [x.market_view, x.industry_causes, x.portfolio_view, x.stance, x.industry_view, ...sc.flatMap((s) => [s.view, s.trigger]), ...x.wrong_reasons, ...x.decisions];
    const g = checkAll(texts, ids, allow);
    const probs = sc.length === 3 ? checkProbabilities(sc.map((s) => s.probability)) : ["시나리오 3개가 아님"];
    const violations = [...g.violations, ...probs, ...(x.wrong_reasons.length < 3 ? ["틀릴 수 있는 이유 3개 미만"] : []), ...(x.decisions.length < 3 ? ["결정할 것 3개 미만"] : [])];
    if (!violations.length) {
      const rd = (s: string) => render(s, fb.display);
      return { n: { market_view: rd(x.market_view), industry_causes: rd(x.industry_causes), portfolio_view: rd(x.portfolio_view), stance: rd(x.stance), industry_view: rd(x.industry_view),
        scenarios: sc.map((s) => ({ name: s.name, probability: s.probability, view: rd(s.view), trigger: rd(s.trigger) })), wrong_reasons: x.wrong_reasons.slice(0, 3).map(rd), decisions: x.decisions.slice(0, 3).map(rd) }, note: null, attempts: attempt, usd, violations: [] };
    }
    last = violations;
    user = `${user}\n\n## 직전 응답의 규칙 위반 (모두 고쳐서 다시)\n${violations.slice(0, 20).map((v) => `- ${v}`).join("\n")}`;
  }
  return { n: null, note: `서술 숫자 검증 2회 실패(${last.slice(0, 3).join(" / ")}) — 표·목록만 발행`, attempts: 2, usd, violations: last };
}

export async function runWeekly(now = new Date(), opts: { force?: boolean; dryRun?: boolean } = {}): Promise<Record<string, unknown>> {
  const { week } = memoWeek(now);
  const done = await dbSelect<{ telegram_sent_at: string | null }>("weekly_memos", `select=telegram_sent_at&week=eq.${week}`);
  if (!opts.force && !opts.dryRun && done.ok && done.data[0]?.telegram_sent_at) return { skipped: `${week} 이미 발행` };
  const { data, fb, flywheelFound, krBaskets, heatDate } = await collectMemo(now);
  // FlyWheel 리포트가 없으면 마감(10:30 KST) 전까지는 미룬다 — pg_cron 이 15분 뒤 다시 부른다
  const hhmm = kstString(now).slice(11, 16);
  if (!flywheelFound && !opts.force && !opts.dryRun && hhmm < rules().weekly.publish_deadline_kst && new Date(now.getTime() + 9 * 3600_000).getUTCDay() === 6) return { deferred: "FlyWheel 주간 리포트 대기", week, at: hhmm };

  const nr = await narrate(data, fb, now);
  const md = render(composeMemo(data, nr.n, nr.note), fb.display);
  const out = { week, facts: fb.facts.length, grounding_ok: !!nr.n, attempts: nr.attempts, usd: Number(nr.usd.toFixed(4)), violations: nr.violations.slice(0, 5), note: nr.note, flywheel: flywheelFound };
  if (opts.dryRun) return { ...out, md };

  // 산업 레이더용: 국내 동일가중 바스켓 성과를 최신 산업 판정 행에 기록
  if (heatDate) for (const b of krBaskets) await dbUpdate("industry_heat", `date=eq.${heatDate}&l1=eq.${encodeURIComponent(b.l1)}`, { basket_ret_1w: b.w, basket_ret_1m: b.m });
  const title = `JARVIS 주간 투자위원회 ${week}`;
  const notion = await createNotionPage(env().NOTION_WEEKLY_PARENT_PAGE_ID, title, mdToNotion(md));
  const base = env().JARVIS_URL?.replace(/\/$/, "");
  const chat = env().TELEGRAM_CHAT_ID;
  const text = weeklyText({
    week, range: render(data.range, fb.display), stance: render(data.stance, fb.display), market: data.market.rows.slice(0, 6).map((r) => `${r[0]} ${render(r[1], fb.display)}`),
    krTop: data.industries.kr.rows.slice(0, 3).map((r) => `${r[1]} ${render(r[2], fb.display)}`), krBottom: data.industries.kr.rows.slice(3).map((r) => `${r[1]} ${render(r[2], fb.display)}`),
    buy: data.buyList.rows.map((r) => `${r[1].split(" ")[0]} ${render(r[0], fb.display)}`), scenarios: nr.n?.scenarios.map((s) => ({ name: s.name, probability: s.probability })) ?? [],
    decisions: nr.n?.decisions ?? [], grounded: !!nr.n, note: nr.note, flywheel: data.flywheel, url: base ? `${base}/weekly` : null, notionUrl: notion.ok ? notion.data : null,
  });
  const buttons = btnRows(dashboardButtons(linksConfig().dashboards, env().JARVIS_URL), 3);
  const sent = chat ? await sendMessage(chat, text, buttons) : { ok: false as const, reason: "TELEGRAM_CHAT_ID 미설정" };
  const w = await dbInsert("weekly_memos", [{ week, fact_table: { facts: fb.facts, violations: nr.violations, attempts: nr.attempts, usd: nr.usd }, body_md: md, grounding_ok: !!nr.n, notion_url: notion.ok ? notion.data : null, telegram_sent_at: sent.ok ? new Date().toISOString() : null }], { upsertOn: "week" });
  if (!w.ok) throw new Error(w.reason);
  return { ...out, notion: notion.ok ? notion.data : notion.reason, sent: sent.ok };
}

