import { Card, Empty, Footer, Guide, LinkRow, Nav, Section } from "@/app/_components/ui";
import { linksConfig, taxonomyConfig } from "@/lib/config/load";
import type { Conds, Tag } from "@/lib/engine/entry";
import { condLines, INVALIDATION_BASIS, priceText, TAG_NAME } from "@/lib/engine/entry-view";
import { env } from "@/lib/env";
import { stockLinks, type LinkEntity } from "@/lib/links";
import { supabaseServer } from "@/lib/supabase/server";
import { kstString } from "@/lib/time";

export const dynamic = "force-dynamic";

type Ev = Record<"m1" | "m2" | "m3" | "m4" | "m5", { pass: boolean; reason: string | null; detail?: Record<string, unknown> | null; lines?: string[]; events?: { when: string; title: string; source: string }[] }> & { source_date?: string; p?: number | null; missing?: string[]; breakout?: { source: string; d0: string } | null; held?: boolean };
type Row = { date: string; entity_id: string; market: "KR" | "US"; level: "green" | "yellow" | "none"; tag: Tag | null; invalidation_price: number | null; first_weight_pct: number | null; gate_result: { allowed?: boolean; reasons?: string[]; sent?: boolean; note?: string }; evidence: Ev; created_at: string };
type Ent = LinkEntity & { id: string; name: string; symbol: string; market: "KR" | "US" };
type Blue = { entity_id: string; source: string; d0: string; d0_low: number | null; armed_until: string; promoted_at: string | null };

const MARKET = { KR: "🇰🇷 국내", US: "🇺🇸 미국" } as const;

/** 진입 보드 (PRD §8 /entry) — 🟢·🟡·🔵. 보기 전용, DB 만 읽는다 */
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
  const es = ids.length ? await sb.from("entities").select("id,market,symbol,name,primary_l1,snowball_asset_id,hermes_analysis_id,naver_us_code").in("id", ids) : { data: [] };
  const E = new Map(((es.data ?? []) as Ent[]).map((e) => [e.id, e]));
  const ctx = { links: linksConfig(), taxonomy: taxonomyConfig(), jarvisUrl: env().JARVIS_URL };
  const name = (id: string) => E.get(id)?.name ?? id;
  const greens = rows.filter((r) => r.level === "green"), yellows = rows.filter((r) => r.level === "yellow");

  const card = (r: Row) => {
    const e = E.get(r.entity_id);
    const c = r.evidence as unknown as Conds;
    const lines = condLines(c, { m1: r.evidence.m1.detail, m2: r.evidence.m2.detail, m5: r.evidence.m5.detail, m3_lines: r.evidence.m3.lines, m4_events: r.evidence.m4.events });
    return (
      <Card key={`${r.date}|${r.entity_id}`} tone={r.level === "green" ? "good" : undefined}>
        <div className="font-medium">{r.level === "green" ? "🟢" : "🟡"} {MARKET[r.market]} · {name(r.entity_id)} <span className="text-neutral-500">({e?.symbol ?? r.entity_id})</span>{r.tag ? ` · ${TAG_NAME[r.tag]}` : ""}{r.evidence.held ? " · 보유 중" : ""}</div>
        <ul className="text-xs space-y-0.5">{lines.map((l) => <li key={l}>{l}</li>)}</ul>
        <div className="text-xs">
          무효화: 종가 &lt; {priceText(r.invalidation_price, r.market)}{r.tag ? ` (${INVALIDATION_BASIS[r.tag]})` : ""} · 1차 비중 {r.first_weight_pct === null ? "SnowBall 허용 비중의 1/3" : `${r.first_weight_pct.toFixed(1)}%`} · 주가 반영도 {r.evidence.p == null ? "-" : Math.round(r.evidence.p)}
        </div>
        {r.level === "green" && <div className="text-xs text-neutral-500">{r.gate_result.sent ? "텔레그램 발송함" : r.gate_result.note ?? "발송 대기"}</div>}
        {r.level === "yellow" && r.gate_result.reasons?.length ? <div className="text-xs text-neutral-500">게이트: {r.gate_result.reasons.join(" · ")}</div> : null}
        <div className="text-xs text-neutral-500">원천 계산일 {r.evidence.source_date ?? "-"} · 판정 {kstString(new Date(r.created_at))}</div>
        {e && <LinkRow links={stockLinks(e, ctx)} />}
      </Card>
    );
  };

  return (
    <main className="mx-auto max-w-6xl p-4 space-y-6">
      <Nav />
      <Guide>필수 조건 5개(① 실적 증가·가속·주가 미반영 ② MACD 상향 교차 직전 ③ 산업 고성장 ④ 6개월 내 상승 이벤트 ⑤ 매수 수급 2일 연속)를 모두 충족하고 게이트(주가 반영도·시장 국면·허용 비중)를 통과해야 🟢입니다. 매수 확정 신호가 아닙니다 — 최종 판단·입력은 SnowBall에서.</Guide>
      <Section title="🟢 진입 신호" count={greens.length}>
        {greens.length ? greens.map(card) : <Empty text={`오늘 조건을 모두 충족한 종목이 없습니다 (국내 ${lastKR.data?.date ?? "-"} · 미국 ${lastUS.data?.date ?? "-"} 평가).`} />}
      </Section>
      <Section title="🟡 관찰 — ①② 충족 + ③④⑤ 중 2개 이상" count={yellows.length}>
        {yellows.length ? yellows.map(card) : <Empty text="관찰 종목이 없습니다." />}
      </Section>
      <Section title="🔵 실적 돌파 관찰 (진입 신호 아님 · 60거래일 무장)" count={blues.length}>
        {blues.length ? (
          <ul className="text-sm space-y-1">
            {blues.map((b) => <li key={`${b.entity_id}|${b.d0}`}>{name(b.entity_id)} · {b.source === "K1" ? "국내 잠정실적" : "미국 실적"} 돌파 {b.d0} · 돌파일 저가 {priceText(b.d0_low, b.entity_id.startsWith("US:") ? "US" : "KR")} · {b.armed_until}까지{b.promoted_at ? " · 🟢 승격됨" : ""}</li>)}
          </ul>
        ) : <Empty text="무장 중인 실적 돌파가 없습니다." />}
      </Section>
      <Section title="지난 🟢 (최근 50건)" count={past.length}>
        {past.length ? (
          <ul className="text-sm space-y-1">{past.map((r) => <li key={`${r.date}|${r.entity_id}`}>{r.date} · {name(r.entity_id)} · {r.tag ? TAG_NAME[r.tag] : "-"} · 무효화 {priceText(r.invalidation_price, r.market)}</li>)}</ul>
        ) : <Empty text="아직 없습니다. 성과는 신호 성적표에서 봅니다." />}
      </Section>
      <Footer asOf={kstString()} />
    </main>
  );
}
