import { Empty, Footer, Guide, Nav, Section } from "@/app/_components/ui";
import { taxonomyConfig } from "@/lib/config/load";
import { fmtPct } from "@/lib/format";
import { METRIC_NAME, RULE_NAME, STATUS_NAME, TIER_NAME } from "@/lib/labels";
import { supabaseServer } from "@/lib/supabase/server";
import { kstString } from "@/lib/time";

export const dynamic = "force-dynamic";

type Heat = { l1: string; m3_pass: boolean | null; m3_median_rev_yoy_q0: number | null; m3_median_rev_yoy_q1: number | null; m3_median_op_yoy: number | null; m3_members: number | null; n_score: number | null; c_score: number | null;
  m3_basis: { bases?: Record<string, boolean>; realized?: { sample?: string }; us_major_broker?: { median: number | null; detail: { broker: string; value: number; published: string; rule: string }[] } | null; outlook?: { segment: string; cagr: number; source: string; as_of: string; url?: string }[] } };
type Outlook = { id: number; l1: string | null; broker: string; metric: string; value_pct: number; horizon: string | null; published_date: string; domain: string; tier: string; url: string; quote: string; adoption_rule: string | null; status: string; conflict: boolean };
const SOURCE: Record<string, string> = { google_news: "구글 뉴스", bing_news: "빙 뉴스", gdelt: "GDELT 뉴스 데이터", broker_site: "증권사 공개 페이지" };

/** 산업 성장 근거 (PRD §8 /growth) — 보기 전용, 확인 버튼 없음(자동 채택, D19) */
export default async function Growth() {
  const sb = await supabaseServer();
  const last = await sb.from("industry_heat").select("date,created_at").order("date", { ascending: false }).limit(1).maybeSingle();
  const [heat, outs, logs] = await Promise.all([
    last.data ? sb.from("industry_heat").select("l1,m3_pass,m3_median_rev_yoy_q0,m3_median_rev_yoy_q1,m3_median_op_yoy,m3_members,n_score,c_score,m3_basis").eq("date", last.data.date) : Promise.resolve({ data: [] }),
    sb.from("industry_outlooks").select("id,l1,broker,metric,value_pct,horizon,published_date,domain,tier,url,quote,adoption_rule,status,conflict").in("status", ["adopted", "unverified", "expired"]).order("published_date", { ascending: false }).range(0, 299),
    sb.from("outlook_fetch_log").select("source,http_status,result_count,fetched_at").order("fetched_at", { ascending: false }).range(0, 299),
  ]);
  const tx = taxonomyConfig();
  const nameOf = (c: string | null) => (c ? tx.l1.find((r) => r.code === c)?.name ?? c : "산업 미상");
  const H = new Map(((heat.data ?? []) as Heat[]).map((h) => [h.l1, h]));
  const O = (outs.data ?? []) as Outlook[];
  const none = tx.l1.filter((r) => !H.get(r.code)?.m3_pass);
  const lastRun = new Map<string, { ok: number; total: number; results: number; at: string }>();
  for (const l of (logs.data ?? []) as { source: string; http_status: number | null; result_count: number | null; fetched_at: string }[]) {
    const cur = lastRun.get(l.source) ?? { ok: 0, total: 0, results: 0, at: l.fetched_at };
    cur.total++; if (l.http_status === 200) cur.ok++; cur.results += l.result_count ?? 0;
    lastRun.set(l.source, cur);
  }
  const ok = (b: boolean | undefined) => (b ? "✅" : "—");
  const th = "py-1 pr-3 font-normal";

  return (
    <main className="mx-auto max-w-6xl px-4 py-4 space-y-8">
      <Nav />
      <Section title="산업별 고성장 판정 (18개 산업)">
        <Guide>진입 신호의 필수 조건 중 하나인 "산업 고성장"입니다. 아래 세 근거 중 하나라도 15% 이상이면 통과(✅)입니다.</Guide>
        <ul className="text-xs text-sub list-disc pl-5">
          <li><b>① 실제 실적</b>: 그 산업 기업들의 매출이 전년 같은 분기보다 몇 % 늘었는지 중앙값. 최근·직전 두 분기 모두 15% 이상 + 영업이익 증가</li>
          <li><b>② 미국 대형 증권사 전망</b>: 골드만삭스·모건스탠리·JP모건·BofA·씨티·웰스파고의 최근 3개월 공개 전망(자동 수집·자동 인정), 증권사별 최신값의 중앙값</li>
          <li><b>③ 시장조사·기업 전망</b>: 설정 파일에 입력한 출처 있는 3년 연평균 성장률(12개월 이내)</li>
        </ul>
        <div className="overflow-x-auto glass rounded-xl px-3">
          <table className="w-full text-sm">
            <thead className="text-xs text-sub text-left">
              <tr><th className={th}>산업</th><th className={th}>고성장</th><th className={th}>① 실제 실적: 매출 전년 대비 (최근 · 직전 분기, 기업 수)</th><th className={th}>② 미국 대형 증권사 전망</th><th className={th}>③ 시장조사·기업 전망</th><th className={th}>산업 이야기 강도</th><th className={th}>실적 촉매 강도</th></tr>
            </thead>
            <tbody>
              {tx.l1.map((r) => {
                const h = H.get(r.code);
                const b = h?.m3_basis?.bases ?? {};
                const br = h?.m3_basis?.us_major_broker;
                const sample = h?.m3_basis?.realized?.sample;
                return (
                  <tr key={r.code} className="border-t border-line/50 align-top">
                    <td className="py-1 pr-3 font-medium">{r.name}</td>
                    <td className="pr-3">{h?.m3_pass ? "✅ 통과" : "—"}</td>
                    <td className="pr-3">{ok(b.realized)} {fmtPct(h?.m3_median_rev_yoy_q0)} · {fmtPct(h?.m3_median_rev_yoy_q1)} · {h?.m3_members ?? 0}개{sample === "insufficient" ? " (기업 수 부족 — 판단 불가)" : sample === "KR+US" ? " (국내+미국 합산)" : ""}</td>
                    <td className="pr-3">{ok(b.us_major_broker)} {br ? `중앙값 ${br.median ?? "-"}% — ${br.detail.map((d) => `${d.broker} ${d.value}%`).join(", ")}` : "자료 없음"}</td>
                    <td className="pr-3">{ok(b.outlook)} {(h?.m3_basis?.outlook ?? []).map((o) => `${o.source} ${o.cagr}% (${o.as_of})`).join(", ") || "자료 없음"}</td>
                    <td className="pr-3">{h?.n_score ?? "-"} / 10</td>
                    <td className="pr-3">{h?.c_score ?? "-"} / 10</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="성장 근거가 없는 산업" count={none.length}>
        <p className="text-sm">{none.map((r) => r.name).join(" · ") || "없음"}</p>
        <Guide>이 산업의 종목은 진입 신호가 나올 수 없습니다. 자료를 보강하려면 설정 파일(config/industry_growth.yaml)에 출처·기준월이 있는 전망을 추가합니다.</Guide>
      </Section>

      {(["adopted", "unverified", "expired"] as const).map((st) => {
        const xs = O.filter((o) => o.status === st);
        return (
          <Section key={st} title={`② 미국 증권사 전망 — ${STATUS_NAME[st]}`} count={xs.length}>
            {st === "adopted" && <Guide>원문 문장을 그대로 저장합니다(요약·생성 없음). 인정 근거는 증권사 직접 발표, 서로 다른 매체 2곳 이상 보도, 또는 증권사·연평균·기간이 모두 적힌 보도입니다.</Guide>}
            {st === "unverified" && <Guide>인정 기준을 아직 채우지 못한 후보입니다. 판정에는 쓰지 않습니다.</Guide>}
            {xs.length === 0 ? <Empty text="없음" /> : (
              <ul className="space-y-2 text-sm">
                {xs.slice(0, st === "expired" ? 20 : 100).map((o) => (
                  <li key={o.id} className="rounded border border-line p-2 space-y-1">
                    <p><b>{o.broker}</b> · {nameOf(o.l1)} · {METRIC_NAME[o.metric] ?? o.metric} <b>{o.value_pct}%</b> ({o.horizon ?? "기간 미상"}) · 발표 {o.published_date}</p>
                    <p className="text-sub">“{o.quote}”</p>
                    <p className="text-xs text-sub">
                      출처 <a href={o.url} target="_blank" rel="noreferrer" className="link">{o.domain}</a> ({TIER_NAME[o.tier] ?? o.tier})
                      {o.adoption_rule && <> · 인정 근거: {RULE_NAME[o.adoption_rule] ?? o.adoption_rule}</>}
                      {o.conflict && <> · ⚠️ 같은 증권사의 다른 수치와 5%p 이상 차이 — 최신값 사용</>}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        );
      })}

      <Section title="자료 수집 상태 (무료 공개 소스)">
        {lastRun.size === 0 ? <Empty text="수집 기록 없음" /> : (
          <ul className="text-sm list-disc pl-5">{[...lastRun].map(([s, v]) => <li key={s}>{SOURCE[s] ?? s}: 응답 {v.ok}/{v.total}회 · 찾은 기사 {v.results}건 · {kstString(new Date(v.at))}</li>)}</ul>
        )}
      </Section>
      <Footer asOf={last.data?.created_at ? kstString(new Date(last.data.created_at)) : undefined} />
    </main>
  );
}
