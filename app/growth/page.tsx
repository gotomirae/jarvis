import { Empty, Footer, Nav, Section } from "@/app/_components/ui";
import { taxonomyConfig } from "@/lib/config/load";
import { fmtPct } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";
import { kstString } from "@/lib/time";

export const dynamic = "force-dynamic";

type Heat = { l1: string; m3_pass: boolean | null; m3_median_rev_yoy_q0: number | null; m3_median_rev_yoy_q1: number | null; m3_median_op_yoy: number | null; m3_members: number | null; n_score: number | null; c_score: number | null;
  m3_basis: { bases?: Record<string, boolean>; realized?: { sample?: string }; us_major_broker?: { median: number | null; detail: { broker: string; value: number; published: string; rule: string }[] } | null; outlook?: { segment: string; cagr: number; source: string; as_of: string; url?: string }[] } };
type Outlook = { id: number; l1: string | null; broker: string; metric: string; value_pct: number; horizon: string | null; published_date: string; domain: string; tier: string; url: string; quote: string; adoption_rule: string | null; status: string; conflict: boolean };

/** 산업 성장 근거 (PRD §8 /growth) — 보기 전용. 확인 버튼 없음(자동 채택, D19). */
export default async function Growth() {
  const sb = await supabaseServer();
  const last = await sb.from("industry_heat").select("date,created_at").order("date", { ascending: false }).limit(1).maybeSingle();
  const [heat, outs, logs] = await Promise.all([
    last.data ? sb.from("industry_heat").select("l1,m3_pass,m3_median_rev_yoy_q0,m3_median_rev_yoy_q1,m3_median_op_yoy,m3_members,n_score,c_score,m3_basis").eq("date", last.data.date) : Promise.resolve({ data: [] }),
    sb.from("industry_outlooks").select("id,l1,broker,metric,value_pct,horizon,published_date,domain,tier,url,quote,adoption_rule,status,conflict").in("status", ["adopted", "unverified", "expired"]).order("published_date", { ascending: false }).range(0, 299),
    sb.from("outlook_fetch_log").select("source,http_status,result_count,fetched_at").order("fetched_at", { ascending: false }).range(0, 199),
  ]);
  const tx = taxonomyConfig();
  const H = new Map(((heat.data ?? []) as Heat[]).map((h) => [h.l1, h]));
  const O = (outs.data ?? []) as Outlook[];
  const none = tx.l1.filter((r) => { const h = H.get(r.code); return !h || !h.m3_pass; });
  const lastRun = new Map<string, { ok: number; total: number; results: number; at: string }>();
  for (const l of (logs.data ?? []) as { source: string; http_status: number | null; result_count: number | null; fetched_at: string }[]) {
    const cur = lastRun.get(l.source) ?? { ok: 0, total: 0, results: 0, at: l.fetched_at };
    cur.total++; if (l.http_status === 200) cur.ok++; cur.results += l.result_count ?? 0;
    lastRun.set(l.source, cur);
  }
  const mark = (b: boolean | undefined) => (b ? "✅" : "·");

  return (
    <main className="mx-auto max-w-5xl p-4 space-y-5">
      <Nav />
      <Section title="M3 근거 매트릭스 (L1 18)">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-neutral-500 text-left">
              <tr><th className="py-1">L1</th><th>M3</th><th>① 실적 매출 YoY 중앙값 (q0·q1 · 표본)</th><th>② 미국 증권사</th><th>③ 전망</th><th>N</th><th>C</th></tr>
            </thead>
            <tbody>
              {tx.l1.map((r) => {
                const h = H.get(r.code);
                const b = h?.m3_basis?.bases ?? {};
                const br = h?.m3_basis?.us_major_broker;
                return (
                  <tr key={r.code} className="border-t border-neutral-100 dark:border-neutral-900 align-top">
                    <td className="py-1">{r.code} {r.name}</td>
                    <td>{h?.m3_pass ? "✅" : "—"}</td>
                    <td>{mark(b.realized)} {fmtPct(h?.m3_median_rev_yoy_q0)} · {fmtPct(h?.m3_median_rev_yoy_q1)} · {h?.m3_members ?? 0}{h?.m3_basis?.realized?.sample === "insufficient" ? " (판단 불가)" : h?.m3_basis?.realized?.sample === "KR+US" ? " (국내+미국)" : ""}</td>
                    <td>{mark(b.us_major_broker)} {br ? `${br.median ?? "-"}% (${br.detail.map((d) => `${d.broker} ${d.value}%`).join(", ")})` : "-"}</td>
                    <td>{mark(b.outlook)} {(h?.m3_basis?.outlook ?? []).map((o) => `${o.source} ${o.cagr}% (${o.as_of})`).join(", ") || "-"}</td>
                    <td>{h?.n_score ?? "-"}</td>
                    <td>{h?.c_score ?? "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="성장 근거 없음" count={none.length}>
        <p className="text-sm">{none.map((r) => r.name).join(" · ") || "없음"}</p>
        <p className="text-xs text-neutral-500">자료 보강: config/industry_growth.yaml ③(출처·기준월) 또는 ② 수동 broker 항목(URL·발표일).</p>
      </Section>

      {(["adopted", "unverified", "expired"] as const).map((st) => {
        const xs = O.filter((o) => o.status === st);
        return (
          <Section key={st} title={st === "adopted" ? "② 채택된 증권사 근거" : st === "unverified" ? "② 미검증 후보 (참고용·판정 미사용)" : "② 만료 (90일 경과)"} count={xs.length}>
            {xs.length === 0 ? <Empty text="없음" /> : (
              <ul className="space-y-2 text-sm">
                {xs.slice(0, st === "expired" ? 20 : 100).map((o) => (
                  <li key={o.id} className="rounded border border-neutral-200 dark:border-neutral-800 p-2">
                    <p><b>{o.broker}</b> · {o.l1 ? tx.l1.find((r) => r.code === o.l1)?.name ?? o.l1 : "L1 미상"} · {o.metric} {o.value_pct}% ({o.horizon ?? "-"}) · 발표 {o.published_date}
                      {o.adoption_rule && <span className="ml-1 text-xs rounded bg-emerald-100 dark:bg-emerald-900 px-1">{o.adoption_rule}</span>}
                      {o.conflict && <span className="ml-1 text-xs rounded bg-amber-100 dark:bg-amber-900 px-1">충돌</span>}</p>
                    <p className="text-neutral-600 dark:text-neutral-400">“{o.quote}”</p>
                    <p className="text-xs"><a href={o.url} target="_blank" rel="noreferrer" className="underline">{o.domain}</a> · 등급 {o.tier}</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        );
      })}

      <Section title="소스별 최근 수집">
        {lastRun.size === 0 ? <Empty text="수집 기록 없음" /> : (
          <ul className="text-sm">{[...lastRun].map(([s, v]) => <li key={s}>{s}: 응답 {v.ok}/{v.total} · 결과 {v.results} · {kstString(new Date(v.at))}</li>)}</ul>
        )}
      </Section>
      <Footer asOf={last.data?.created_at ? kstString(new Date(last.data.created_at)) : undefined} />
    </main>
  );
}
