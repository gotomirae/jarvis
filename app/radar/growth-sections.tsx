import { Empty, Guide, Section } from "@/app/_components/ui";
import { taxonomyConfig } from "@/lib/config/load";
import { fmtPct } from "@/lib/format";
import { brokerKo, METRIC_NAME, RULE_NAME, STATUS_NAME, TIER_NAME } from "@/lib/labels";
import { supabaseServer } from "@/lib/supabase/server";
import { kstString } from "@/lib/time";

type Heat = { l1: string; m3_pass: boolean | null; m3_median_rev_yoy_q0: number | null; m3_median_rev_yoy_q1: number | null; m3_members: number | null; n_score: number | null; c_score: number | null;
  m3_basis: { bases?: Record<string, boolean>; realized?: { sample?: string }; us_major_broker?: { median: number | null; detail: { broker: string; value: number; published: string }[] } | null; outlook?: { segment: string; cagr: number; source: string; as_of: string }[] } };
type Outlook = { id: number; l1: string | null; broker: string; metric: string; value_pct: number; horizon: string | null; published_date: string; domain: string; tier: string; url: string; quote: string; adoption_rule: string | null; status: string; conflict: boolean };
const SOURCE: Record<string, string> = { google_news: "구글 뉴스", bing_news: "빙 뉴스", gdelt: "GDELT 뉴스 데이터", broker_site: "증권사 공개 페이지" };

/** 산업 성장 근거 (옛 /growth — 10/5 산업 레이더에 통합). 보기 전용, 확인 버튼 없음(자동 채택, D19) */
export async function GrowthSections() {
  const sb = await supabaseServer();
  const last = await sb.from("industry_heat").select("date,created_at").order("date", { ascending: false }).limit(1).maybeSingle();
  const [heat, outs, logs] = await Promise.all([
    last.data ? sb.from("industry_heat").select("l1,m3_pass,m3_median_rev_yoy_q0,m3_median_rev_yoy_q1,m3_members,n_score,c_score,m3_basis").eq("date", last.data.date) : Promise.resolve({ data: [] }),
    sb.from("industry_outlooks").select("id,l1,broker,metric,value_pct,horizon,published_date,domain,tier,url,quote,adoption_rule,status,conflict").in("status", ["adopted", "unverified"]).order("published_date", { ascending: false }).range(0, 299),
    sb.from("outlook_fetch_log").select("source,http_status,result_count,fetched_at").order("fetched_at", { ascending: false }).range(0, 299),
  ]);
  const tx = taxonomyConfig();
  const nameOf = (c: string | null) => (c ? tx.l1.find((r) => r.code === c)?.name ?? c : "산업 미상");
  const H = new Map(((heat.data ?? []) as Heat[]).map((h) => [h.l1, h]));
  const O = (outs.data ?? []) as Outlook[];
  const none = tx.l1.filter((r) => !H.get(r.code)?.m3_pass);
  const runs = new Map<string, { ok: number; total: number; results: number; at: string }>();
  for (const l of (logs.data ?? []) as { source: string; http_status: number | null; result_count: number | null; fetched_at: string }[]) {
    const cur = runs.get(l.source) ?? { ok: 0, total: 0, results: 0, at: l.fetched_at };
    cur.total++; if (l.http_status === 200) cur.ok++; cur.results += l.result_count ?? 0;
    runs.set(l.source, cur);
  }
  const ok = (b: boolean | undefined) => (b ? "✅" : "➖");

  return (
    <>
      <Section title="🌱 산업 고성장 판정 (18개 산업)">
        <Guide items={[
          <>✅ 아래 세 근거 중 <b className="text-gold">하나라도 15% 이상</b>이면 고성장</>,
          "① 실제 실적 — 산업 기업들 매출의 전년 대비 증가율 중앙값 (최근 · 직전 분기 모두)",
          "② 미국 대형 증권사 전망 — 최근 3개월 공개 전망, 증권사별 최신값의 중앙값",
          "③ 시장조사 · 기업 전망 — 출처 있는 3년 연평균 성장률 (12개월 이내)",
        ]} />
        <div className="table-wrap">
          <table className="text-sm">
            <thead><tr><th>산업</th><th>판정</th><th>① 실제 실적 (최근 · 직전 · 기업 수)</th><th>② 미국 증권사 전망</th><th>③ 시장 전망</th><th>산업 이야기</th><th>실적 촉매</th></tr></thead>
            <tbody>
              {tx.l1.map((r) => {
                const h = H.get(r.code);
                const b = h?.m3_basis?.bases ?? {};
                const br = h?.m3_basis?.us_major_broker;
                const sample = h?.m3_basis?.realized?.sample;
                return (
                  <tr key={r.code} className="border-t border-line/50 align-top">
                    <td className="font-semibold whitespace-nowrap">{r.name}</td>
                    <td className="whitespace-nowrap">{h?.m3_pass ? <b className="text-good">✅ 고성장</b> : <span className="text-sub">➖ 근거 부족</span>}</td>
                    <td className="whitespace-nowrap">{ok(b.realized)} {fmtPct(h?.m3_median_rev_yoy_q0)} · {fmtPct(h?.m3_median_rev_yoy_q1)} · {h?.m3_members ?? 0}개{sample === "insufficient" ? " (기업 수 부족)" : sample === "KR+US" ? " (국내+미국)" : ""}</td>
                    <td>{ok(b.us_major_broker)} {br ? <>중앙값 <b className="text-gold">{br.median ?? "-"}%</b><br /><span className="text-xs text-sub">{br.detail.map((d) => `${brokerKo(d.broker)} ${d.value}%`).join(" · ")}</span></> : <span className="text-sub">자료 없음</span>}</td>
                    <td>{ok(b.outlook)} {(h?.m3_basis?.outlook ?? []).length ? (h?.m3_basis?.outlook ?? []).map((o) => <span key={o.source} className="block">{o.source} <b className="text-gold">{o.cagr}%</b> <span className="text-xs text-sub">({o.as_of})</span></span>) : <span className="text-sub">자료 없음</span>}</td>
                    <td className="whitespace-nowrap">{h?.n_score ?? "-"} / 10</td>
                    <td className="whitespace-nowrap">{h?.c_score ?? "-"} / 10</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Guide items={[<>➖ 근거 없는 산업: <b className="text-white">{none.map((r) => r.name).join(" · ") || "없음"}</b></>, "이 산업 종목은 🟢 진입 신호가 나올 수 없음", "보강: config/industry_growth.yaml 에 출처 · 기준월 있는 전망 추가"]} />
      </Section>

      {(["adopted", "unverified"] as const).map((st) => {
        const xs = O.filter((o) => o.status === st);
        return (
          <Section key={st} title={`🏦 미국 증권사 전망 — ${STATUS_NAME[st]}`} count={xs.length}>
            <Guide items={st === "adopted"
              ? ["증권사 직접 발표 · 매체 2곳 이상 보도 · 증권사 · 연평균 · 기간이 모두 적힌 보도만 인정", "원문(영어)은 '원문 보기'에 그대로 보관 — 요약 · 생성 없음"]
              : ["인정 기준을 아직 못 채운 후보", "판정에는 쓰지 않음"]} />
            {xs.length === 0 ? <Empty text="없음" /> : (
              <ul className="grid gap-2 md:grid-cols-2 text-sm">
                {xs.slice(0, 100).map((o) => (
                  <li key={o.id} className="glass rounded-lg p-3 space-y-1">
                    <p className="font-semibold">🏦 <span className="text-gold">{brokerKo(o.broker)}</span> · {nameOf(o.l1)}</p>
                    <p>📈 {METRIC_NAME[o.metric] ?? o.metric} <b className="text-gold text-base">{o.value_pct}%</b> <span className="text-sub">({o.horizon ?? "기간 미상"})</span></p>
                    <p className="text-xs text-sub">🗓️ 발표 {o.published_date} · 출처 <a href={o.url} target="_blank" rel="noreferrer" className="link">{o.domain}</a> ({TIER_NAME[o.tier] ?? o.tier}){o.adoption_rule ? ` · 인정 근거: ${RULE_NAME[o.adoption_rule] ?? o.adoption_rule}` : ""}</p>
                    {o.conflict && <p className="text-xs text-warn">⚠️ 같은 증권사 다른 수치와 5%p 이상 차이 → 최신값 사용</p>}
                    <details className="text-xs"><summary className="cursor-pointer text-arc">원문 보기</summary><p className="mt-1 text-sub">“{o.quote}”</p></details>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        );
      })}

      <Section title="🛰️ 전망 자료 수집 상태 (무료 공개 소스)">
        {runs.size === 0 ? <Empty text="수집 기록 없음" /> : (
          <ul className="grid gap-2 sm:grid-cols-2 text-sm">{[...runs].map(([s, v]) => <li key={s} className="glass rounded-lg px-3 py-2 whitespace-nowrap">{SOURCE[s] ?? s}: 응답 <b className="text-white">{v.ok}/{v.total}</b> · 기사 <b className="text-gold">{v.results}</b>건 · <span className="text-sub">{kstString(new Date(v.at))}</span></li>)}</ul>
        )}
      </Section>
    </>
  );
}
