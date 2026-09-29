import { notFound } from "next/navigation";
import { Card, Empty, Footer, LinkRow, Nav, Section } from "@/app/_components/ui";
import { linksConfig, taxonomyConfig } from "@/lib/config/load";
import { QUEUE_LABEL, type Queue } from "@/lib/engine/queues";
import { env } from "@/lib/env";
import { fmtPct } from "@/lib/format";
import { stockLinks, type LinkEntity } from "@/lib/links";
import { supabaseServer } from "@/lib/supabase/server";
import { kstDate, kstString } from "@/lib/time";
import { submitToSnowball } from "./actions";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = {
  industry_narrative: "FlyWheel 산업 서사", company_mention_fw: "FlyWheel WiKi 언급", mentor_consensus: "Sage 멘토 컨센서스", earnings_catalyst: "HermesCall 수혜",
  earnings_quality_us: "HermesCall F1~F4", industry_sentiment: "HermesCall 산업 센티먼트", accel_grade: "Heimdallr 등급", price_reflection: "Heimdallr PRI", holding_risk: "SnowBall 경보",
};

/** 종목 통합 (PRD §8): 5개 소스 신호 타임라인 · 축 · M3(L1) · M4 이벤트 · 링크 세트 · SnowBall 아이디어로 보내기. M1~M5 체크리스트는 P3. */
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
    sb.from("signals").select("kind,source,direction,strength,observed_at,expires_at,evidence,source_ref").eq("entity_id", entityId).order("observed_at", { ascending: false }).range(0, 29),
    sb.from("signals").select("kind,source,direction,strength,observed_at,expires_at,evidence,l1_codes").is("entity_id", null).overlaps("l1_codes", e.l1_codes).order("observed_at", { ascending: false }).range(0, 19),
    sb.from("industry_heat").select("date").order("date", { ascending: false }).limit(1).maybeSingle(),
    sb.from("catalyst_events").select("title,date,window_end,source,url,origin,direction").eq("entity_id", entityId).eq("direction", "up").or(`date.gte.${today},window_end.gte.${today}`).range(0, 49),
    sb.from("catalyst_events").select("title,date,window_end,source,url,origin,l1").eq("scope", "industry").filter("l1", "in", l1List).or(`date.gte.${today},window_end.gte.${today}`).range(0, 29),
    sb.from("queue_items").select("date,queue").eq("entity_id", entityId).order("date", { ascending: false }).range(0, 13),
  ]);
  const heat = heatD.data ? await sb.from("industry_heat").select("l1,m3_pass,m3_median_rev_yoy_q0,m3_median_rev_yoy_q1,m3_members,m3_basis").eq("date", heatD.data.date).filter("l1", "in", l1List) : { data: [] };
  const a = axes.data as { date: string; n_on: boolean; c_on: boolean; f_on: boolean; p_value: number | null; h_held: boolean; evidence: Record<string, unknown> } | null;
  const when = (x: { date: string | null; window_end: string | null }) => x.date ?? x.window_end ?? "";
  const events = [...((evE.data ?? []) as { title: string; date: string | null; window_end: string | null; source: string; url: string | null }[]), ...((evL.data ?? []) as never[])]
    .filter((x) => when(x) >= today && when(x) <= until).sort((x, y) => when(x).localeCompare(when(y)));
  const signals = [...(sigE.data ?? []), ...(sigL.data ?? [])].sort((x, y) => String(y.observed_at).localeCompare(String(x.observed_at)));
  const links = stockLinks(e, { links: linksConfig(), taxonomy: tx, jarvisUrl: env().JARVIS_URL });
  const on = (b: boolean | undefined) => (b ? "ON" : "off");

  return (
    <main className="mx-auto max-w-3xl p-4 space-y-5">
      <Nav />
      <header>
        <h1 className="text-2xl font-bold">{e.market === "KR" ? "🇰🇷" : "🇺🇸"} {e.name} <span className="text-base font-normal text-neutral-500">{e.symbol}</span></h1>
        <p className="text-sm text-neutral-500">{e.l1_codes.map(l1Name).join(" + ")} · 근거 {e.l1_basis ?? "-"} · {e.asset_class}{e.snowball_asset_id ? " · SnowBall 보유/관심" : ""}</p>
        {e.aliases.length > 0 && <p className="text-xs text-neutral-500">별칭: {e.aliases.join(", ")}</p>}
      </header>
      <LinkRow links={links} />

      <Section title="축 (합산하지 않음)">
        {a ? (
          <Card>
            <p>N {on(a.n_on)} · C {on(a.c_on)} · F {on(a.f_on)} · P {a.p_value !== null ? Math.round(a.p_value) : "-"} · H {a.h_held ? "보유" : "-"} <span className="text-xs text-neutral-500">({a.date})</span></p>
            <p className="text-xs text-neutral-500">계열 {(a.evidence.families as string[] | undefined)?.join("/") ?? "-"}</p>
          </Card>
        ) : <Empty text="아직 평가되지 않았습니다(종목 신호·보유가 있을 때 평가)." />}
        {(queues.data ?? []).length > 0 && <p className="text-xs text-neutral-500">최근 큐: {(queues.data as { date: string; queue: Queue }[]).map((q) => `${q.date.slice(5)} ${QUEUE_LABEL[q.queue]}`).join(" · ")}</p>}
      </Section>

      <Section title="M3 산업 고성장 (L1)">
        {((heat.data ?? []) as { l1: string; m3_pass: boolean | null; m3_median_rev_yoy_q0: number | null; m3_median_rev_yoy_q1: number | null; m3_members: number | null; m3_basis: { bases?: Record<string, boolean>; us_major_broker?: { detail: { broker: string; value: number; published: string }[] } | null; outlook?: { source: string; cagr: number }[] } }[]).map((h) => (
          <Card key={h.l1} tone={h.m3_pass ? "good" : "muted"}>
            <p>{h.m3_pass ? "✅" : "—"} {l1Name(h.l1)}</p>
            <p className="text-xs">① 실적 {h.m3_basis?.bases?.realized ? "✓" : "·"} 매출 YoY 중앙값 {fmtPct(h.m3_median_rev_yoy_q0)}·{fmtPct(h.m3_median_rev_yoy_q1)} (표본 {h.m3_members ?? 0})</p>
            <p className="text-xs">② 미국 증권사 {h.m3_basis?.bases?.us_major_broker ? "✓" : "·"} {(h.m3_basis?.us_major_broker?.detail ?? []).map((d) => `${d.broker} ${d.value}% (${d.published})`).join(", ") || "-"}</p>
            <p className="text-xs">③ 전망 {h.m3_basis?.bases?.outlook ? "✓" : "·"} {(h.m3_basis?.outlook ?? []).map((o) => `${o.source} ${o.cagr}%`).join(", ") || "-"}</p>
          </Card>
        ))}
      </Section>

      <Section title="M4 6개월 내 상승 이벤트" count={events.length}>
        {events.length === 0 ? <Empty text="없음" /> : (
          <ul className="text-sm space-y-1">{events.slice(0, 12).map((x, i) => <li key={i}>{x.date ?? `~${x.window_end}`} · {x.title} <span className="text-xs text-neutral-500">({x.source})</span></li>)}</ul>
        )}
      </Section>

      <Section title="신호 타임라인" count={signals.length}>
        {signals.length === 0 ? <Empty text="없음" /> : (
          <ul className="text-sm space-y-1">
            {signals.slice(0, 30).map((s, i) => (
              <li key={i}>{String(s.observed_at).slice(0, 10)} · {KIND[s.kind as string] ?? s.kind} {s.direction === -1 ? "▼" : s.direction === 1 ? "▲" : ""} {s.strength}
                {"l1_codes" in s && (s.l1_codes as string[])?.length ? <span className="text-xs text-neutral-500"> ({(s.l1_codes as string[]).map(l1Name).join(",")} 산업)</span> : null}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="SnowBall">
        <form action={submitToSnowball}>
          <input type="hidden" name="entity_id" value={e.id} />
          <button className="rounded border border-neutral-400 px-3 py-1 text-sm">SnowBall 아이디어로 보내기 (draft)</button>
        </form>
        {sp.submitted && <p className="text-sm">{sp.submitted === "ok" ? "✅ SnowBall 아이디어 초안으로 보냈습니다." : `❌ ${sp.submitted}`}</p>}
      </Section>
      <Footer asOf={kstString(new Date(e.updated_at))} />
    </main>
  );
}
