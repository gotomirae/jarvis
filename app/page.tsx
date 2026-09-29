import { Card, Empty, Footer, LinkRow, Nav, Section } from "@/app/_components/ui";
import { linksConfig, taxonomyConfig } from "@/lib/config/load";
import { QUEUE_LABEL, type Queue } from "@/lib/engine/queues";
import { env } from "@/lib/env";
import { stockLinks, type LinkEntity } from "@/lib/links";
import { supabaseServer } from "@/lib/supabase/server";
import { kstDate, kstString } from "@/lib/time";

export const dynamic = "force-dynamic";

type QItem = { date: string; entity_id: string; queue: Queue; reason: Record<string, unknown>; first_seen: string; last_seen: string };
type Ent = LinkEntity & { l1_codes: string[] };

/** 오늘 (PRD §8): 레짐 띠 → ⚠️ → 💰 → 🟢 → 🎯 → 🟡 → 🔭 → ⏳ → 🔵. 🟢🟡🔵 는 P3 */
export default async function Today() {
  const sb = await supabaseServer();
  const since7 = new Date(Date.now() - 7 * 86400_000).toISOString();
  const [lastDate, reg, alerts] = await Promise.all([
    sb.from("queue_items").select("date").order("date", { ascending: false }).limit(1).maybeSingle(),
    sb.from("bot_state").select("value,updated_at").eq("key", "regime").maybeSingle(),
    sb.from("notifications").select("entity_id,payload,sent_at,created_at").eq("kind", "holding_alert").gte("created_at", since7).order("created_at", { ascending: false }).range(0, 49),
  ]);
  const date = (lastDate.data?.date as string | undefined) ?? kstDate();
  const items = await sb.from("queue_items").select("date,entity_id,queue,reason,first_seen,last_seen").eq("date", date).range(0, 499);
  const q = (items.data ?? []) as QItem[];
  const ids = [...new Set([...q.map((x) => x.entity_id), ...(alerts.data ?? []).map((a) => a.entity_id).filter(Boolean)])] as string[];
  const ents = ids.length ? await sb.from("entities").select("id,market,symbol,name,primary_l1,l1_codes,snowball_asset_id,hermes_analysis_id,naver_us_code").in("id", ids) : { data: [] };
  const byId = new Map(((ents.data ?? []) as Ent[]).map((e) => [e.id, e]));
  const ctx = { links: linksConfig(), taxonomy: taxonomyConfig(), jarvisUrl: env().JARVIS_URL };
  const r = reg.data?.value as { risk_off?: boolean; reasons?: string[]; vix?: number | null; snowball?: number | null; at?: string } | undefined;
  const liveAlerts = (alerts.data ?? []).filter((a) => !(a.payload as { bootstrap?: boolean })?.bootstrap);

  const section = (queue: Queue) => {
    const xs = q.filter((x) => x.queue === queue);
    return (
      <Section key={queue} title={QUEUE_LABEL[queue]} count={xs.length}>
        {xs.length === 0 ? <Empty text="없음" /> : xs.map((x) => {
          const e = byId.get(x.entity_id);
          const rs = x.reason as { p?: number | null; families?: string[]; days_to_earnings?: number; heat?: number };
          return (
            <Card key={x.entity_id}>
              <div className="flex flex-wrap items-baseline gap-2">
                <a href={`/stock/${encodeURIComponent(x.entity_id)}`} className="font-medium underline decoration-dotted">{e?.market === "US" ? "🇺🇸" : "🇰🇷"} {e?.name ?? x.entity_id}</a>
                <span className="text-xs text-neutral-500">
                  {rs.p !== undefined && rs.p !== null ? `P ${Math.round(rs.p)} · ` : ""}{rs.days_to_earnings !== undefined ? `실적 D-${rs.days_to_earnings} · ` : ""}{rs.heat !== undefined ? `과열 ${rs.heat} · ` : ""}{rs.families?.join("/") ?? ""} · {Math.max(1, Math.ceil((Date.now() - new Date(x.first_seen).getTime()) / 86400_000))}일째
                </span>
              </div>
              {e && <LinkRow links={stockLinks(e, ctx)} />}
            </Card>
          );
        })}
      </Section>
    );
  };

  return (
    <main className="mx-auto max-w-3xl p-4 space-y-5">
      <Nav />
      <div className={`rounded px-3 py-2 text-sm ${r?.risk_off ? "bg-red-100 dark:bg-red-950" : "bg-emerald-50 dark:bg-emerald-950"}`}>
        {r ? (r.risk_off ? `🔴 risk_off — ${(r.reasons ?? []).join(", ")} · 🟢 1차 비중 절반` : "🟢 레짐 정상") : "레짐 미계산"}
        {r && <span className="text-neutral-500"> · VIX {r.vix?.toFixed(1) ?? "-"} · SnowBall REGIME {r.snowball ?? "-"}</span>}
      </div>

      <Section title="⚠️ 보유 경고 (7일)" count={liveAlerts.length}>
        {liveAlerts.length === 0 ? <Empty text="없음" /> : liveAlerts.map((a, i) => {
          const p = a.payload as { name?: string; summary?: string; source?: string; latency_min?: number };
          return (
            <Card key={i} tone="warn">
              <p><span className="font-medium">{p.name}</span> — {p.summary} <span className="text-xs text-neutral-500">({p.source}{p.latency_min !== undefined ? ` · 지연 ${p.latency_min}분` : ""})</span></p>
              <p className="text-xs text-neutral-500">{a.sent_at ? `발송 ${kstString(new Date(a.sent_at))}` : "미발송"}</p>
            </Card>
          );
        })}
      </Section>
      {section("take_profit")}
      <Section title="🟢 진입 신호" count={0}><Empty text="P3(연계 작업 B·C 이후)에서 M1~M5 판정이 시작됩니다." /></Section>
      {section("buy")}
      <Section title="🟡 관찰" count={0}><Empty text="P3" /></Section>
      {section("radar")}
      {section("pullback_wait")}
      <Section title="🔵 실적 돌파" count={0}><Empty text="P3" /></Section>
      <Footer asOf={`${date} 큐 · 레짐 ${r?.at ? kstString(new Date(r.at)) : "-"}`} />
    </main>
  );
}
