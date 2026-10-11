import { PickChart } from "@/app/_components/charts";
import { Card, Empty, Footer, Guide, Hi, LinkRow, Nav, Page, Section } from "@/app/_components/ui";
import { linksConfig, taxonomyConfig } from "@/lib/config/load";
import { dashboardConfig, stockCharts } from "@/lib/dashboard/data";
import type { Conds, Tag } from "@/lib/engine/entry";
import { COND_NAME, INVALIDATION_BASIS, m1Text, m2Text, m5Text, priceText, TAG_NAME } from "@/lib/engine/entry-view";
import type { PickPoint } from "@/lib/engine/series";
import { env } from "@/lib/env";
import { stockLinks, type LinkEntity } from "@/lib/links";
import { supabaseServer } from "@/lib/supabase/server";
import { kstString } from "@/lib/time";

export const dynamic = "force-dynamic";

type C = { pass: boolean; reason: string | null; detail?: Record<string, unknown> | null; lines?: string[]; events?: { when: string; title: string; source: string }[] };
type Ev = Record<"m1" | "m2" | "m3" | "m4" | "m5", C> & { source_date?: string; p?: number | null; missing?: string[]; breakout?: { source: string; d0: string } | null; held?: boolean };
type Row = { date: string; entity_id: string; market: "KR" | "US"; level: "green" | "yellow" | "none"; tag: Tag | null; invalidation_price: number | null; first_weight_pct: number | null; gate_result: { allowed?: boolean; reasons?: string[]; sent?: boolean; note?: string }; evidence: Ev; created_at: string };
type Ent = LinkEntity & { id: string; name: string; symbol: string; market: "KR" | "US" };
type Blue = { entity_id: string; source: string; d0: string; d0_low: number | null; armed_until: string; promoted_at: string | null };
type Charts = Map<string, { points: PickPoint[]; op_label: string }>;

const MARKET = { KR: "🇰🇷", US: "🇺🇸" } as const;
const ICON: Record<keyof Conds, string> = { m1: "📊", m2: "〽️", m3: "🌱", m4: "📅", m5: "🤝" };
const KEYS = ["m1", "m2", "m3", "m4", "m5"] as const;

/** 조건 하나 → 제목 줄 + 근거 줄들(한 줄에 한 가지) */
function condDetail(k: (typeof KEYS)[number], c: C): string[] {
  if (!c.pass) return c.reason ? [c.reason] : [];
  if (k === "m3") return c.lines ?? [];
  if (k === "m4") return (c.events ?? []).slice(0, 4).map((e) => `${e.when} ${e.title} (${e.source})`);
  const t = k === "m1" ? m1Text(c.detail) : k === "m2" ? m2Text(c.detail) : m5Text(c.detail);
  return t ? t.split(" · ") : [];
}

function Conditions({ ev }: { ev: Ev }) {
  return (
    <ul className="grid gap-2 lg:grid-cols-2">
      {KEYS.map((k) => {
        const c = ev[k];
        const lines = condDetail(k, c);
        return (
          <li key={k} className={`rounded-lg border-l-4 ${c.pass ? "border-l-good bg-good/5" : "border-l-hot bg-hot/5"} px-3 py-2`}>
            <p className="one-line font-bold">{c.pass ? "✅" : "❌"} {ICON[k]} {COND_NAME[k]}</p>
            {lines.length > 0 && <ul className="mt-1 space-y-0.5 text-sm">{lines.map((l, i) => <li key={i} className={c.pass ? "" : "text-sub"}>{k === "m4" && c.pass ? "🗓️" : "▪️"} {l}</li>)}</ul>}
          </li>
        );
      })}
    </ul>
  );
}

function ChartBox({ id, market, charts }: { id: string; market: "KR" | "US"; charts: Charts }) {
  const c = charts.get(id);
  const DC = dashboardConfig();
  return (
    <details open className="rounded-lg bg-panel2/50 px-3 py-2">
      <summary className="cursor-pointer text-arc text-sm whitespace-nowrap">📉 최근 {DC.pick_chart.months}개월 · 주가 · {DC.pick_chart.ma.join("·")}일선 · MACD · RSI</summary>
      {c?.points.length ? <PickChart id={id} data={c.points} ma={DC.pick_chart.ma} opLabel={c.op_label} overbought={DC.entry_chart.rsi_overbought} oversold={DC.entry_chart.rsi_oversold} currency={market === "KR" ? "KRW" : "USD"} rec={null} />
        : <p className="text-sm text-sub mt-2">시세 자료를 불러오지 못했습니다.</p>}
    </details>
  );
}

/** 🚦 진입 보드 (PRD §8 /entry) — 🟢·🟡·🔵. 보기 전용, 판정은 DB(entry_eval) 값 그대로 */
export default async function Entry() {
  const sb = await supabaseServer();
  const lastKR = await sb.from("entry_eval").select("date").eq("market", "KR").order("date", { ascending: false }).limit(1).maybeSingle();
  const lastUS = await sb.from("entry_eval").select("date").eq("market", "US").order("date", { ascending: false }).limit(1).maybeSingle();
  const dates = [lastKR.data?.date, lastUS.data?.date].filter((d): d is string => !!d);
  const [ev, bw, recent] = await Promise.all([
    dates.length ? sb.from("entry_eval").select("date,entity_id,market,level,tag,invalidation_price,first_weight_pct,gate_result,evidence,created_at").in("date", dates).in("level", ["green", "yellow"]).range(0, 499) : Promise.resolve({ data: [] }),
    sb.from("breakout_watch").select("entity_id,source,d0,d0_low,armed_until,promoted_at").gte("armed_until", new Date().toISOString().slice(0, 10)).order("d0", { ascending: false }).range(0, 199),
    sb.from("entry_eval").select("date,entity_id,market,level,tag,invalidation_price").eq("level", "green").order("date", { ascending: false }).range(0, 49),
  ]);
  const rows = ((ev.data ?? []) as Row[]).filter((r) => (r.market === "KR" ? r.date === lastKR.data?.date : r.date === lastUS.data?.date));
  const blues = (bw.data ?? []) as Blue[];
  const past = ((recent.data ?? []) as Row[]).filter((r) => !rows.some((x) => x.entity_id === r.entity_id && x.date === r.date));
  const ids = [...new Set([...rows, ...blues, ...past].map((r) => r.entity_id))];
  const [es, charts] = await Promise.all([
    ids.length ? sb.from("entities").select("id,market,symbol,name,primary_l1,snowball_asset_id,hermes_analysis_id,naver_us_code").in("id", ids) : Promise.resolve({ data: [] }),
    stockCharts([...new Set([...rows, ...blues].map((r) => r.entity_id))]),
  ]);
  const E = new Map(((es.data ?? []) as Ent[]).map((e) => [e.id, e]));
  const ctx = { links: linksConfig(), taxonomy: taxonomyConfig(), jarvisUrl: env().JARVIS_URL };
  const name = (id: string) => E.get(id)?.name ?? id;
  const greens = rows.filter((r) => r.level === "green"), yellows = rows.filter((r) => r.level === "yellow");

  const card = (r: Row) => {
    const e = E.get(r.entity_id);
    const passed = KEYS.filter((k) => r.evidence[k].pass).length;
    return (
      <Card key={`${r.date}|${r.entity_id}`} tone={r.level === "green" ? "good" : "gold"}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="one-line text-lg font-bold">{r.level === "green" ? "🟢" : "🟡"} {MARKET[r.market]} <a href={`/stock/${encodeURIComponent(r.entity_id)}`} className="hover:text-arc">{name(r.entity_id)}</a> <span className="text-sm font-normal text-sub">{e?.symbol ?? r.entity_id}</span></p>
          <p className="whitespace-nowrap text-sm">필수 조건 <b className={passed === 5 ? "text-good" : "text-gold"}>{passed} / 5</b>{r.tag ? <> · 🏷️ <Hi>{TAG_NAME[r.tag]}</Hi></> : null}{r.evidence.held ? " · 💼 보유 중" : ""}</p>
        </div>
        <Conditions ev={r.evidence} />
        <div className="grid gap-1 sm:grid-cols-3 text-sm">
          <p className="one-line">🛑 무효화 <b className="text-hot">종가 &lt; {priceText(r.invalidation_price, r.market)}</b>{r.tag ? <span className="text-sub"> ({INVALIDATION_BASIS[r.tag]})</span> : null}</p>
          <p className="one-line">⚖️ 1차 비중 <b className="text-gold">{r.first_weight_pct === null ? "허용 비중의 1/3" : `${r.first_weight_pct.toFixed(1)}%`}</b></p>
          <p className="one-line">🎚️ 주가 반영도 <b className="text-white">{r.evidence.p == null ? "-" : Math.round(r.evidence.p)}</b></p>
        </div>
        {r.level === "green" && <p className="text-xs text-sub">📨 {r.gate_result.sent ? "텔레그램 발송함" : r.gate_result.note ?? "발송 대기"}</p>}
        {r.level === "yellow" && r.gate_result.reasons?.length ? <p className="text-xs text-sub">🚧 게이트: {r.gate_result.reasons.join(" · ")}</p> : null}
        <ChartBox id={r.entity_id} market={r.market} charts={charts} />
        <p className="text-xs text-sub">🗂️ 원천 계산일 {r.evidence.source_date ?? "-"} · 판정 {kstString(new Date(r.created_at))}</p>
        {e && <LinkRow links={stockLinks(e, ctx)} />}
      </Card>
    );
  };

  return (
    <Page wide>
      <Nav />
      <Section title="📋 필수 조건 5개">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5 text-sm">
          {[
            ["📊", "① 실적 가속 또는 턴어라운드", "흑자 전환 + 매출 증가도 인정 · 주가는 아직 덜 반영"],
            ["〽️", "② MACD 상향 교차 직전", "하락 힘이 줄며 반등 준비"],
            ["🌱", "③ 산업 고성장", "실적 · 증권사 · 전망 중 15%↑"],
            ["📅", "④ 6개월 내 상승 이벤트", "출처 · 날짜 있는 이벤트"],
            ["🤝", "⑤ 매수 수급 3일 연속", "외국인 또는 기관 순매수"],
          ].map(([i, t, d]) => (
            <div key={t} className="glass rounded-lg px-3 py-2">
              <p className="one-line font-bold">{i} {t}</p>
              <p className="one-line text-xs text-sub">{d}</p>
            </div>
          ))}
        </div>
        <Guide items={["🟢 = 5개 모두 ✅ + 게이트 통과 (주가 반영도 · 시장 국면 · 허용 비중)", "🟡 = ①② ✅ + ③④⑤ 중 2개 이상", <><b className="text-gold">매수 확정 신호가 아닙니다</b> — 최종 판단 · 입력은 SnowBall</>]} />
      </Section>

      <Section title="🟢 진입 신호" count={greens.length}>
        {greens.length ? greens.map(card) : <Empty text={`오늘 조건을 모두 충족한 종목이 없습니다 (국내 ${lastKR.data?.date ?? "-"} · 미국 ${lastUS.data?.date ?? "-"} 평가)`} />}
      </Section>
      <Section title="🟡 관찰 — ①② 충족 + ③④⑤ 중 2개 이상" count={yellows.length}>
        {yellows.length ? yellows.map(card) : <Empty text="관찰 종목이 없습니다." />}
      </Section>
      <Section title="🔵 실적 돌파 관찰 (진입 신호 아님 · 60거래일)" count={blues.length}>
        <Guide items={["실적 발표로 주가가 크게 뛴 종목 — 바로 사지 않고 눌림을 기다림", "이후 필수 조건 5개를 채우면 🟢 '실적 돌파 후 눌림'으로 승격"]} />
        {blues.length ? blues.map((b) => {
          const m = b.entity_id.startsWith("US:") ? "US" : "KR";
          const e = E.get(b.entity_id);
          return (
            <Card key={`${b.entity_id}|${b.d0}`} tone="muted">
              <p className="one-line text-lg font-bold">🔵 {MARKET[m]} <a href={`/stock/${encodeURIComponent(b.entity_id)}`} className="hover:text-arc">{name(b.entity_id)}</a></p>
              <ul className="space-y-0.5 text-sm">
                <li>🚀 {b.source === "K1" ? "국내 잠정실적" : "미국 실적"} 돌파일 <b className="text-gold">{b.d0}</b></li>
                <li>🛑 돌파일 저가 <b className="text-hot">{priceText(b.d0_low, m)}</b> (이 아래면 무효)</li>
                <li>⏳ <b className="text-white">{b.armed_until}</b>까지 관찰{b.promoted_at ? " · 🟢 승격됨" : ""}</li>
              </ul>
              <ChartBox id={b.entity_id} market={m} charts={charts} />
              {e && <LinkRow links={stockLinks(e, ctx)} />}
            </Card>
          );
        }) : <Empty text="관찰 중인 실적 돌파가 없습니다." />}
      </Section>
      <Section title="🗓️ 지난 🟢 (최근 50건)" count={past.length}>
        {past.length ? (
          <ul className="grid gap-1 sm:grid-cols-2 text-sm">{past.map((r) => <li key={`${r.date}|${r.entity_id}`} className="one-line">{r.date} · <b>{name(r.entity_id)}</b> · {r.tag ? TAG_NAME[r.tag] : "-"} · 무효화 {priceText(r.invalidation_price, r.market)}</li>)}</ul>
        ) : <Empty text="아직 없습니다. 성과는 사후 검증 · 신호 성적표에서 봅니다." />}
      </Section>
      <Footer asOf={kstString()} />
    </Page>
  );
}
