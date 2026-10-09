import { SectorChart } from "@/app/_components/charts";
import { CycleGraph } from "@/app/_components/cycle";
import { Empty, Footer, Guide, Nav, Page, Pct, Section } from "@/app/_components/ui";
import { taxonomyConfig } from "@/lib/config/load";
import { dashboardConfig, sectorCharts } from "@/lib/dashboard/data";
import { earlyRise, industryPhaseOf, LENS_HINT, PHASE_HINT, PHASE_NAME, type Phase } from "@/lib/engine/cycle";
import { fmtPct } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";
import { kstString } from "@/lib/time";
import { GrowthSections } from "./growth-sections";

export const dynamic = "force-dynamic";

type Heat = { l1: string; n_score: number | null; c_score: number | null; m3_pass: boolean | null; m3_median_rev_yoy_q0: number | null; m3_median_rev_yoy_q1: number | null; m3_basis: { bases?: Record<string, boolean> } | null; basket_ret_1w: number | null; basket_ret_1m: number | null };
type Sig = { source: string; l1_codes: string[]; entity_id: string | null };
type Q = { entity_id: string; queue: string };

const BASIS: Record<string, string> = { realized: "실적", us_major_broker: "증권사", outlook: "전망" };
const PHASES: Phase[] = ["recovery", "expansion", "slowdown", "contraction"];
const PHASE_BORDER: Record<Phase, string> = { recovery: "border-l-good", expansion: "border-l-hot", slowdown: "border-l-warn", contraction: "border-l-cool" };
const PHASE_TEXT: Record<Phase, string> = { recovery: "text-good", expansion: "text-hot", slowdown: "text-warn", contraction: "text-cool" };
const chip = (ph: Phase | null | undefined) => (ph ? <b className={`whitespace-nowrap ${PHASE_TEXT[ph]}`}>{PHASE_NAME[ph]}</b> : <span className="text-sub">자료 없음</span>);
const signedNum = (x: number) => `${x > 0 ? "+" : ""}${x.toLocaleString("en-US")}`;
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
    last.data ? sb.from("industry_heat").select("l1,n_score,c_score,m3_pass,m3_median_rev_yoy_q0,m3_median_rev_yoy_q1,m3_basis,basket_ret_1w,basket_ret_1m").eq("date", last.data.date) : Promise.resolve({ data: [] }),
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
  // 🔄 세 렌즈 (D69): 산업 사이클(매출 YoY 중앙값 q0·q1) · 주가 위치(대표 ETF 추세 각도) · 수급 추세(대표 ETF 순매수) → 🚀 상승 초입 = 산업 회복·확장 ∧ 주가 바닥권~상승 초입
  const L = DC.lenses;
  const lens = sectors.map((s) => {
    const h = H.get(s.code);
    const ind = industryPhaseOf(h?.m3_median_rev_yoy_q0 ?? null, h?.m3_median_rev_yoy_q1 ?? null, L.industry);
    return { s, h, ind, early: earlyRise(ind, s.cycle, L.early_rise, h?.m3_median_rev_yoy_q0 ?? null) };
  }).sort((a, b) => Number(b.early) - Number(a.early) || (PHASES.indexOf(a.ind ?? "contraction") - PHASES.indexOf(b.ind ?? "contraction")));
  const early = lens.filter((x) => x.early);
  const growthWord = (h: Heat | undefined) => (h?.m3_median_rev_yoy_q0 == null ? "" : `매출 ${fmtPct(h.m3_median_rev_yoy_q0)}${h.m3_median_rev_yoy_q1 == null ? "" : ` (직전 ${fmtPct(h.m3_median_rev_yoy_q1)})`}`);
  const LENS_ROWS: { key: "ind" | "price" | "flow"; title: string; about: string; of: (x: (typeof lens)[number]) => Phase | null | undefined; hint: Record<Phase, string> }[] = [
    { key: "ind", title: "🏭 산업 사이클", about: "소속 기업 매출 증가율(중앙값)의 높이와 방향", of: (x) => x.ind, hint: LENS_HINT.industry },
    { key: "price", title: "📈 주가 위치", about: "대표 ETF 추세 위치(120일선)와 모멘텀", of: (x) => x.s.cycle?.phase, hint: PHASE_HINT },
    { key: "flow", title: "💰 수급 추세", about: `대표 ETF 순매수 — 최근 ${L.flow.short_days}일 · ${L.flow.long_days}일 합`, of: (x) => x.s.flow?.phase, hint: LENS_HINT.flow },
  ];

  return (
    <Page wide>
      <Nav />

      <Section title="🔄 섹터 주기 한눈에 — 산업 · 주가 · 수급" count={lens.length}>
        <Guide items={[
          <>🏭 <b className="text-gold">산업 사이클</b> = 실적(매출 증가율 높이 · 방향) · 📈 <b className="text-gold">주가 위치</b> = 대표 ETF 추세 · 💰 <b className="text-gold">수급 추세</b> = 대표 ETF 순매수</>,
          <>🚀 <b className="text-hot">상승 초입</b> = 산업은 🌱 회복 · 🚀 확장(매출 증가율 {L.early_rise.industry_min_growth_pct ?? 0}% 이상)인데 주가는 아직 바닥 ~ 회복 초입({L.early_rise.price_angle_from}°~{L.early_rise.price_angle_to}°) — 실적 개선을 주가가 덜 반영</>,
          "💰 수급이 🌱 회복 · 🚀 확장이면 확인 신호 · 판정(🎯 · 🟢)에는 쓰지 않는 참고 지표",
        ]} />
        <div className={`glass rounded-xl border-l-4 ${early.length ? "border-l-hot" : "border-l-line"} p-3 space-y-1`}>
          <p className="font-bold">🚀 상승 초입 산업 <span className="text-gold">{early.length}</span></p>
          {early.length ? early.map((x) => (
            <p key={x.s.code} className="text-sm">
              <b className="text-hot text-base">{x.s.name}</b> — 🏭 {chip(x.ind)} <span className="text-sub">{growthWord(x.h)}</span> · 📈 {chip(x.s.cycle?.phase)} <span className="text-sub">{x.s.cycle ? `${x.s.cycle.angle}°` : ""}</span> · 💰 {chip(x.s.flow?.phase)} {x.s.flow && (x.s.flow.phase === "recovery" || x.s.flow.phase === "expansion") ? <b className="text-good">✅ 수급 확인</b> : <span className="text-warn">⚠️ 수급 미확인</span>}
            </p>
          )) : <p className="text-sm">없음 — 산업이 🌱 회복 · 🚀 확장이면서 주가가 바닥권 ~ 회복 초입인 섹터가 아직 없습니다.</p>}
        </div>
        {LENS_ROWS.map((row) => (
          <div key={row.key} className="space-y-1">
            <p className="font-bold whitespace-nowrap">{row.title} <span className="text-xs font-normal text-sub">— {row.about}</span></p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {PHASES.map((ph) => {
                const xs = lens.filter((x) => row.of(x) === ph);
                return (
                  <div key={ph} className={`glass rounded-xl border-l-4 ${PHASE_BORDER[ph]} px-3 py-2`}>
                    <p className="font-bold whitespace-nowrap">{PHASE_NAME[ph]} <span className="text-gold">{xs.length}</span> <span className="text-xs font-normal text-sub">{row.hint[ph]}</span></p>
                    <p className="text-sm">{xs.length ? xs.map((x) => <span key={x.s.code} className={`mr-2 whitespace-nowrap ${x.early ? "text-hot font-bold" : ""}`}>{x.early ? "🚀" : ""}{x.s.name}</span>) : <span className="text-sub">없음</span>}</p>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <details className="glass rounded-lg px-3 py-2 text-sm">
          <summary className="cursor-pointer text-arc whitespace-nowrap">📋 섹터별 세 렌즈 표 보기</summary>
          <div className="table-wrap mt-2">
            <table className="text-sm">
              <thead><tr><th>섹터</th><th>🏭 산업 사이클</th><th>📈 주가 위치</th><th>💰 수급 추세</th><th>판정</th></tr></thead>
              <tbody>{lens.map((x) => (
                <tr key={x.s.code} className="border-t border-line/50">
                  <td className="font-semibold whitespace-nowrap">{x.s.name}</td>
                  <td className="whitespace-nowrap">{chip(x.ind)} <span className="text-xs text-sub">{growthWord(x.h)}</span></td>
                  <td className="whitespace-nowrap">{chip(x.s.cycle?.phase)} <span className="text-xs text-sub">{x.s.cycle ? `${x.s.cycle.angle}° · 1년 ${fmtPct(x.s.ret12m)}` : ""}</span></td>
                  <td className="whitespace-nowrap">{chip(x.s.flow?.phase)} <span className="text-xs text-sub">{x.s.flow ? `${L.flow.short_days}일 ${signedNum(x.s.flow.short)} · ${L.flow.long_days}일 ${signedNum(x.s.flow.long)}${x.s.flow.unit}` : ""}</span></td>
                  <td className="whitespace-nowrap">{x.early ? <b className="text-hot">🚀 상승 초입</b> : "-"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <p className="text-xs text-sub mt-1">💰 국내 = 외국인 + 기관 순매수(억원) · 미국 ETF = 상승일 거래대금 − 하락일 거래대금(백만달러, 투자자별 수급 미공개 대용)</p>
        </details>
      </Section>

      <Section title={`📈 섹터별 ${DC.lookback_months}개월 흐름 · 핵심 지표`} count={sectors.length}>
        <Guide items={[<><span className="text-gold">금색 점선</span> = 섹터 주가에 가장 큰 영향을 주는 <b className="text-gold">핵심 지표 1개</b> (오른쪽 축)</>, "역방향 지표(오르면 부담)는 오른쪽 축을 뒤집어 같은 방향으로 표시", <>상관 = 최근 {DC.lookback_months}개월 주가와 지표의 상관계수(±1에 가까울수록 함께 움직임) · <span className="text-gold">금색 구간</span> = 이번 주</>]} />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {secs.map((s) => (
            <div key={s.code} className="glass rounded-xl p-3 space-y-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="one-line font-bold text-base">{s.name}</p>
                <p className="whitespace-nowrap text-sm">이번 주 <Pct v={s.week?.change_pct ?? null} /></p>
              </div>
              <p className="one-line text-xs text-sub">{s.market === "KR" ? "🇰🇷" : "🇺🇸"} {s.proxy} · 1년 <Pct v={s.ret12m} arrow={false} />{s.week ? ` · ${s.week.start.slice(5).replace("-", "/")}~${s.week.end.slice(5).replace("-", "/")}` : ""}</p>
              {s.indicator ? (
                <p className="text-xs">🔑 <b className="text-gold">{s.indicator.name}</b>{s.indicator.invert ? <span className="text-warn"> (역방향)</span> : null} · 상관 <b className={s.indicator.corr === null ? "" : Math.abs(s.indicator.corr) >= 0.5 ? "text-good" : "text-white"}>{s.indicator.corr === null ? "-" : `${s.indicator.corr > 0 ? "+" : ""}${s.indicator.corr.toFixed(2)}`}</b>{s.indicator.last !== null ? ` · 현재 ${s.indicator.last.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : ""}{s.indicator.ret12m !== null ? ` (1년 ${s.indicator.ret12m > 0 ? "+" : ""}${s.indicator.ret12m.toFixed(s.indicator.name.includes("금리") ? 2 : 1)}${s.indicator.name.includes("금리") ? "%p" : "%"})` : ""}<span className="block text-sub">{s.indicator.why}</span></p>
              ) : null}
              {s.points.length ? <SectorChart data={s.points} week={s.week} up={(s.week?.change_pct ?? 0) >= 0} indicator={s.indicator} /> : <Empty text="시세 자료 없음" />}
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
