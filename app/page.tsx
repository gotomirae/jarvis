import { FearGreedChart, IndexChart, VixChart } from "@/app/_components/charts";
import { Bad, Card, Empty, Footer, Good, Guide, Hi, LinkRow, MarkLine, Nav, Page, Pct, Section, Stat } from "@/app/_components/ui";
import { dashboardConfig, marketCharts } from "@/lib/dashboard/data";
import { linksConfig, taxonomyConfig } from "@/lib/config/load";
import { explain, type AxesEvidence } from "@/lib/engine/explain";
import type { PerfStat } from "@/lib/engine/feedback";
import { buyReasons, consensusOf, EMPTY_IDEA, ideaCard, rankBuy } from "@/lib/engine/idea";
import { assess, type Assessed, type Policy } from "@/lib/engine/pick-policy";
import type { Queue } from "@/lib/engine/queues";
import { issues, VERDICT_SHORT } from "@/lib/engine/timing";
import { env } from "@/lib/env";
import { rules } from "@/lib/jobs/context";
import { stockLinks, type LinkEntity } from "@/lib/links";
import { recHistory, recLine, type BriefNote, type RecHist } from "@/lib/outcomes/rec-history";
import { supabaseServer } from "@/lib/supabase/server";
import { kstDate, kstString } from "@/lib/time";

export const dynamic = "force-dynamic";

type QItem = { date: string; entity_id: string; queue: Queue; reason: Record<string, unknown>; first_seen: string };
type Ent = LinkEntity & { l1_codes: string[] };
type Ctx = Parameters<typeof stockLinks>[1];

const SECTIONS: { queue: Queue; title: string; about: string[] }[] = [
  { queue: "take_profit", title: "💰 익절 검토", about: ["보유 종목 중 과열 점수 · 주가 반영도가 모두 높음", "👉 일부 이익 실현 검토"] },
  { queue: "radar", title: "🔭 선행 관찰", about: ["산업 이야기 · 실적 촉매는 켜짐, 실적 숫자는 확인 전", "실적 발표 45일 이내 → 발표 뒤 🎯 로 올라올 수 있음"] },
  { queue: "pullback_wait", title: "⏳ 눌림 대기", about: ["실적은 좋지만 주가가 이미 많이 반영됨", "👉 반영도가 50 아래로 내려오면 다시 보기"] },
];

/** 오늘 (PRD §8): 요약 타일 → 시장 국면 → 보유 경고 → 🎯 지금 사기 좋은 종목 → 대기 → 익절 → 선행 관찰 → 눌림 대기 */
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
  const evalDates = [lastKR.data?.date, lastUS.data?.date].filter((d): d is string => !!d);
  const [items, axes, st, ee] = await Promise.all([
    sb.from("queue_items").select("date,entity_id,queue,reason,first_seen").eq("date", date).range(0, 499),
    sb.from("axes_daily").select("entity_id,evidence").eq("date", date).range(0, 1999),
    lastStats.data ? sb.from("perf_stats").select("scope,dimension,bucket,horizon_days,n,median_excess,hit_rate").eq("as_of", lastStats.data.as_of).eq("horizon_days", R.feedback.primary_horizon).in("scope", ["buy", R.pick_policy.scope]).range(0, 4999) : Promise.resolve({ data: [] }),
    evalDates.length ? sb.from("entry_eval").select("date,market,level").in("date", evalDates).in("level", ["green", "yellow"]).range(0, 999) : Promise.resolve({ data: [] }),
  ]);
  const q = (items.data ?? []) as QItem[];
  const evBy = new Map(((axes.data ?? []) as { entity_id: string; evidence: AxesEvidence }[]).map((a) => [a.entity_id, a.evidence]));
  const ids = [...new Set([...q.map((x) => x.entity_id), ...(alerts.data ?? []).map((a) => a.entity_id).filter(Boolean)])] as string[];
  const ents = ids.length ? await sb.from("entities").select("id,market,symbol,name,primary_l1,l1_codes,snowball_asset_id,hermes_analysis_id,naver_us_code").in("id", ids) : { data: [] };
  const byId = new Map(((ents.data ?? []) as Ent[]).map((e) => [e.id, e]));
  const ctx = { links: linksConfig(), taxonomy: taxonomyConfig(), jarvisUrl: env().JARVIS_URL };
  const r = reg.data?.value as { risk_off?: boolean; reasons?: string[]; vix?: number | null; snowball?: number | null; at?: string } | undefined;
  const policy = ((pol.data?.value as { policy?: Policy } | undefined)?.policy) ?? null;
  const entryRows = ((ee.data ?? []) as { date: string; market: string; level: string }[]).filter((x) => (x.market === "KR" ? x.date === lastKR.data?.date : x.date === lastUS.data?.date));
  const hist = recHistory((notes.data ?? []) as BriefNote[], (c) => (byId.has(`KR:${c}`) ? `KR:${c}` : byId.has(`US:${c}`) ? `US:${c}` : null));

  // 🎯 후보 평가 — 브리핑과 같은 함수(assess · rankBuy)
  const today = kstDate();
  const cands = q.filter((x) => x.queue === "buy" && byId.has(x.entity_id)).map((x) => {
    const e = byId.get(x.entity_id)!;
    const ev = evBy.get(x.entity_id) ?? {};
    const p = (x.reason as { p?: number | null }).p ?? null;
    const a = assess({ ev, p, market: e.market, l1: e.primary_l1 ?? null, riskOff: r?.risk_off === true, today }, R, policy, (st.data ?? []) as PerfStat[]);
    return { ...x, e, ev, a, p, families: ev.families?.length ?? 0, industryGrowth: ev.idea?.industry?.realized_median ?? null, nextEvent: ev.next_event ?? null, perf: a.prior.score, timing: a.timing.score };
  });
  const good = cands.filter((c) => c.a.admit.ok);
  const top = [...rankBuy(good.filter((c) => c.e.market === "KR"), good.length), ...rankBuy(good.filter((c) => c.e.market === "US"), good.length)];
  const waiting = cands.filter((c) => !c.a.admit.ok).sort((x, y) => y.a.timing.score - x.a.timing.score);

  // 보유 경고: 종목별로 묶어서
  const alertBy = new Map<string, { name: string; lines: { summary: string; source: string; when: string }[] }>();
  for (const a of alerts.data ?? []) {
    const p = a.payload as { name?: string; summary?: string; source?: string; bootstrap?: boolean; asset_id?: string };
    const k = a.entity_id ?? p.asset_id ?? p.name ?? "-";
    const cur = alertBy.get(k) ?? alertBy.set(k, { name: p.name ?? k, lines: [] }).get(k)!;
    cur.lines.push({ summary: p.summary ?? "", source: p.source ?? "", when: a.sent_at ? `알림 ${kstString(new Date(a.sent_at))}` : p.bootstrap ? "처음 실행 때 기록(알림 안 보냄)" : "미발송" });
  }
  const o = policy?.overall;

  return (
    <Page>
      <Nav />

      <div className="flex flex-wrap gap-3">
        <Stat icon={r?.risk_off ? "🔴" : "🟢"} label="시장 국면" value={r ? (r.risk_off ? "위험 회피" : "정상") : "계산 전"} tone={r?.risk_off ? "hot" : "good"} sub={`변동성지수 ${r?.vix?.toFixed(1) ?? "-"}`} />
        <Stat icon="⚠️" label="보유 경고 (7일)" value={alertBy.size} tone={alertBy.size ? "hot" : "good"} />
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
      </div>

      <Section title={`📊 주요 지표 (최근 ${DC.lookback_months}개월)`}>
        <div className="glass rounded-xl p-4 space-y-2">
          <p className="font-bold whitespace-nowrap">🌏 지수 흐름 <span className="text-sm font-normal text-sub">기간 첫날 = 100</span></p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">{mc.lines.map((l) => <span key={l.key} className="whitespace-nowrap"><span style={{ color: l.color }}>●</span> {l.label} <Pct v={l.ret} /></span>)}</div>
          {mc.indices.length ? <IndexChart data={mc.indices} lines={mc.lines} /> : <Empty text="시세 자료를 불러오지 못했습니다." />}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="glass rounded-xl p-4 space-y-1">
            <p className="font-bold whitespace-nowrap">😱 공포·탐욕 지수 {fgNow && <span className="ml-1 text-gold">{fgNow.value} · {fgNow.rating}</span>}</p>
            <p className="text-xs text-sub whitespace-nowrap">0 극단적 공포 · 50 중립 · 100 극단적 탐욕 (CNN)</p>
            {mc.fg.length ? <FearGreedChart data={mc.fg} bands={DC.fear_greed.bands} /> : <Empty text="공포·탐욕 지수를 불러오지 못했습니다." />}
          </div>
          <div className="glass rounded-xl p-4 space-y-1">
            <p className="font-bold whitespace-nowrap">🌪️ {DC.vix.label} {vixNow && <span className={`ml-1 ${vixNow.value >= DC.vix.fear_above ? "text-hot" : vixNow.value < DC.vix.calm_below ? "text-good" : "text-gold"}`}>{vixNow.value.toFixed(1)}</span>}</p>
            <p className="text-xs text-sub whitespace-nowrap">{DC.vix.calm_below} 아래 안정 · {DC.vix.fear_above} 위 공포</p>
            {mc.vix.length ? <VixChart data={mc.vix} calm={DC.vix.calm_below} fear={DC.vix.fear_above} /> : <Empty text="변동성지수를 불러오지 못했습니다." />}
          </div>
        </div>
      </Section>

      <Section title="⚠️ 보유 경고 (최근 7일)" count={alertBy.size}>
        <Guide items={[<>📉 고점 대비 <b className="text-hot">−20% 이하 하락</b></>, <>⚖️ <b className="text-hot">허용 비중 초과</b></>, "💔 투자 논지를 깨는 이벤트 · 등급 하락"]}>보유 종목의 위험 신호를 종목별로 묶었습니다.</Guide>
        {alertBy.size === 0 ? <Empty text="없음 — 보유 종목에 새 위험 신호가 없습니다." /> : [...alertBy.entries()].map(([k, v]) => (
          <Card key={k} tone="warn">
            <p className="text-base font-bold">{byId.has(k) ? <a href={`/stock/${encodeURIComponent(k)}`} className="link">{v.name}</a> : v.name}</p>
            <ul className="space-y-1">{v.lines.map((l, i) => <li key={i}>🔸 <Bad>{l.summary}</Bad> <span className="text-xs text-sub">— {l.source} · {l.when}</span></li>)}</ul>
            <p className="text-sm">👉 할 일: <Hi>투자 논지 다시 보기 → SnowBall에 결정 기록</Hi></p>
          </Card>
        ))}
      </Section>

      <Section title="🎯 지금 사기 좋은 종목" count={top.length}>
        <Guide items={[
          <>🏢 <b className="text-white">좋은 기업</b> = 실적 · 산업 · 신호 합의 (매수 검토 후보)</>,
          <>⏱️ <b className="text-gold">지금 사기 좋은가</b> = 가격 · 추세 · 수급 · 과열</>,
          <>⏸️ 대기이거나 사후 검증에서 승률 낮은 기준에 걸리면 제외</>,
          <>📨 시장별 상위 {R.pick_policy.top_max}개가 텔레그램 추천</>,
        ]} />
        {policy?.exclude.length ? <p className="text-sm">📐 사후 검증으로 빠진 기준: {policy.exclude.map((x) => <span key={x.title} className="mr-2 rounded-full border border-hot/50 bg-hot/10 px-2 py-0.5 text-hot">{x.title}</span>)}</p> : null}
        {top.length === 0 ? <Empty text={cands.length ? `오늘은 지금 사기 좋은 종목이 없습니다 — 후보 ${cands.length}개 모두 타이밍 대기.` : "매수 검토 후보가 없습니다."} /> : top.map((c) => {
          const rank = (c.e.market === "KR" ? top.filter((x) => x.e.market === "KR") : top.filter((x) => x.e.market === "US")).indexOf(c) + 1;
          return <IdeaView key={c.entity_id} c={c} rank={rank} hist={hist.get(c.entity_id)} ctx={ctx} telegram={rank <= R.pick_policy.top_max} />;
        })}
      </Section>

      <Section title="⏸️ 좋은 기업이지만 지금은 대기" count={waiting.length}>
        <Guide items={["실적 · 산업은 좋지만 지금 가격 · 추세 · 수급이 별로", "점수가 오르면 위 목록으로 올라옴"]} />
        {waiting.length === 0 ? <Empty text="없음" /> : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {waiting.map((c) => (
              <li key={c.entity_id} className="glass rounded-lg px-3 py-2 text-sm">
                <a href={`/stock/${encodeURIComponent(c.entity_id)}`} className="font-semibold link">{c.e.market === "US" ? "🇺🇸" : "🇰🇷"} {c.e.name}</a>
                <span className="ml-2 text-warn font-semibold">{VERDICT_SHORT[c.a.timing.verdict]} {c.a.timing.score > 0 ? "+" : ""}{c.a.timing.score}</span>
                <div className="text-xs text-sub">{[c.a.admit.why.join(" · "), issues(c.a.timing)].filter(Boolean).join(" — ")}</div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {SECTIONS.map((s) => <QueueSection key={s.queue} {...s} q={q} byId={byId} evBy={evBy} ctx={ctx} />)}

      <Section title="🚦 진입 신호 · 관찰 · 실적 돌파">
        <Guide items={["🟢 진입 신호 = 필수 조건 5개 모두 충족", "🟡 관찰 · 🔵 실적 돌파도 함께", <a key="e" className="link" href="/entry">🚦 진입 보드에서 보기 →</a>]} />
      </Section>
      <Footer asOf={`${date} 판정 · 시장 국면 ${r?.at ? kstString(new Date(r.at)) : "-"}`} />
    </Page>
  );
}

type Cand = { entity_id: string; e: Ent; ev: AxesEvidence; a: Assessed; p: number | null };

/** 🎯 카드 — 이름 → 추천 이력 → 지금 매수 매력 → 아이디어 → 🏢 | ⏱️ → 이벤트·리스크 → 링크 */
function IdeaView({ c, rank, hist, ctx, telegram }: { c: Cand; rank: number; hist: RecHist | undefined; ctx: Ctx; telegram: boolean }) {
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
          {card.history && <p className="text-sm text-arc mt-0.5">{card.history}{hist ? " (최근 추천가 기준)" : ""}</p>}
          {telegram && <p className="text-xs text-good mt-0.5">📨 텔레그램 추천 대상 (시장별 상위)</p>}
        </div>
        <span className={`rounded-full border px-3 py-1 text-sm font-bold ${vc}`}>{card.verdict}</span>
      </div>
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

function QueueSection({ queue, title, about, q, byId, evBy, ctx }: {
  queue: Queue; title: string; about: string[]; q: QItem[]; byId: Map<string, Ent>; evBy: Map<string, AxesEvidence>; ctx: Ctx;
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
            {e && <LinkRow links={stockLinks(e, ctx)} />}
          </Card>
        );
      })}
    </Section>
  );
}
