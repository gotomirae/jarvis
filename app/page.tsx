import { Card, Empty, Footer, Guide, LinkRow, Nav, Section } from "@/app/_components/ui";
import { linksConfig, taxonomyConfig } from "@/lib/config/load";
import { explain, type AxesEvidence } from "@/lib/engine/explain";
import { buyReasons, consensusOf, EMPTY_IDEA, ideaCard, rankBuy } from "@/lib/engine/idea";
import type { Queue } from "@/lib/engine/queues";
import { env } from "@/lib/env";
import { stockLinks, type LinkEntity } from "@/lib/links";
import { supabaseServer } from "@/lib/supabase/server";
import { kstDate, kstString } from "@/lib/time";

export const dynamic = "force-dynamic";

type QItem = { date: string; entity_id: string; queue: Queue; reason: Record<string, unknown>; first_seen: string };
type Ent = LinkEntity & { l1_codes: string[] };

const SECTIONS: { queue: Queue; title: string; about: string }[] = [
  { queue: "take_profit", title: "💰 익절 검토", about: "보유 종목 중 과열 점수와 주가 반영도가 모두 높은 종목" },
  { queue: "buy", title: "🎯 매수 검토", about: "실적 숫자가 좋고 주가는 아직 덜 반영됐으며, 서로 다른 프로젝트 2곳 이상이 같은 방향 신호를 낸 종목. 신호 합의 수 → 낮은 주가 반영도 → 산업 성장률 → 가까운 이벤트 순으로 정렬하며, 시장별 상위 5개가 브리핑 추천입니다." },
  { queue: "radar", title: "🔭 선행 관찰", about: "산업 이야기와 실적 촉매는 켜졌지만 실적 숫자는 아직 확인 전이고, 실적 발표가 45일 안에 있는 종목" },
  { queue: "pullback_wait", title: "⏳ 눌림 대기", about: "실적은 좋지만 주가가 이미 많이 반영된 종목 — 반영도가 50 아래로 내려오면 다시 봄" },
];

/** 오늘 (PRD §8): 시장 국면 → 보유 경고 → 익절 → 진입 신호 → 매수 검토 → 관찰 → 선행 관찰 → 눌림 대기 → 실적 돌파 */
export default async function Today() {
  const sb = await supabaseServer();
  const since7 = new Date(Date.now() - 7 * 86400_000).toISOString();
  const [lastDate, reg, alerts] = await Promise.all([
    sb.from("queue_items").select("date").order("date", { ascending: false }).limit(1).maybeSingle(),
    sb.from("bot_state").select("value").eq("key", "regime").maybeSingle(),
    sb.from("notifications").select("entity_id,payload,sent_at,created_at").eq("kind", "holding_alert").gte("created_at", since7).order("created_at", { ascending: false }).range(0, 99),
  ]);
  const date = (lastDate.data?.date as string | undefined) ?? kstDate();
  const [items, axes] = await Promise.all([
    sb.from("queue_items").select("date,entity_id,queue,reason,first_seen").eq("date", date).range(0, 499),
    sb.from("axes_daily").select("entity_id,evidence").eq("date", date).range(0, 1999),
  ]);
  const q = (items.data ?? []) as QItem[];
  const evBy = new Map(((axes.data ?? []) as { entity_id: string; evidence: AxesEvidence }[]).map((a) => [a.entity_id, a.evidence]));
  const ids = [...new Set([...q.map((x) => x.entity_id), ...(alerts.data ?? []).map((a) => a.entity_id).filter(Boolean)])] as string[];
  const ents = ids.length ? await sb.from("entities").select("id,market,symbol,name,primary_l1,l1_codes,snowball_asset_id,hermes_analysis_id,naver_us_code").in("id", ids) : { data: [] };
  const byId = new Map(((ents.data ?? []) as Ent[]).map((e) => [e.id, e]));
  const ctx = { links: linksConfig(), taxonomy: taxonomyConfig(), jarvisUrl: env().JARVIS_URL };
  const r = reg.data?.value as { risk_off?: boolean; reasons?: string[]; vix?: number | null; snowball?: number | null; at?: string } | undefined;

  // 보유 경고: 종목별로 묶어서
  const alertBy = new Map<string, { name: string; lines: { summary: string; source: string; when: string }[] }>();
  for (const a of alerts.data ?? []) {
    const p = a.payload as { name?: string; summary?: string; source?: string; bootstrap?: boolean; asset_id?: string };
    const k = a.entity_id ?? p.asset_id ?? p.name ?? "-";
    const cur = alertBy.get(k) ?? alertBy.set(k, { name: p.name ?? k, lines: [] }).get(k)!;
    cur.lines.push({ summary: p.summary ?? "", source: p.source ?? "", when: a.sent_at ? `알림 ${kstString(new Date(a.sent_at))}` : p.bootstrap ? "처음 실행 때 기록(알림 안 보냄)" : "미발송" });
  }

  return (
    <main className="mx-auto max-w-3xl p-4 space-y-6">
      <Nav />
      <div className={`rounded px-3 py-2 text-sm ${r?.risk_off ? "bg-red-100 dark:bg-red-950" : "bg-emerald-50 dark:bg-emerald-950"}`}>
        <p className="font-medium">{r ? (r.risk_off ? "🔴 시장 국면: 위험 회피" : "🟢 시장 국면: 정상") : "시장 국면: 아직 계산 전"}</p>
        {r && <p className="text-xs text-neutral-600 dark:text-neutral-400">
          {r.risk_off ? `이유: ${(r.reasons ?? []).join(", ")} → 진입 신호의 1차 비중을 절반으로 줄임. ` : ""}변동성지수(VIX) {r.vix?.toFixed(1) ?? "-"} · SnowBall 국면 값 {r.snowball ?? "-"} (−1이면 위험 회피)
        </p>}
      </div>

      <Section title="⚠️ 보유 경고 (최근 7일)" count={alertBy.size}>
        <Guide>보유 종목에 생긴 위험 신호입니다. 고점 대비 −20% 이하 하락, 허용 비중 초과, 투자 논지를 깨는 이벤트, 등급 하락 등을 종목별로 묶어 보여 줍니다.</Guide>
        {alertBy.size === 0 ? <Empty text="없음" /> : [...alertBy.entries()].map(([k, v]) => (
          <Card key={k} tone="warn">
            <p className="font-medium">{byId.has(k) ? <a href={`/stock/${encodeURIComponent(k)}`} className="underline decoration-dotted">{v.name}</a> : v.name}</p>
            <ul className="text-sm list-disc pl-5">{v.lines.map((l, i) => <li key={i}>{l.summary} <span className="text-xs text-neutral-500">— {l.source} · {l.when}</span></li>)}</ul>
            <p className="text-xs">할 일: 투자 논지 다시 보기 → SnowBall에 결정 기록</p>
          </Card>
        ))}
      </Section>

      <QueueSection {...SECTIONS[0]} q={q} byId={byId} evBy={evBy} ctx={ctx} />
      <Section title="🟢 진입 신호" count={0}>
        <Guide>필수 조건 5가지(실적 가속·주가 미반영 / MACD 교차 직전 / 산업 고성장 / 6개월 내 상승 이벤트 / 외국인·기관 2일 연속 순매수)를 모두 충족한 종목만 표시합니다.</Guide>
        <Empty text="Heimdallr·HermesCall 연계 작업(진입 조건 계산) 후 다음 단계에서 시작합니다." />
      </Section>
      <QueueSection {...SECTIONS[1]} q={q} byId={byId} evBy={evBy} ctx={ctx} />
      <Section title="🟡 관찰" count={0}><Empty text="진입 신호와 함께 다음 단계에서 시작합니다." /></Section>
      <QueueSection {...SECTIONS[2]} q={q} byId={byId} evBy={evBy} ctx={ctx} />
      <QueueSection {...SECTIONS[3]} q={q} byId={byId} evBy={evBy} ctx={ctx} />
      <Section title="🔵 실적 돌파" count={0}><Empty text="다음 단계에서 시작합니다(진입 신호 아님, 60거래일 관찰)." /></Section>
      <Footer asOf={`${date} 판정 · 시장 국면 ${r?.at ? kstString(new Date(r.at)) : "-"}`} />
    </main>
  );
}

function QueueSection({ queue, title, about, q, byId, evBy, ctx }: {
  queue: Queue; title: string; about: string; q: QItem[]; byId: Map<string, Ent>; evBy: Map<string, AxesEvidence>;
  ctx: Parameters<typeof stockLinks>[1];
}) {
  let xs = q.filter((x) => x.queue === queue);
  const top = new Set<string>();
  if (queue === "buy") {
    const rk = (m: "KR" | "US") => rankBuy(xs.filter((x) => (byId.get(x.entity_id)?.market ?? "KR") === m).map((x) => {
      const ev = evBy.get(x.entity_id) ?? {};
      return { ...x, families: ev.families?.length ?? 0, p: (x.reason as { p?: number | null }).p ?? null, industryGrowth: ev.idea?.industry?.realized_median ?? null, nextEvent: ev.next_event ?? null };
    }), xs.length);
    const kr = rk("KR"), us = rk("US");
    for (const x of [...kr.slice(0, 5), ...us.slice(0, 5)]) top.add(x.entity_id);
    xs = [...kr, ...us];
  }
  return (
    <Section title={title} count={xs.length}>
      <Guide>{about}</Guide>
      {xs.length === 0 ? <Empty text="없음" /> : xs.map((x) => {
        const e = byId.get(x.entity_id);
        const rs = x.reason as { p?: number | null; days_to_earnings?: number; heat?: number };
        const ex = explain({ queue, market: e?.market ?? "KR", evidence: evBy.get(x.entity_id) ?? {}, p: rs.p ?? null, daysToEarnings: rs.days_to_earnings ?? null, heat: rs.heat ?? null });
        const days = Math.max(1, Math.ceil((Date.now() - new Date(x.first_seen).getTime()) / 86400_000));
        return (
          <Card key={x.entity_id}>
            <p className="font-medium">
              <a href={`/stock/${encodeURIComponent(x.entity_id)}`} className="underline decoration-dotted">{e?.market === "US" ? "🇺🇸" : "🇰🇷"} {e?.name ?? x.entity_id}</a>
              <span className="ml-1 text-xs text-neutral-500">{e?.symbol} · 이 목록에 {days}일째</span>
            </p>
            {queue === "buy" && e ? <IdeaView ev={evBy.get(x.entity_id) ?? {}} e={e} p={rs.p ?? null} top={top.has(x.entity_id)} /> : <>
              <p><b>결론</b> {ex.conclusion}</p>
              <ul className="list-disc pl-5 text-neutral-700 dark:text-neutral-300">{ex.reasons.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </>}
            {e && <LinkRow links={stockLinks(e, ctx)} />}
          </Card>
        );
      })}
    </Section>
  );
}

/** 🎯 투자 아이디어·매수 근거 (브리핑과 같은 함수) */
function IdeaView({ ev, e, p, top }: { ev: AxesEvidence; e: Ent; p: number | null; top: boolean }) {
  const idea = ev.idea ?? EMPTY_IDEA;
  const c = ideaCard(1, { name: e.name, symbol: e.symbol, market: e.market, industry: idea.industry?.name ?? "" }, idea,
    buyReasons({ idea, p, consensus: consensusOf(ev), grade: ev.F?.grade ?? null, score: ev.F?.score ?? null }), ev.tech, "");
  return (
    <div className="space-y-1 text-sm">
      {top && <p className="text-xs text-emerald-700 dark:text-emerald-400">⭐ 오늘 브리핑 추천 (시장별 상위 5)</p>}
      {c.thesis && <p><b>💡 투자 아이디어</b> {c.thesis}</p>}
      <p className="font-medium">📈 매수 근거</p>
      <ul className="pl-2 text-neutral-700 dark:text-neutral-300">{c.reasons.map((t, i) => <li key={i}>{t}</li>)}</ul>
      {c.events.length > 0 && <p>⏰ 다음 확인: {c.events.join(" / ")}</p>}
      {c.risk && <p>⚠️ 리스크: {c.risk}</p>}
      {c.tech && <p className="text-xs text-neutral-500">📊 기술적 참고(판정 미사용): {c.tech}</p>}
    </div>
  );
}
