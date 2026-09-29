import { notFound } from "next/navigation";
import { Card, Empty, Footer, Guide, LinkRow, Nav, Section } from "@/app/_components/ui";
import { linksConfig, taxonomyConfig } from "@/lib/config/load";
import { explain, pLevel, type AxesEvidence } from "@/lib/engine/explain";
import type { Queue } from "@/lib/engine/queues";
import { env } from "@/lib/env";
import { fmtPct } from "@/lib/format";
import { BASIS_NAME, direction, SIGNAL_NAME, yesNo } from "@/lib/labels";
import { stockLinks, type LinkEntity } from "@/lib/links";
import { supabaseServer } from "@/lib/supabase/server";
import { kstDate, kstString } from "@/lib/time";
import { submitToSnowball } from "./actions";

export const dynamic = "force-dynamic";

const QUEUE_NAME: Record<Queue, string> = { holding_alert: "⚠️ 보유 경고", take_profit: "💰 익절 검토", buy: "🎯 매수 검토", radar: "🔭 선행 관찰", pullback_wait: "⏳ 눌림 대기" };
const CLASS: Record<string, string> = { stock: "주식", etf: "ETF", fund: "펀드" };

/** 종목 한눈에 보기 (PRD §8): 판단 요약 · 산업 고성장 · 6개월 이벤트 · 신호 기록 · 링크 · SnowBall 보내기 */
export default async function StockPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const entityId = decodeURIComponent(id);
  const sb = await supabaseServer();
  const { data } = await sb.from("entities").select("id,market,symbol,name,aliases,primary_l1,l1_codes,l1_basis,asset_class,snowball_asset_id,hermes_analysis_id,naver_us_code,updated_at").eq("id", entityId).maybeSingle();
  if (!data) notFound();
  const e = data as LinkEntity & { aliases: string[]; l1_codes: string[]; l1_basis: string | null; asset_class: string; updated_at: string };
  const tx = taxonomyConfig();
  const l1Name = (c: string) => tx.l1.find((r) => r.code === c)?.name ?? c;
  const today = kstDate();
  const until = kstDate(new Date(Date.now() + 180 * 86400_000));
  const l1List = `(${e.l1_codes.map((c) => `"${c}"`).join(",") || '""'})`;

  const [axes, sigE, sigL, heatD, evE, evL, queues] = await Promise.all([
    sb.from("axes_daily").select("date,n_on,c_on,f_on,p_value,h_held,evidence").eq("entity_id", entityId).order("date", { ascending: false }).limit(1).maybeSingle(),
    sb.from("signals").select("kind,source,direction,strength,observed_at,evidence").eq("entity_id", entityId).order("observed_at", { ascending: false }).range(0, 29),
    sb.from("signals").select("kind,source,direction,strength,observed_at,evidence,l1_codes").is("entity_id", null).overlaps("l1_codes", e.l1_codes).order("observed_at", { ascending: false }).range(0, 19),
    sb.from("industry_heat").select("date").order("date", { ascending: false }).limit(1).maybeSingle(),
    sb.from("catalyst_events").select("title,date,window_end,source,url,direction").eq("entity_id", entityId).eq("direction", "up").or(`date.gte.${today},window_end.gte.${today}`).range(0, 49),
    sb.from("catalyst_events").select("title,date,window_end,source,url,l1").eq("scope", "industry").filter("l1", "in", l1List).or(`date.gte.${today},window_end.gte.${today}`).range(0, 29),
    sb.from("queue_items").select("date,queue,reason").eq("entity_id", entityId).order("date", { ascending: false }).range(0, 13),
  ]);
  const heat = heatD.data ? await sb.from("industry_heat").select("l1,m3_pass,m3_median_rev_yoy_q0,m3_median_rev_yoy_q1,m3_members,m3_basis").eq("date", heatD.data.date).filter("l1", "in", l1List) : { data: [] };
  const a = axes.data as { date: string; n_on: boolean; c_on: boolean; f_on: boolean; p_value: number | null; h_held: boolean; evidence: AxesEvidence } | null;
  const qs = (queues.data ?? []) as { date: string; queue: Queue; reason: { p?: number | null; days_to_earnings?: number; heat?: number } }[];
  const cur = qs[0] && a && qs[0].date === a.date ? qs[0] : null;
  const ex = cur && a ? explain({ queue: cur.queue, market: e.market, evidence: a.evidence, p: cur.reason.p ?? a.p_value, daysToEarnings: cur.reason.days_to_earnings ?? null, heat: cur.reason.heat ?? null }) : null;
  const when = (x: { date: string | null; window_end: string | null }) => x.date ?? x.window_end ?? "";
  const events = [...((evE.data ?? []) as { title: string; date: string | null; window_end: string | null; source: string }[]), ...((evL.data ?? []) as never[])]
    .filter((x) => when(x) >= today && when(x) <= until).sort((x, y) => when(x).localeCompare(when(y)));
  const signals = [...(sigE.data ?? []), ...(sigL.data ?? [])].sort((x, y) => String(y.observed_at).localeCompare(String(x.observed_at)));
  const links = stockLinks(e, { links: linksConfig(), taxonomy: tx, jarvisUrl: env().JARVIS_URL });

  return (
    <main className="mx-auto max-w-3xl p-4 space-y-6">
      <Nav />
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{e.market === "KR" ? "🇰🇷" : "🇺🇸"} {e.name} <span className="text-base font-normal text-neutral-500">{e.symbol}</span></h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">산업: {e.l1_codes.map(l1Name).join(" + ")} <span className="text-xs text-neutral-500">(분류 근거: {BASIS_NAME[e.l1_basis ?? "none"] ?? e.l1_basis})</span> · {CLASS[e.asset_class] ?? e.asset_class}{e.snowball_asset_id ? " · SnowBall에 보유 또는 관심 등록" : ""}</p>
        {e.aliases.length > 0 && <p className="text-xs text-neutral-500">다른 이름: {e.aliases.join(", ")}</p>}
        <LinkRow links={links} />
      </header>

      <Section title="판단 요약">
        {ex && cur ? (
          <Card tone={cur.queue === "holding_alert" ? "warn" : "good"}>
            <p className="font-medium">{QUEUE_NAME[cur.queue]}</p>
            <p><b>결론</b> {ex.conclusion}</p>
            <ul className="list-disc pl-5">{ex.reasons.map((t, i) => <li key={i}>{t}</li>)}</ul>
          </Card>
        ) : <Guide>오늘은 어떤 행동 목록(매수 검토·선행 관찰 등)에도 들지 않았습니다.</Guide>}
        {a ? (
          <table className="text-sm">
            <tbody>
              <tr><td className="pr-4 text-neutral-500">산업·종목 이야기</td><td>{yesNo(a.n_on)} <span className="text-xs text-neutral-500">FlyWheel 산업 흐름·위키 언급, Sage 멘토 합의</span></td></tr>
              <tr><td className="pr-4 text-neutral-500">실적 촉매</td><td>{yesNo(a.c_on)} <span className="text-xs text-neutral-500">HermesCall 미국 실적 수혜·가이던스</span></td></tr>
              <tr><td className="pr-4 text-neutral-500">실적 숫자</td><td>{yesNo(a.f_on)} <span className="text-xs text-neutral-500">Heimdallr 게이트·점수(미국은 성장 가속·이익률 개선)</span></td></tr>
              <tr><td className="pr-4 text-neutral-500">주가 반영도</td><td>{a.p_value !== null ? `${Math.round(a.p_value)}/100 (${pLevel(a.p_value)})` : "계산 전"}</td></tr>
              <tr><td className="pr-4 text-neutral-500">보유</td><td>{a.h_held ? "보유 중" : "보유 안 함"}</td></tr>
            </tbody>
          </table>
        ) : <Empty text="아직 평가되지 않았습니다(종목 신호나 보유가 있을 때 평가)." />}
        {qs.length > 0 && <p className="text-xs text-neutral-500">최근 목록 이력: {qs.map((q) => `${q.date.slice(5)} ${QUEUE_NAME[q.queue]}`).join(" · ")}</p>}
      </Section>

      <Section title="산업 고성장 여부">
        <Guide>세 근거 중 하나라도 15% 이상이면 고성장입니다(자세한 원문은 “산업 성장 근거” 화면).</Guide>
        {((heat.data ?? []) as { l1: string; m3_pass: boolean | null; m3_median_rev_yoy_q0: number | null; m3_median_rev_yoy_q1: number | null; m3_members: number | null; m3_basis: { bases?: Record<string, boolean>; us_major_broker?: { detail: { broker: string; value: number; published: string }[] } | null; outlook?: { source: string; cagr: number }[] } }[]).map((h) => (
          <Card key={h.l1} tone={h.m3_pass ? "good" : "muted"}>
            <p className="font-medium">{h.m3_pass ? "✅ 고성장" : "— 근거 부족"} · {l1Name(h.l1)}</p>
            <p>① 실제 실적 {yesNo(h.m3_basis?.bases?.realized)} 매출 전년 대비 중앙값 최근 {fmtPct(h.m3_median_rev_yoy_q0)} · 직전 {fmtPct(h.m3_median_rev_yoy_q1)} (기업 {h.m3_members ?? 0}개)</p>
            <p>② 미국 대형 증권사 전망 {yesNo(h.m3_basis?.bases?.us_major_broker)} {(h.m3_basis?.us_major_broker?.detail ?? []).map((d) => `${d.broker} 연평균 ${d.value}% (${d.published} 발표)`).join(", ") || "자료 없음"}</p>
            <p>③ 시장조사·기업 전망 {yesNo(h.m3_basis?.bases?.outlook)} {(h.m3_basis?.outlook ?? []).map((o) => `${o.source} 연평균 ${o.cagr}%`).join(", ") || "자료 없음"}</p>
          </Card>
        ))}
      </Section>

      <Section title="앞으로 6개월 안의 상승 이벤트" count={events.length}>
        <Guide>SnowBall 트리거·HermesCall 분석·Heimdallr 분석·실적 일정(컨센서스 상향)·수동 일정에서 모은 이벤트입니다. “~날짜”는 그 날짜까지의 기간을 뜻합니다.</Guide>
        {events.length === 0 ? <Empty text="없음" /> : (
          <ul className="text-sm list-disc pl-5 space-y-0.5">{events.slice(0, 12).map((x, i) => <li key={i}>{x.date ?? `~${x.window_end}`} · {x.title} <span className="text-xs text-neutral-500">({x.source})</span></li>)}</ul>
        )}
      </Section>

      <Section title="최근 신호 기록" count={signals.length}>
        {signals.length === 0 ? <Empty text="없음" /> : (
          <ul className="text-sm space-y-0.5">
            {signals.slice(0, 30).map((s, i) => (
              <li key={i}>{String(s.observed_at).slice(0, 10)} · {SIGNAL_NAME[s.kind as string] ?? s.kind} · {direction(s.direction as number)} · 강도 {s.strength}/10
                {"l1_codes" in s && (s.l1_codes as string[])?.length ? <span className="text-xs text-neutral-500"> ({(s.l1_codes as string[]).map(l1Name).join(", ")} 산업 전체)</span> : null}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="SnowBall로 보내기">
        <Guide>이 종목을 SnowBall 아이디어 초안으로 보냅니다(매수·논지 입력은 SnowBall에서).</Guide>
        <form action={submitToSnowball}>
          <input type="hidden" name="entity_id" value={e.id} />
          <button className="rounded border border-neutral-400 px-3 py-1 text-sm">SnowBall 아이디어 초안으로 보내기</button>
        </form>
        {sp.submitted && <p className="text-sm">{sp.submitted === "ok" ? "✅ SnowBall 아이디어 초안으로 보냈습니다." : `❌ ${sp.submitted}`}</p>}
      </Section>
      <Footer asOf={kstString(new Date(e.updated_at))} />
    </main>
  );
}
