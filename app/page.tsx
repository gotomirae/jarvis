import { MarketPanel, PickChart } from "@/app/_components/charts";
import { Bad, Card, Empty, Footer, Good, Guide, Hi, LinkRow, MarkLine, Nav, Page, Pct, Section, Stat } from "@/app/_components/ui";
import { dashboardConfig, marketCharts, pickCharts } from "@/lib/dashboard/data";
import { linksConfig, taxonomyConfig } from "@/lib/config/load";
import { explain, type AxesEvidence } from "@/lib/engine/explain";
import type { PerfStat } from "@/lib/engine/feedback";
import { buyReasons, consensusOf, EMPTY_IDEA, ideaCard, rankBuy } from "@/lib/engine/idea";
import { assess, candidatePool, type Assessed, type Policy } from "@/lib/engine/pick-policy";
import type { Queue } from "@/lib/engine/queues";
import { issues, setupLine, VERDICT_SHORT } from "@/lib/engine/timing";
import { env } from "@/lib/env";
import { rules } from "@/lib/jobs/context";
import { stockLinks, type LinkEntity } from "@/lib/links";
import { priceStr, recHistory, recLine, recReturn, type BriefNote, type RecHist } from "@/lib/outcomes/rec-history";
import { supabaseServer } from "@/lib/supabase/server";
import type { Bar, PickPoint } from "@/lib/engine/series";
import { kstDate, kstString } from "@/lib/time";

export const dynamic = "force-dynamic";

type QItem = { date: string; entity_id: string; queue: Queue; reason: Record<string, unknown>; first_seen: string };
type Ent = LinkEntity & { l1_codes: string[] };
type Ctx = Parameters<typeof stockLinks>[1];

const SECTIONS: { queue: Queue; title: string; about: string[] }[] = [
  { queue: "take_profit", title: "💰 익절 검토", about: ["보유 종목 중 과열 점수 · 주가 반영도가 모두 높음", "👉 일부 이익 실현 검토"] },
  { queue: "radar", title: "🔭 선행 관찰", about: ["산업 이야기 · 실적 촉매는 켜짐, 실적 숫자는 확인 전", "실적 발표 45일 이내 → 발표 뒤 🎯 로 올라올 수 있음"] },
  { queue: "pullback_wait", title: "⏳ 눌림 대기", about: ["실적은 좋지만 주가가 이미 많이 반영됨", "🚀 상승 초기 조건(눌림 + 5·20일선 · MACD 돌파 직전 · 직후)을 만족하면 위 🎯 후보로 승격"] },
];

/** 오늘 (PRD §8): 요약 타일 → 시장 국면(+공포·탐욕) → 주요 지표 → 🎯 지금 사기 좋은 종목(그래프·추천 후 수익률) → 대기 → 익절 → 선행 관찰 → 눌림 대기. 보유 경고는 🦾 포트폴리오 탭(10/8) */
export default async function Today() {
  const sb = await supabaseServer();
  const R = rules();
  const since7 = new Date(Date.now() - 7 * 86400_000).toISOString();
  const [lastDate, reg, alerts, pol, lastStats, notes, lastKR, lastUS] = await Promise.all([
    sb.from("queue_items").select("date").order("date", { ascending: false }).limit(1).maybeSingle(),
    sb.from("bot_state").select("value").eq("key", "regime").maybeSingle(),
    sb.from("notifications").select("entity_id,payload,sent_at,created_at").eq("kind", "holding_alert").gte("created_at", since7).order("created_at", { ascending: false }).range(0, 99),
    sb.from("bot_state").select("value").eq("key", "pick_policy").maybeSingle(),
    sb.from("perf_stats").select("as_of").order("as_of", { ascending: false }).limit(1).maybeSingle(),
    sb.from("notifications").select("sent_at,payload").in("kind", ["brief_morning", "brief_evening"]).not("sent_at", "is", null).order("sent_at", { ascending: true }).range(0, 1999),
    sb.from("entry_eval").select("date").eq("market", "KR").order("date", { ascending: false }).limit(1).maybeSingle(),
    sb.from("entry_eval").select("date").eq("market", "US").order("date", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const date = (lastDate.data?.date as string | undefined) ?? kstDate();
  const mc = await marketCharts();
  const DC = dashboardConfig();
  const fgNow = mc.fg[mc.fg.length - 1], vixNow = mc.vix[mc.vix.length - 1];
  const fgWeek = fgNow ? [...mc.fg].reverse().find((x) => x.date <= new Date(Date.parse(`${fgNow.date}T00:00:00Z`) - 7 * 86400_000).toISOString().slice(0, 10)) : undefined;
  const evalDates = [lastKR.data?.date, lastUS.data?.date].filter((d): d is string => !!d);
  const [items, axes, st, ee] = await Promise.all([
    sb.from("queue_items").select("date,entity_id,queue,reason,first_seen").eq("date", date).range(0, 499),
    sb.from("axes_daily").select("entity_id,evidence").eq("date", date).range(0, 1999),
    lastStats.data ? sb.from("perf_stats").select("scope,dimension,bucket,horizon_days,n,median_excess,hit_rate").eq("as_of", lastStats.data.as_of).eq("horizon_days", R.feedback.primary_horizon).in("scope", ["buy", R.pick_policy.scope]).range(0, 4999) : Promise.resolve({ data: [] }),
    evalDates.length ? sb.from("entry_eval").select("date,market,level").in("date", evalDates).in("level", ["green", "yellow"]).range(0, 999) : Promise.resolve({ data: [] }),
  ]);
  const q = (items.data ?? []) as QItem[];
  const evBy = new Map(((axes.data ?? []) as { entity_id: string; evidence: AxesEvidence }[]).map((a) => [a.entity_id, a.evidence]));
  const ids = [...new Set(q.map((x) => x.entity_id))];
  const ents = ids.length ? await sb.from("entities").select("id,market,symbol,name,primary_l1,l1_codes,snowball_asset_id,hermes_analysis_id,naver_us_code").in("id", ids) : { data: [] };
  const byId = new Map(((ents.data ?? []) as Ent[]).map((e) => [e.id, e]));
  const ctx = { links: linksConfig(), taxonomy: taxonomyConfig(), jarvisUrl: env().JARVIS_URL };
  const r = reg.data?.value as { risk_off?: boolean; reasons?: string[]; vix?: number | null; snowball?: number | null; at?: string } | undefined;
  const policy = ((pol.data?.value as { policy?: Policy } | undefined)?.policy) ?? null;
  const entryRows = ((ee.data ?? []) as { date: string; market: string; level: string }[]).filter((x) => (x.market === "KR" ? x.date === lastKR.data?.date : x.date === lastUS.data?.date));
  const hist = recHistory((notes.data ?? []) as BriefNote[], (c) => (byId.has(`KR:${c}`) ? `KR:${c}` : byId.has(`US:${c}`) ? `US:${c}` : null));

  // 🎯 후보 평가 — 브리핑과 같은 함수(assess · candidatePool · rankBuy). ⏳ 눌림 대기도 상승 초기 조건을 만족하면 후보로 승격(D66)
  const today = kstDate();
  const cands = candidatePool(q.filter((x) => (x.queue === "buy" || R.pick_policy.promote_from.includes(x.queue)) && byId.has(x.entity_id)).map((x) => {
    const e = byId.get(x.entity_id)!;
    const ev = evBy.get(x.entity_id) ?? {};
    const p = (x.reason as { p?: number | null }).p ?? null;
    const a = assess({ ev, p, market: e.market, l1: e.primary_l1 ?? null, riskOff: r?.risk_off === true, today }, R, policy, (st.data ?? []) as PerfStat[]);
    return { ...x, e, ev, a, p, families: ev.families?.length ?? 0, industryGrowth: ev.idea?.industry?.realized_median ?? null, nextEvent: ev.next_event ?? null, perf: a.prior.score, timing: a.timing.score };
  }), R.pick_policy.promote_from);
  const promoted = new Set(cands.filter((c) => c.promoted).map((c) => c.entity_id));
  const good = cands.filter((c) => c.a.admit.ok);
  const top = [...rankBuy(good.filter((c) => c.e.market === "KR"), good.length), ...rankBuy(good.filter((c) => c.e.market === "US"), good.length)];
  const waiting = cands.filter((c) => !c.a.admit.ok).sort((x, y) => y.a.timing.score - x.a.timing.score);
  // 종목 그래프 — 🎯 · ⏸️ 대기 · 💰 익절 · 🔭 선행 관찰 · ⏳ 눌림 대기 모두 같은 조건 (10/8)
  const charts = await pickCharts([...new Set([...top, ...waiting].map((c) => c.entity_id).concat(q.filter((x) => SECTIONS.some((s) => s.queue === x.queue) && byId.has(x.entity_id)).map((x) => x.entity_id)))]);
  const chartCfg: ChartCfg = { ma: DC.pick_chart.ma, overbought: DC.entry_chart.rsi_overbought, oversold: DC.entry_chart.rsi_oversold };

  // 보유 경고 개수 (자세한 내용은 🦾 포트폴리오 탭, 10/8)
  const alertBy = new Set(((alerts.data ?? []) as { entity_id: string | null; payload: { name?: string; asset_id?: string } }[]).map((a) => a.entity_id ?? a.payload?.asset_id ?? a.payload?.name ?? "-"));
  const o = policy?.overall;

  return (
    <Page>
      <Nav />

      <div className="flex flex-wrap gap-3">
        <Stat icon={r?.risk_off ? "🔴" : "🟢"} label="시장 국면" value={r ? (r.risk_off ? "위험 회피" : "정상") : "계산 전"} tone={r?.risk_off ? "hot" : "good"} sub={`변동성지수 ${r?.vix?.toFixed(1) ?? "-"}${fgNow ? ` · 공포·탐욕 ${Math.round(fgNow.value)}` : ""}`} />
        <Stat icon="⚠️" label="보유 경고 (7일)" value={alertBy.size} tone={alertBy.size ? "hot" : "good"} sub={<a className="link" href="/portfolio">🦾 포트폴리오에서 보기 →</a>} />
        <Stat icon="🎯" label="지금 사기 좋은 종목" value={`${good.length} / ${cands.length}`} sub="추천 자격 / 매수 검토 후보" />
        <Stat icon="🚦" label="진입 · 관찰" value={`${entryRows.filter((x) => x.level === "green").length} · ${entryRows.filter((x) => x.level === "yellow").length}`} tone="arc" sub={<a className="link" href="/entry">진입 보드 →</a>} />
        <Stat icon="✅" label={`추천 승률 (${policy?.horizon ?? R.feedback.primary_horizon}거래일)`} value={o?.hit_rate == null ? "측정 중" : `${Math.round(o.hit_rate * 100)}%`} tone="good" sub={<a className="link" href="/verify">사후 검증 {o?.n ?? 0}건 →</a>} />
      </div>

      <div className={`glass rounded-xl px-4 py-3 border-l-4 ${r?.risk_off ? "border-l-hot" : "border-l-good"}`}>
        <p className="text-lg font-bold">{r ? (r.risk_off ? <>🔴 시장 국면: <Bad>위험 회피</Bad></> : <>🟢 시장 국면: <Good>정상</Good></>) : "시장 국면: 아직 계산 전"}</p>
        {r && <p className="text-sm text-sub mt-1">
          {r.risk_off ? <>이유: <Hi>{(r.reasons ?? []).join(", ")}</Hi> → 진입 신호의 1차 비중을 <Hi>절반</Hi>으로 줄입니다.<br /></> : null}
          📉 변동성지수(VIX) <b className="text-white">{r.vix?.toFixed(1) ?? "-"}</b> · SnowBall 국면 값 <b className="text-white">{r.snowball ?? "-"}</b> (−1이면 위험 회피)
        </p>}
        {fgNow && <FearGreed v={fgNow.value} rating={fgNow.rating} bands={DC.fear_greed.bands} color={DC.fear_greed.color} prev={fgWeek?.value ?? null} />}
      </div>

      <Section title="📊 주요 지표">
        <div className="table-wrap">
          <table className="text-sm">
            <thead><tr><th>지수</th><th>현재</th><th>이번 주</th><th>이번 달</th><th>최근 {DC.lookback_months}개월</th></tr></thead>
            <tbody>{mc.lines.map((l) => (
              <tr key={l.key} className="border-t border-line/50">
                <td className="font-semibold whitespace-nowrap"><span style={{ color: l.color }}>●</span> {l.label}</td>
                <td className="tabular-nums whitespace-nowrap">{l.last === null ? "-" : l.last.toLocaleString("en-US", { maximumFractionDigits: 2 })} <span className="text-xs text-sub">{l.last_date ? `${l.last_date.slice(5).replace("-", "/")} 종가` : ""}</span></td>
                <td className="whitespace-nowrap"><Pct v={l.wtd} />{l.week && <span className="block text-xs text-sub">{l.week.start.slice(5).replace("-", "/")}~{l.week.end.slice(5).replace("-", "/")}</span>}</td>
                <td className="whitespace-nowrap"><Pct v={l.mtd} /></td>
                <td className="whitespace-nowrap"><Pct v={l.ret} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="glass rounded-xl p-4">
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {fgNow && <span className="whitespace-nowrap">😱 공포·탐욕 <b style={{ color: DC.fear_greed.color }}>{fgNow.value} · {fgNow.rating}</b></span>}
            {vixNow && <span className="whitespace-nowrap">🌪️ 변동성지수 <b className={vixNow.value >= DC.vix.fear_above ? "text-hot" : vixNow.value < DC.vix.calm_below ? "text-good" : "text-gold"}>{vixNow.value.toFixed(1)}</b></span>}
            <span className="whitespace-nowrap text-sub">↕️ 세 그래프는 같은 날짜가 같은 세로선 · 마우스를 올리면 함께 표시</span>
          </div>
          {mc.indices.length ? <MarketPanel data={mc.indices} lines={mc.lines} bands={DC.fear_greed.bands} calm={DC.vix.calm_below} fear={DC.vix.fear_above} fgColor={DC.fear_greed.color} /> : <Empty text="시세 자료를 불러오지 못했습니다." />}
        </div>
      </Section>

      <Section title="🎯 지금 사기 좋은 종목" count={top.length}>
        <Guide items={[
          <>🏢 <b className="text-white">좋은 기업</b> = 실적 · 산업 · 신호 합의 (매수 검토 후보)</>,
          <>⏱️ <b className="text-gold">지금 사기 좋은가</b> = 가격 · 추세 · 수급 · 과열</>,
          <>🚀 <b className="text-hot">필수: 상승 초기</b> = 고점 대비 눌림 + 5·20일선 · MACD 상향 돌파 <b className="text-white">직전 · 직후(3일 이내)</b></>,
          <>⏳ 눌림 대기 종목도 상승 초기 조건을 만족하면 <b className="text-hot">승격</b> (주가 반영도는 보정 중 → 비중 작게)</>,
          <>⏸️ 대기이거나 사후 검증에서 승률 낮은 기준에 걸리면 제외</>,
          <>📨 시장별 상위 {R.pick_policy.top_max}개가 텔레그램 추천</>,
        ]} />
        {policy?.exclude.length ? <p className="text-sm">📐 사후 검증으로 빠진 기준: {policy.exclude.map((x) => <span key={x.title} className="mr-2 rounded-full border border-hot/50 bg-hot/10 px-2 py-0.5 text-hot">{x.title}</span>)}</p> : null}
        {top.length === 0 ? <Empty text={cands.length ? `오늘은 지금 사기 좋은 종목이 없습니다 — 후보 ${cands.length}개 모두 타이밍 대기.` : "매수 검토 후보가 없습니다."} /> : top.map((c) => {
          const rank = (c.e.market === "KR" ? top.filter((x) => x.e.market === "KR") : top.filter((x) => x.e.market === "US")).indexOf(c) + 1;
          return <IdeaView key={c.entity_id} c={c} rank={rank} hist={hist.get(c.entity_id)} ctx={ctx} telegram={rank <= R.pick_policy.top_max} chart={charts.get(c.entity_id)} chartCfg={chartCfg} />;
        })}
      </Section>

      <Section title="⏸️ 좋은 기업이지만 지금은 대기" count={waiting.length}>
        <Guide items={["실적 · 산업은 좋지만 지금 가격 · 추세 · 수급이 별로", <>🚀 상승 초기 조건(눌림 + 5·20일선 · MACD 돌파 직전 · 직후)이 <b className="text-hot">안 맞아도</b> 여기</>, "조건이 맞으면 위 🎯 목록으로 올라옴"]} />
        {waiting.length === 0 ? <Empty text="없음" /> : waiting.map((c) => (
          <Card key={c.entity_id} tone="muted">
            <p className="text-base font-bold">
              <a href={`/stock/${encodeURIComponent(c.entity_id)}`} className="hover:text-arc">{c.e.market === "US" ? "🇺🇸" : "🇰🇷"} {c.e.name}</a>
              <span className="ml-2 text-sm font-normal text-sub">{c.e.symbol}</span>
              <span className="ml-2 text-sm text-warn font-semibold">{VERDICT_SHORT[c.a.timing.verdict]} {c.a.timing.score > 0 ? "+" : ""}{c.a.timing.score}</span>
              {c.promoted && <span className="ml-2 text-xs text-hot">⏳ 눌림 대기에서 승격</span>}
            </p>
            <ul className="list-none"><MarkLine text={setupLine(c.a.timing)} /></ul>
            <p className="text-sm">⏸️ <b className="text-warn">대기 이유</b> {[c.a.admit.why.join(" · "), issues(c.a.timing)].filter(Boolean).join(" — ")}</p>
            <StockGraph id={c.entity_id} market={c.e.market} chart={charts.get(c.entity_id)} cfg={chartCfg} hist={hist.get(c.entity_id)} />
          </Card>
        ))}
      </Section>

      {SECTIONS.map((s) => <QueueSection key={s.queue} {...s} q={q.filter((x) => !promoted.has(x.entity_id))} byId={byId} evBy={evBy} ctx={ctx} charts={charts} chartCfg={chartCfg} hist={hist} />)}

      <Section title="🚦 진입 신호 · 관찰 · 실적 돌파">
        <Guide items={["🟢 진입 신호 = 필수 조건 5개 모두 충족", "🟡 관찰 · 🔵 실적 돌파도 함께", <a key="e" className="link" href="/entry">🚦 진입 보드에서 보기 →</a>]} />
      </Section>
      <Footer asOf={`${date} 판정 · 시장 국면 ${r?.at ? kstString(new Date(r.at)) : "-"}`} />
    </Page>
  );
}

type Cand = { entity_id: string; e: Ent; ev: AxesEvidence; a: Assessed; p: number | null; promoted: boolean };

/** 🎯 카드 — 이름 → 추천 이력 → 지금 매수 매력 → 아이디어 → 🏢 | ⏱️ → 이벤트·리스크 → 링크 */
type ChartCfg = { ma: [number, number]; overbought: number; oversold: number };
type Charts = Map<string, { points: PickPoint[]; bars: Bar[] }>;

/** 종목 그래프 — 🎯 카드와 같은 조건(12개월 주가 · 5·20일선 · MACD · RSI), 추천받은 적 있으면 첫 추천일 표시 */
function StockGraph({ id, market, chart, cfg, hist }: { id: string; market: "KR" | "US"; chart: { points: PickPoint[]; bars: Bar[] } | undefined; cfg: ChartCfg; hist: RecHist | undefined }) {
  if (!chart?.points.length) return <Empty text="주가 자료를 불러오지 못했습니다." />;
  const rr = recReturn(hist, chart.bars);
  return <PickChart id={id} data={chart.points} ma={cfg.ma} overbought={cfg.overbought} oversold={cfg.oversold} currency={market === "KR" ? "KRW" : "USD"} rec={rr ? { date: rr.first_date, price: rr.first_price } : null} />;
}

function IdeaView({ c, rank, hist, ctx, telegram, chart, chartCfg }: { c: Cand; rank: number; hist: RecHist | undefined; ctx: Ctx; telegram: boolean; chart: { points: PickPoint[]; bars: Bar[] } | undefined; chartCfg: ChartCfg }) {
  const cur = c.e.market === "KR" ? "KRW" : "USD";
  const rr = recReturn(hist, chart?.bars ?? []);
  const idea = c.ev.idea ?? EMPTY_IDEA;
  const card = ideaCard(rank, { name: c.e.name, symbol: c.e.symbol, market: c.e.market, industry: idea.industry?.name ?? "" }, idea,
    buyReasons({ idea, consensus: consensusOf(c.ev), grade: c.ev.F?.grade ?? null, score: c.ev.F?.score ?? null }), c.ev.tech, "", null,
    { timing: c.a.timing, history: hist ? recLine({ nth: hist.count, first_at: hist.first_at, first_price: hist.first_price, cur_price: hist.last_price, cur_date: hist.last_price_date, currency: c.e.market === "KR" ? "KRW" : "USD" }) : null });
  const t = c.a.timing;
  const vc = t.verdict === "high" ? "border-hot/60 bg-hot/15 text-hot" : "border-gold/60 bg-gold/10 text-gold";
  return (
    <Card tone={t.verdict === "high" ? "warn" : "gold"}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-lg font-bold">
            <span className="mr-2 rounded-md bg-gold px-2 py-0.5 text-ink text-sm align-middle">#{rank}</span>
            <a href={`/stock/${encodeURIComponent(c.entity_id)}`} className="hover:text-arc">{card.flag} {card.name}</a>
            <span className="ml-2 text-sm font-normal text-sub">{card.code}{card.industry ? ` · ${card.industry}` : ""}</span>
          </p>
          {c.promoted && <p className="text-sm mt-1"><span className="rounded-full border border-hot/60 bg-hot/10 px-2.5 py-0.5 text-hot font-bold">⏳ 눌림 대기 → 🚀 상승 초기 승격</span> <span className="text-sub">주가 반영도 {c.p === null ? "-" : Math.round(c.p)} (보정 중이라 비중 작게)</span></p>}
          <RecBadge rr={rr} currency={cur} />
          {telegram && <p className="text-xs text-good mt-0.5">📨 텔레그램 추천 대상 (시장별 상위)</p>}
        </div>
        <span className={`rounded-full border px-3 py-1 text-sm font-bold ${vc}`}>{card.verdict}</span>
      </div>
      {chart?.points.length ? <PickChart id={c.entity_id} data={chart.points} ma={chartCfg.ma} overbought={chartCfg.overbought} oversold={chartCfg.oversold} currency={cur} rec={rr ? { date: rr.first_date, price: rr.first_price } : null} /> : <Empty text="주가 자료를 불러오지 못했습니다." />}
      {card.thesis && <p className="rounded-lg bg-panel2/70 px-3 py-2">💡 <b className="text-gold">투자 아이디어</b><br />{card.thesis}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <p className="font-bold mb-1">🏢 좋은 기업인가</p>
          <ul className="space-y-1">{card.reasons.length ? card.reasons.map((x, i) => <li key={i}>{x}</li>) : <li className="text-sub">근거 자료 없음</li>}</ul>
        </div>
        <div>
          <p className="font-bold mb-1">⏱️ 지금 사기 좋은가</p>
          <ul className="space-y-1">{(card.timing ?? []).map((x, i) => <MarkLine key={i} text={x} />)}</ul>
        </div>
      </div>
      {(card.events.length > 0 || card.risk || card.tech || c.a.prior.overall) && (
        <div className="space-y-1 border-t border-line/60 pt-2">
          {card.events.length > 0 && <p>⏰ <b>다음 확인</b> {card.events.join(" / ")}</p>}
          {card.risk && <p>⚠️ <b className="text-warn">리스크</b> {card.risk}</p>}
          {card.tech && <p className="text-sub">📊 기술적 참고(판정 미사용): {card.tech}</p>}
        </div>
      )}
      <LinkRow links={stockLinks(c.e, ctx)} />
    </Card>
  );
}

function QueueSection({ queue, title, about, q, byId, evBy, ctx, charts, chartCfg, hist }: {
  queue: Queue; title: string; about: string[]; q: QItem[]; byId: Map<string, Ent>; evBy: Map<string, AxesEvidence>; ctx: Ctx;
  charts: Charts; chartCfg: ChartCfg; hist: Map<string, RecHist>;
}) {
  const xs = q.filter((x) => x.queue === queue);
  return (
    <Section title={title} count={xs.length}>
      <Guide items={about} />
      {xs.length === 0 ? <Empty text="없음" /> : xs.map((x) => {
        const e = byId.get(x.entity_id);
        const rs = x.reason as { p?: number | null; days_to_earnings?: number; heat?: number };
        const ex = explain({ queue, market: e?.market ?? "KR", evidence: evBy.get(x.entity_id) ?? {}, p: rs.p ?? null, daysToEarnings: rs.days_to_earnings ?? null, heat: rs.heat ?? null });
        const days = Math.max(1, Math.ceil((Date.now() - new Date(x.first_seen).getTime()) / 86400_000));
        return (
          <Card key={x.entity_id} tone={queue === "take_profit" ? "gold" : "muted"}>
            <p className="text-base font-bold">
              <a href={`/stock/${encodeURIComponent(x.entity_id)}`} className="hover:text-arc">{e?.market === "US" ? "🇺🇸" : "🇰🇷"} {e?.name ?? x.entity_id}</a>
              <span className="ml-2 text-sm font-normal text-sub">{e?.symbol} · 이 목록에 <b className="text-white">{days}일째</b></span>
            </p>
            <p>👉 <Hi>결론</Hi> {ex.conclusion}</p>
            <ul className="space-y-0.5">{ex.reasons.map((t, i) => <li key={i}>▪️ {t}</li>)}</ul>
            {e && <StockGraph id={x.entity_id} market={e.market} chart={charts.get(x.entity_id)} cfg={chartCfg} hist={hist.get(x.entity_id)} />}
            {e && <LinkRow links={stockLinks(e, ctx)} />}
          </Card>
        );
      })}
    </Section>
  );
}

/** 🎯 추천 후 수익률 — 첫 추천 기준가 → 최근 종가 (10/8 사용자 요청) */
function RecBadge({ rr, currency }: { rr: ReturnType<typeof recReturn>; currency: "KRW" | "USD" }) {
  if (!rr) return <p className="text-sm mt-1"><span className="rounded-full border border-arc/60 bg-arc/10 px-2.5 py-0.5 text-arc font-bold">🆕 첫 추천</span> <span className="text-sub">수익률은 다음 브리핑부터 계산</span></p>;
  const up = rr.ret > 0, c = up ? "border-hot/60 bg-hot/15 text-hot" : rr.ret < 0 ? "border-cool/60 bg-cool/15 text-cool" : "border-line text-white";
  const md = (d: string) => d.slice(5).replace("-", "/");
  return (
    <p className="text-sm mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className={`rounded-full border px-2.5 py-0.5 font-extrabold tabular-nums ${c}`}>{up ? "📈" : rr.ret < 0 ? "📉" : "➖"} 추천 후 {up ? "+" : ""}{rr.ret.toFixed(1)}%</span>
      <span className="text-sub">{rr.nth > 1 ? `🔁 ${rr.nth}번째 추천 · ` : "🆕 첫 추천 · "}{md(rr.first_date)} {priceStr(rr.first_price, currency)}{rr.estimated ? "(추정)" : ""} → {md(rr.cur_date)} <b className="text-white">{priceStr(rr.cur_price, currency)}</b></span>
    </p>
  );
}

/** 😱 공포·탐욕 — 막대 위 현재 위치 + 일주일 전 대비 (10/8 사용자 요청) */
function FearGreed({ v, rating, bands, color, prev }: { v: number; rating: string; bands: { extreme_fear: number; fear: number; greed: number; extreme_greed: number }; color: string; prev: number | null }) {
  const kr = v < bands.extreme_fear ? "극단적 공포" : v < bands.fear ? "공포" : v <= bands.greed ? "중립" : v <= bands.extreme_greed ? "탐욕" : "극단적 탐욕";
  const tone = v < bands.fear ? "text-cool" : v > bands.greed ? "text-hot" : "text-gold";
  const d = prev === null ? null : v - prev;
  return (
    <div className="mt-2 space-y-1">
      <p className="text-sm">😱 공포·탐욕 지수 <b className="text-lg" style={{ color }}>{Math.round(v)}</b> <b className={tone}>{kr}</b>{rating && rating !== kr ? <span className="text-xs text-sub"> ({rating})</span> : null}
        {d !== null && <span className="ml-2 text-xs">1주 전 대비 <b className={d > 0 ? "text-hot" : d < 0 ? "text-cool" : "text-white"}>{d > 0 ? "▲ +" : d < 0 ? "▼ " : ""}{d.toFixed(0)}</b></span>}
      </p>
      <div className="relative h-2.5 rounded-full" style={{ background: "linear-gradient(90deg,#60a5fa 0%,#60a5fa 25%,#fcd34d 50%,#ff6b6b 75%,#ff6b6b 100%)" }}>
        <span className="absolute -top-1 h-4.5 w-1.5 rounded bg-white shadow-[0_0_6px_#fff]" style={{ left: `calc(${Math.min(100, Math.max(0, v))}% - 3px)` }} />
      </div>
      <p className="flex justify-between text-[11px] text-sub"><span>0 극단적 공포</span><span>50 중립</span><span>100 극단적 탐욕</span></p>
    </div>
  );
}
