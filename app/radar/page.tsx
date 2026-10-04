import { SectorChart } from "@/app/_components/charts";
import { CycleGraph } from "@/app/_components/cycle";
import { Empty, Footer, Guide, Nav, Page, Pct, Section } from "@/app/_components/ui";
import { taxonomyConfig } from "@/lib/config/load";
import { dashboardConfig, sectorCharts } from "@/lib/dashboard/data";
import { PHASE_HINT, PHASE_NAME, type Phase } from "@/lib/engine/cycle";
import { fmtPct } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";
import { kstString } from "@/lib/time";
import { GrowthSections } from "./growth-sections";

export const dynamic = "force-dynamic";

type Heat = { l1: string; n_score: number | null; c_score: number | null; m3_pass: boolean | null; m3_median_rev_yoy_q0: number | null; m3_basis: { bases?: Record<string, boolean> } | null; basket_ret_1w: number | null; basket_ret_1m: number | null };
type Sig = { source: string; l1_codes: string[]; entity_id: string | null };
type Q = { entity_id: string; queue: string };

const BASIS: Record<string, string> = { realized: "실적", us_major_broker: "증권사", outlook: "전망" };
const PHASES: Phase[] = ["recovery", "expansion", "slowdown", "contraction"];
const PHASE_BORDER: Record<Phase, string> = { recovery: "border-l-good", expansion: "border-l-hot", slowdown: "border-l-warn", contraction: "border-l-cool" };
const score = (v: number | null) => (v === null ? "-" : v >= 8 ? <b className="text-hot">{v}</b> : v >= 5 ? <b className="text-gold">{v}</b> : <span>{v}</span>);

/** 📡 산업 레이더 (PRD §8 /radar + 옛 /growth 통합, 10/5) — 섹터 12개월 흐름·이번 주·주기 → 신호 → 고성장 근거. 보기 전용 */
export default async function Radar() {
  const sb = await supabaseServer();
  const tx = taxonomyConfig();
  const DC = dashboardConfig();
  const last = await sb.from("industry_heat").select("date").order("date", { ascending: false }).limit(1).maybeSingle();
  const since = new Date(Date.now() - 14 * 86400_000).toISOString();
  const qd = await sb.from("queue_items").select("date").order("date", { ascending: false }).limit(1).maybeSingle();
  const [heat, sigs, qs, ents, sectors] = await Promise.all([
    last.data ? sb.from("industry_heat").select("l1,n_score,c_score,m3_pass,m3_median_rev_yoy_q0,m3_basis,basket_ret_1w,basket_ret_1m").eq("date", last.data.date) : Promise.resolve({ data: [] }),
    sb.from("signals").select("source,l1_codes,entity_id").gte("observed_at", since).range(0, 4999),
    qd.data ? sb.from("queue_items").select("entity_id,queue").eq("date", qd.data.date).range(0, 999) : Promise.resolve({ data: [] }),
    sb.from("entities").select("id,primary_l1").range(0, 4999),
    sectorCharts(),
  ]);
  const H = new Map(((heat.data ?? []) as Heat[]).map((h) => [h.l1, h]));
  const l1Of = new Map(((ents.data ?? []) as { id: string; primary_l1: string | null }[]).map((e) => [e.id, e.primary_l1]));
  const bySrc = new Map<string, Record<string, number>>();
  for (const s of (sigs.data ?? []) as Sig[]) {
    const ls = s.l1_codes.length ? s.l1_codes : s.entity_id && l1Of.get(s.entity_id) ? [l1Of.get(s.entity_id) as string] : [];
    for (const l of ls) { const m = bySrc.get(l) ?? {}; m[s.source] = (m[s.source] ?? 0) + 1; bySrc.set(l, m); }
  }
  const qBy = new Map<string, Record<string, number>>();
  for (const q of (qs.data ?? []) as Q[]) { const l = l1Of.get(q.entity_id); if (!l) continue; const m = qBy.get(l) ?? {}; m[q.queue] = (m[q.queue] ?? 0) + 1; qBy.set(l, m); }
  const rows = tx.l1.map((r) => ({ r, h: H.get(r.code), s: bySrc.get(r.code) ?? {}, q: qBy.get(r.code) ?? {} }))
    .sort((a, b) => Number(!!b.h?.m3_pass) - Number(!!a.h?.m3_pass) || (b.h?.n_score ?? -1) - (a.h?.n_score ?? -1));
  const secs = [...sectors].sort((a, b) => (b.week?.change_pct ?? -999) - (a.week?.change_pct ?? -999));

  return (
    <Page wide>
      <Nav />

      <Section title="🔄 섹터 주기 한눈에" count={sectors.filter((s) => s.cycle).length}>
        <Guide items={["대표 ETF 1년 흐름으로 지금 주기 위치를 계산", "🌱 회복 · 🚀 확장 구간 섹터가 상승 흐름", "판정에는 쓰지 않는 참고 지표"]} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PHASES.map((ph) => {
            const xs = sectors.filter((s) => s.cycle?.phase === ph);
            return (
              <div key={ph} className={`glass rounded-xl border-l-4 ${PHASE_BORDER[ph]} p-3`}>
                <p className="font-bold whitespace-nowrap">{PHASE_NAME[ph]} <span className="text-gold">{xs.length}</span></p>
                <p className="text-xs text-sub whitespace-nowrap mb-1">{PHASE_HINT[ph]}</p>
                <p className="text-sm">{xs.length ? xs.map((s) => s.name).join(" · ") : <span className="text-sub">없음</span>}</p>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title={`📈 섹터별 ${DC.lookback_months}개월 흐름 · 이번 주`} count={sectors.length}>
        <Guide items={[<><span className="text-gold">금색 구간</span> = 이번 주 · <span className="text-arc">시작</span> → <span className="text-gold">끝</span></>, "이번 주 등락 = 지난주 마지막 종가 대비", "이번 주 상승률 높은 순 · 국내 ETF는 거래소 공식 종가"]} />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {secs.map((s) => (
            <div key={s.code} className="glass rounded-xl p-3 space-y-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="one-line font-bold text-base">{s.name}</p>
                <p className="whitespace-nowrap text-sm">이번 주 <Pct v={s.week?.change_pct ?? null} /></p>
              </div>
              <p className="one-line text-xs text-sub">{s.market === "KR" ? "🇰🇷" : "🇺🇸"} {s.proxy} · 1년 <Pct v={s.ret12m} arrow={false} />{s.week ? ` · ${s.week.start.slice(5).replace("-", "/")}~${s.week.end.slice(5).replace("-", "/")}` : ""}</p>
              {s.points.length ? <SectorChart data={s.points} week={s.week} up={(s.week?.change_pct ?? 0) >= 0} /> : <Empty text="시세 자료 없음" />}
              <CycleGraph c={s.cycle} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="📡 산업별 신호 현황">
        <Guide items={["고성장 = 실적 · 증권사 · 전망 중 하나라도 15% 이상", "흐름 강도 = FlyWheel 산업 신호 (0~10, 8 이상 빨강)", "신호 수 = 최근 14일 출처별 건수 · 바스켓 = 국내 동일가중"]} />
        {rows.length ? (
          <div className="table-wrap">
            <table className="text-sm">
              <thead><tr><th>산업</th><th>고성장</th><th>근거</th><th>매출 중앙값</th><th>흐름 강도</th><th>실적 촉매</th><th>FlyWheel · Sage · HermesCall · Heimdallr</th><th>🎯 · 🔭 · ⚠️</th><th>바스켓 1주 · 1개월</th></tr></thead>
              <tbody>
                {rows.map(({ r, h, s, q }) => (
                  <tr key={r.code} className="border-t border-line/50">
                    <td className="font-semibold whitespace-nowrap">{r.name}</td>
                    <td>{h?.m3_pass ? "✅" : "➖"}</td>
                    <td className="text-xs whitespace-nowrap">{Object.entries(h?.m3_basis?.bases ?? {}).filter(([, v]) => v).map(([k]) => BASIS[k] ?? k).join(" · ") || "-"}</td>
                    <td className="whitespace-nowrap">{fmtPct(h?.m3_median_rev_yoy_q0 ?? null)}</td>
                    <td>{score(h?.n_score ?? null)}</td>
                    <td>{score(h?.c_score ?? null)}</td>
                    <td className="text-xs whitespace-nowrap">{["flywheel", "sage", "hermescall", "heimdallr"].map((k) => s[k] ?? 0).join(" · ")}</td>
                    <td className="text-xs whitespace-nowrap">{[q.buy ?? 0, q.radar ?? 0, q.holding_alert ?? 0].join(" · ")}</td>
                    <td className="whitespace-nowrap"><Pct v={h?.basket_ret_1w ?? null} arrow={false} /> · <Pct v={h?.basket_ret_1m ?? null} arrow={false} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty text="산업 판정 자료가 없습니다." />}
      </Section>

      <div id="growth" className="space-y-8"><GrowthSections /></div>
      <Footer asOf={last.data ? `${last.data.date} 판정 · ${kstString()}` : kstString()} />
    </Page>
  );
}
