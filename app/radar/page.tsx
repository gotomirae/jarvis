import { Empty, Footer, Guide, Nav, Section } from "@/app/_components/ui";
import { taxonomyConfig } from "@/lib/config/load";
import { fmtPct } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";
import { kstString } from "@/lib/time";

export const dynamic = "force-dynamic";

type Heat = { l1: string; n_score: number | null; c_score: number | null; sentiment: number | null; m3_pass: boolean | null; m3_median_rev_yoy_q0: number | null; m3_basis: { bases?: Record<string, boolean> } | null; basket_ret_1w: number | null; basket_ret_1m: number | null };
type Sig = { kind: string; source: string; l1_codes: string[]; entity_id: string | null };
type Q = { entity_id: string; queue: string };

const BASIS: Record<string, string> = { realized: "실적", us_major_broker: "증권사", outlook: "전망" };
const tone = (v: number | null, hi: number, mid: number) => (v === null ? "" : v >= hi ? "bg-emerald-100 dark:bg-emerald-950" : v >= mid ? "bg-amber-50 dark:bg-amber-950" : "");

/** 산업 레이더 (PRD §8 /radar) — 노션 산업 18개: 고성장 근거 3종 · 산업 흐름 강도 · 신호 수 · 바스켓 성과 · 큐 종목 수. 보기 전용 */
export default async function Radar() {
  const sb = await supabaseServer();
  const tx = taxonomyConfig();
  const last = await sb.from("industry_heat").select("date").order("date", { ascending: false }).limit(1).maybeSingle();
  const since = new Date(Date.now() - 14 * 86400_000).toISOString();
  const qd = await sb.from("queue_items").select("date").order("date", { ascending: false }).limit(1).maybeSingle();
  const [heat, sigs, qs, ents] = await Promise.all([
    last.data ? sb.from("industry_heat").select("l1,n_score,c_score,sentiment,m3_pass,m3_median_rev_yoy_q0,m3_basis,basket_ret_1w,basket_ret_1m").eq("date", last.data.date) : Promise.resolve({ data: [] }),
    sb.from("signals").select("kind,source,l1_codes,entity_id").gte("observed_at", since).range(0, 4999),
    qd.data ? sb.from("queue_items").select("entity_id,queue").eq("date", qd.data.date).range(0, 999) : Promise.resolve({ data: [] }),
    sb.from("entities").select("id,primary_l1").range(0, 4999),
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
  const th = "py-1 pr-3 font-normal";
  return (
    <main className="mx-auto max-w-6xl p-4 space-y-6">
      <Nav />
      <Section title="산업 레이더 (노션 산업 18개)">
        <Guide>고성장 = 실제 실적·미국 대형 증권사 전망·전망 자료 중 하나라도 15% 이상. 산업 흐름 강도는 FlyWheel 신호(0~10). 신호 수는 최근 14일 출처별 건수, 큐는 최신 판정의 매수 검토·선행 레이더·보유 경고 종목 수. 바스켓은 국내 동일가중(주간 투자위원회가 매주 갱신).</Guide>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-neutral-500 text-left"><tr>
                <th className={th}>산업</th><th className={th}>고성장</th><th className={th}>근거</th><th className={th}>실적 매출 중앙값</th><th className={th}>흐름 강도</th><th className={th}>실적 촉매</th>
                <th className={th}>FlyWheel·Sage·HermesCall·Heimdallr 신호</th><th className={th}>🎯·🔭·⚠️</th><th className={th}>바스켓 1주·1개월</th>
              </tr></thead>
              <tbody>
                {rows.map(({ r, h, s, q }) => (
                  <tr key={r.code} className="border-t border-neutral-100 dark:border-neutral-900">
                    <td className="py-1 pr-3">{r.name}</td>
                    <td className="py-1 pr-3">{h?.m3_pass ? "✅" : "—"}</td>
                    <td className="py-1 pr-3 text-xs">{Object.entries(h?.m3_basis?.bases ?? {}).filter(([, v]) => v).map(([k]) => BASIS[k] ?? k).join("·") || "-"}</td>
                    <td className="py-1 pr-3">{fmtPct(h?.m3_median_rev_yoy_q0 ?? null)}</td>
                    <td className={`py-1 pr-3 ${tone(h?.n_score ?? null, 8, 5)}`}>{h?.n_score ?? "-"}</td>
                    <td className={`py-1 pr-3 ${tone(h?.c_score ?? null, 8, 5)}`}>{h?.c_score ?? "-"}</td>
                    <td className="py-1 pr-3 text-xs">{["flywheel", "sage", "hermescall", "heimdallr"].map((k) => s[k] ?? 0).join(" · ")}</td>
                    <td className="py-1 pr-3 text-xs">{[q.buy ?? 0, q.radar ?? 0, q.holding_alert ?? 0].join(" · ")}</td>
                    <td className="py-1 pr-3 text-xs">{fmtPct(h?.basket_ret_1w ?? null)} · {fmtPct(h?.basket_ret_1m ?? null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty text="산업 판정 자료가 없습니다." />}
      </Section>
      <Footer asOf={last.data ? `${last.data.date} 판정 · ${kstString()}` : kstString()} />
    </main>
  );
}
