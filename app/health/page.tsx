import { Empty, Footer, Guide, Nav, Section } from "@/app/_components/ui";
import { env } from "@/lib/env";
import { supabaseServer } from "@/lib/supabase/server";
import { kstString } from "@/lib/time";

export const dynamic = "force-dynamic";

type Run = { job: string; slot: string; started_at: string; finished_at: string | null; ok: boolean | null; detail: { error?: string } | null };
type Src = { source: string; last_ok_at: string | null; last_error: string | null; consecutive_failures: number };
type Link = { rule: string; status: number | null; ok: boolean; note: string | null; checked_at: string };

const KST = (s: string | null) => (s ? kstString(new Date(s)) : "-");
const EXPECT: Record<string, string> = {
  pipeline: "07:12·19:10", entry_eval: "파이프라인 안 + 21:40", brief_morning: "07:30", brief_evening: "19:20", poll: "30분마다", outcomes_update: "20:00",
  industry_growth_realized: "07:00·19:00", holdings_sync: "07:10·16:10", link_smoke: "03:30", industry_outlook_collect: "일·수 04:00", weekly_memo: "토 09:30", calibration_review: "분기 첫 토 10:30",
  taxonomy_sync: "일 03:00", entities_sync: "일 03:05", ingest_all: "파이프라인 안", catalysts: "파이프라인 안", inbox: "파이프라인 안",
};

/** 시스템 상태 (PRD §8 /health) — 잡 실행·실패, 소스별 마지막 수집, 링크 점검, LLM 비용. 보기 전용 */
export default async function Health() {
  const sb = await supabaseServer();
  const since = new Date(Date.now() - 3 * 86400_000).toISOString();
  const month = `${kstString().slice(0, 8)}01T00:00:00+09:00`;
  const [runs, srcs, links, cost] = await Promise.all([
    sb.from("job_runs").select("job,slot,started_at,finished_at,ok,detail").gte("started_at", since).order("started_at", { ascending: false }).range(0, 999),
    sb.from("source_health").select("source,last_ok_at,last_error,consecutive_failures").order("source"),
    sb.from("link_checks").select("rule,status,ok,note,checked_at").order("checked_at", { ascending: false }).range(0, 199),
    sb.from("cost_log").select("usd,model,purpose").gte("at", month).range(0, 999),
  ]);
  const last = new Map<string, Run & { fails: number; runs: number }>();
  for (const r of (runs.data ?? []) as Run[]) {
    const cur = last.get(r.job);
    if (!cur) last.set(r.job, { ...r, fails: r.ok === false ? 1 : 0, runs: 1 });
    else { cur.runs++; if (r.ok === false) cur.fails++; }
  }
  const linkLast = new Map<string, Link>();
  for (const l of (links.data ?? []) as Link[]) if (!linkLast.has(l.rule)) linkLast.set(l.rule, l);
  const spent = ((cost.data ?? []) as { usd: number }[]).reduce((a, x) => a + Number(x.usd), 0);
  const cap = env().MONTHLY_LLM_CAP_USD;
  const th = "py-1 pr-3 font-normal";
  return (
    <main className="mx-auto max-w-6xl px-4 py-4 space-y-8">
      <Nav />
      <Section title="LLM 비용 (이번 달)">
        <Guide>LLM은 주간 투자위원회 서술에만 씁니다(판정에는 쓰지 않음). 월 상한을 넘으면 호출하지 않고 표·목록만 발행합니다.</Guide>
        <p className={`text-sm ${spent >= cap * 0.8 ? "text-hot" : ""}`}>${spent.toFixed(3)} / 상한 ${cap} ({((spent / cap) * 100).toFixed(0)}%) · {(cost.data ?? []).length}회 호출</p>
      </Section>
      <Section title="배치 잡 (최근 3일)" count={last.size}>
        {last.size ? (
          <div className="table-wrap"><table className="w-full text-sm">
            <thead className="text-xs text-sub text-left"><tr><th className={th}>잡</th><th className={th}>예정</th><th className={th}>마지막 실행</th><th className={th}>결과</th><th className={th}>3일 실행·실패</th><th className={th}>오류</th></tr></thead>
            <tbody>{[...last.values()].sort((a, b) => a.job.localeCompare(b.job)).map((r) => (
              <tr key={r.job} className="border-t border-line/50">
                <td className="py-1 pr-3">{r.job}</td><td className="py-1 pr-3 text-xs">{EXPECT[r.job] ?? "-"}</td><td className="py-1 pr-3 text-xs">{KST(r.started_at)}</td>
                <td className="py-1 pr-3">{r.ok === true ? "✅" : r.ok === false ? "❌" : "⏳"}</td><td className="py-1 pr-3 text-xs">{r.runs} · {r.fails}</td>
                <td className="py-1 pr-3 text-xs text-hot">{r.ok === false ? (r.detail?.error ?? "").slice(0, 120) : ""}</td>
              </tr>))}</tbody>
          </table></div>
        ) : <Empty text="최근 실행 기록이 없습니다." />}
      </Section>
      <Section title="원천 소스" count={(srcs.data ?? []).length}>
        <div className="table-wrap"><table className="w-full text-sm">
          <thead className="text-xs text-sub text-left"><tr><th className={th}>소스</th><th className={th}>마지막 성공</th><th className={th}>연속 실패</th><th className={th}>마지막 오류</th></tr></thead>
          <tbody>{((srcs.data ?? []) as Src[]).map((s) => (
            <tr key={s.source} className="border-t border-line/50">
              <td className="py-1 pr-3">{s.source}</td><td className="py-1 pr-3 text-xs">{KST(s.last_ok_at)}</td>
              <td className={`py-1 pr-3 ${s.consecutive_failures >= 2 ? "text-hot" : ""}`}>{s.consecutive_failures}</td><td className="py-1 pr-3 text-xs">{s.consecutive_failures ? (s.last_error ?? "").slice(0, 120) : ""}</td>
            </tr>))}</tbody>
        </table></div>
      </Section>
      <Section title="링크 점검 (규칙별 마지막 결과)" count={linkLast.size}>
        <div className="table-wrap"><table className="w-full text-sm">
          <thead className="text-xs text-sub text-left"><tr><th className={th}>규칙</th><th className={th}>상태</th><th className={th}>결과</th><th className={th}>점검</th></tr></thead>
          <tbody>{[...linkLast.values()].sort((a, b) => Number(a.ok) - Number(b.ok) || a.rule.localeCompare(b.rule)).map((l) => (
            <tr key={l.rule} className="border-t border-line/50">
              <td className="py-1 pr-3 text-xs">{l.rule}</td><td className="py-1 pr-3 text-xs">{l.status ?? "-"}</td><td className="py-1 pr-3">{l.ok ? "✅" : `❌ ${l.note ?? ""}`}</td><td className="py-1 pr-3 text-xs">{KST(l.checked_at)}</td>
            </tr>))}</tbody>
        </table></div>
      </Section>
      <Footer asOf={kstString()} />
    </main>
  );
}
