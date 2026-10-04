import { Empty, Footer, Guide, Nav, Section } from "@/app/_components/ui";
import { taxonomyConfig } from "@/lib/config/load";
import { DIMENSION_NAME } from "@/lib/engine/feedback";
import { QUEUE_LABEL } from "@/lib/engine/queues";
import { rules } from "@/lib/jobs/context";
import { fmtPct } from "@/lib/format";
import { FAMILY_NAME } from "@/lib/labels";
import type { Proposal } from "@/lib/outcomes/review";
import { supabaseServer } from "@/lib/supabase/server";
import { kstString } from "@/lib/time";

export const dynamic = "force-dynamic";

type Stat = { scope: string; dimension: string; bucket: string; horizon_days: number; n: number; median_excess: number | null; hit_rate: number | null; median_ret: number | null; enough: boolean };
type Review = { id: number; period: string; review_date: string; proposals: Proposal[]; status: string; note: string | null };

const STATUS: Record<string, string> = { open: "검토 대기", no_change: "변경 없음", applied: "적용함", rejected: "반려", partial: "일부 적용" };
const ORDER: string[] = ["green", "yellow", "blue", "buy", "radar", "pullback_wait", "take_profit", "holding_alert"];
const LABEL: Record<string, string> = { ...QUEUE_LABEL, green: "🟢 진입 신호", yellow: "🟡 관찰", blue: "🔵 실적 돌파" };

/** 신호 성적표 (PRD §8 /scorecard, §12, D49) — 보기 전용. 보정은 제안만 하고 적용은 사용자 승인 후 */
export default async function Scorecard() {
  const sb = await supabaseServer();
  const F = rules().feedback;
  const H = rules().outcomes.horizons_days;
  const last = await sb.from("perf_stats").select("as_of").order("as_of", { ascending: false }).limit(1).maybeSingle();
  const [st, rv, led] = await Promise.all([
    last.data ? sb.from("perf_stats").select("scope,dimension,bucket,horizon_days,n,median_excess,hit_rate,median_ret,enough").eq("as_of", last.data.as_of).range(0, 4999) : Promise.resolve({ data: [] }),
    sb.from("calibration_reviews").select("id,period,review_date,proposals,status,note").order("review_date", { ascending: false }).limit(8),
    sb.from("signal_ledger").select("id", { count: "exact", head: true }).eq("event_type", "queue"),
  ]);
  const stats = (st.data ?? []) as Stat[];
  const reviews = (rv.data ?? []) as Review[];
  const l1 = new Map(taxonomyConfig().l1.map((r) => [r.code, r.name]));
  const bucketName = (d: string, b: string) => (d === "l1" ? l1.get(b) ?? b : d === "sources" ? FAMILY_NAME[b] ?? b : d === "families" ? `${b}개` : d === "market" ? (b === "KR" ? "국내" : b === "US" ? "미국" : b) : b);
  const get = (scope: string, h: number) => stats.find((s) => s.scope === scope && s.horizon_days === h && s.dimension === "all");
  const buyDims = stats.filter((s) => s.scope === "buy" && s.horizon_days === F.primary_horizon && s.dimension !== "all")
    .sort((a, b) => a.dimension.localeCompare(b.dimension) || (b.median_excess ?? -999) - (a.median_excess ?? -999));
  const buyAll = get("buy", F.primary_horizon);
  const th = "py-1 pr-3 font-normal";
  const cell = (s: Stat | undefined) => (s ? <>{fmtPct(s.median_excess, 2)}<span className="text-sub"> · {s.hit_rate === null ? "-" : `${Math.round(s.hit_rate * 100)}%`} · {s.n}건</span></> : "—");

  return (
    <main className="mx-auto max-w-6xl px-4 py-4 space-y-8">
      <Nav />
      <Section title="큐별 성과 — 시장 대비 초과수익" count={led.count ?? 0}>
        <Guide>각 칸 = 초과수익 중앙값 · 이긴 비율 · 측정 건수. 진입가는 신호 다음 거래일 종가, 기준은 KOSPI·KOSDAQ·S&amp;P 500. 매도 쪽(⚠️·💰)은 경고 뒤 시장보다 약했으면 이긴 것입니다. 표본 {F.min_samples}건 미만은 참고만 합니다.</Guide>
        {stats.length ? (
          <div className="overflow-x-auto glass rounded-xl px-3">
            <table className="w-full text-sm">
              <thead className="text-xs text-sub text-left"><tr><th className={th}>큐</th>{H.map((h) => <th key={h} className={th}>{h}거래일 뒤</th>)}</tr></thead>
              <tbody>
                {ORDER.filter((q) => H.some((h) => get(q, h))).map((q) => (
                  <tr key={q} className="border-t border-line/50"><td className="py-1 pr-3">{LABEL[q] ?? q}</td>{H.map((h) => <td key={h} className="py-1 pr-3">{cell(get(q, h))}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty text="아직 측정이 끝난 신호가 없습니다. 첫 5거래일 성과는 10/7 저녁에 기록됩니다." />}
      </Section>

      <Section title={`🎯 매수 검토 — 어떤 신호가 잘 맞았나 (${F.primary_horizon}거래일 뒤)`}>
        <Guide>
          신호 특징별 성과입니다. 표본 {F.min_samples}건 이상인 구간(✓)은 브리핑의 🎯 추천 순위에 자동으로 반영됩니다(기대 초과수익 = 표본 수로 줄인 구간 중앙값의 평균).
          {buyAll ? ` 현재 🎯 전체 ${buyAll.n}건 — ${buyAll.n >= F.min_samples ? "순위 반영 중" : "표본 부족, 기존 규칙 순위 사용 중"}.` : ""}
        </Guide>
        {buyDims.length ? (
          <div className="overflow-x-auto glass rounded-xl px-3">
            <table className="w-full text-sm">
              <thead className="text-xs text-sub text-left"><tr><th className={th}>기준</th><th className={th}>구간</th><th className={th}>초과수익 중앙값</th><th className={th}>이긴 비율</th><th className={th}>건수</th><th className={th}>순위 반영</th></tr></thead>
              <tbody>
                {buyDims.map((s) => (
                  <tr key={`${s.dimension}|${s.bucket}`} className="border-t border-line/50">
                    <td className="py-1 pr-3">{DIMENSION_NAME[s.dimension] ?? s.dimension}</td><td className="py-1 pr-3">{bucketName(s.dimension, s.bucket)}</td>
                    <td className="py-1 pr-3">{fmtPct(s.median_excess, 2)}</td><td className="py-1 pr-3">{s.hit_rate === null ? "-" : `${Math.round(s.hit_rate * 100)}%`}</td>
                    <td className="py-1 pr-3">{s.n}</td><td className="py-1 pr-3">{s.n >= F.min_samples ? "✓" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty text="아직 측정된 🎯 신호가 없습니다." />}
      </Section>

      <Section title="분기 보정 제안">
        <Guide>분기 첫 토요일 10:30에 성적표와 함께 만듭니다. 설정은 자동으로 바뀌지 않습니다 — 승인한 제안만 설정 변경과 결정 기록(DECISIONS)으로 반영합니다. 필수 조건 M1~M5 자체는 대상이 아닙니다.</Guide>
        {reviews.length ? reviews.map((r) => (
          <div key={r.id} className="text-sm space-y-1 border-t border-line/50 pt-2">
            <div className="font-medium">{r.period} ({r.review_date}) · {STATUS[r.status] ?? r.status}{r.note ? ` — ${r.note}` : ""}</div>
            {r.proposals.length ? (
              <ol className="list-decimal pl-5 text-xs space-y-1">
                {r.proposals.map((p, i) => <li key={i}>{p.kind === "threshold" ? "🔧" : "ℹ️"} {p.title}{p.rule ? ` — ${p.current} → ${p.suggested}` : ""}<div className="text-sub">{p.evidence}</div></li>)}
              </ol>
            ) : <Empty text="제안 없음" />}
          </div>
        )) : <Empty text="아직 보정 검토가 없습니다(첫 검토: 2027-01-02 토)." />}
      </Section>
      <Footer asOf={last.data ? `${last.data.as_of} 성과 기준 · ${kstString()}` : undefined} />
    </main>
  );
}
