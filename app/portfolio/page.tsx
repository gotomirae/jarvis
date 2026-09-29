import { Empty, Footer, Nav, Section } from "@/app/_components/ui";
import { taxonomyConfig } from "@/lib/config/load";
import { fmtWeight } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";
import { kstString } from "@/lib/time";

export const dynamic = "force-dynamic";

type Pos = { asset_id: string; ticker: string; name: string; market: string; entity_id: string | null; asset_class: string; sector: string | null; weight: number | null; allowed_weight: number | null; heat_score: number | null; conviction: number | null; thesis_version: number | null; open_triggers: number | null };
type Axis = { entity_id: string; n_on: boolean; c_on: boolean; f_on: boolean; p_value: number | null; evidence: { F?: { grade?: string | null } } };

/** 포트폴리오 × 신호 (PRD §8) — SnowBall 보유(읽기 전용) + 종목별 축·등급·PRI·과열·비중 vs 허용·M3. 수량·원가는 표시하지 않는다(D26). */
export default async function Portfolio() {
  const sb = await supabaseServer();
  const [hc, lastAxes, heatDate] = await Promise.all([
    sb.from("holdings_cache").select("snapshot_at,payload").order("snapshot_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("axes_daily").select("date").order("date", { ascending: false }).limit(1).maybeSingle(),
    sb.from("industry_heat").select("date").order("date", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const positions = ((hc.data?.payload as { positions?: Pos[] } | undefined)?.positions ?? []).sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
  const ids = positions.map((p) => p.entity_id).filter(Boolean) as string[];
  const [axes, ents, heat, alerts] = await Promise.all([
    lastAxes.data ? sb.from("axes_daily").select("entity_id,n_on,c_on,f_on,p_value,evidence").eq("date", lastAxes.data.date).in("entity_id", ids) : Promise.resolve({ data: [] }),
    ids.length ? sb.from("entities").select("id,l1_codes,primary_l1").in("id", ids) : Promise.resolve({ data: [] }),
    heatDate.data ? sb.from("industry_heat").select("l1,m3_pass").eq("date", heatDate.data.date) : Promise.resolve({ data: [] }),
    sb.from("notifications").select("entity_id").eq("kind", "holding_alert").gte("created_at", new Date(Date.now() - 7 * 86400_000).toISOString()).range(0, 999),
  ]);
  const ax = new Map(((axes.data ?? []) as Axis[]).map((a) => [a.entity_id, a]));
  const el = new Map(((ents.data ?? []) as { id: string; l1_codes: string[]; primary_l1: string | null }[]).map((e) => [e.id, e]));
  const m3 = new Map(((heat.data ?? []) as { l1: string; m3_pass: boolean }[]).map((h) => [h.l1, h.m3_pass]));
  const alerted = new Set(((alerts.data ?? []) as { entity_id: string | null }[]).map((a) => a.entity_id));
  const tx = taxonomyConfig();
  const name = (c: string) => tx.l1.find((r) => r.code === c)?.name ?? c;
  const on = (b: boolean | undefined) => (b ? "●" : "·");

  return (
    <main className="mx-auto max-w-5xl p-4 space-y-5">
      <Nav />
      <Section title="보유 × 신호" count={positions.length}>
        {positions.length === 0 ? <Empty text="holdings_sync 결과가 없습니다." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-neutral-500 text-left">
                <tr><th className="py-1">종목</th><th>L1 · M3</th><th>비중 / 허용</th><th>과열</th><th>N C F</th><th>P</th><th>등급</th><th>논지</th><th /></tr>
              </thead>
              <tbody>
                {positions.map((p) => {
                  const a = p.entity_id ? ax.get(p.entity_id) : undefined;
                  const e = p.entity_id ? el.get(p.entity_id) : undefined;
                  const over = p.weight !== null && p.allowed_weight !== null && p.weight > p.allowed_weight;
                  return (
                    <tr key={p.asset_id} className="border-t border-neutral-100 dark:border-neutral-900">
                      <td className="py-1">
                        {p.entity_id ? <a href={`/stock/${encodeURIComponent(p.entity_id)}`} className="underline decoration-dotted">{p.name}</a> : p.name}
                        <span className="text-xs text-neutral-500"> {p.ticker}{p.asset_class !== "stock" ? ` · ${p.asset_class}` : ""}</span>
                      </td>
                      <td className="text-xs">{e ? e.l1_codes.map((c) => `${name(c)}${m3.get(c) ? "✓" : ""}`).join(" + ") : p.sector ?? "-"}</td>
                      <td className={over ? "text-red-600" : ""}>{fmtWeight(p.weight)} / {fmtWeight(p.allowed_weight)}</td>
                      <td>{p.heat_score ?? "-"}</td>
                      <td className="font-mono">{a ? `${on(a.n_on)} ${on(a.c_on)} ${on(a.f_on)}` : "-"}</td>
                      <td>{a?.p_value !== null && a?.p_value !== undefined ? Math.round(a.p_value) : "-"}</td>
                      <td>{a?.evidence?.F?.grade ?? "-"}</td>
                      <td className="text-xs">{p.thesis_version ? `v${p.thesis_version} · 확신 ${p.conviction ?? "-"}` : "없음"}{p.open_triggers ? ` · 트리거 ${p.open_triggers}` : ""}</td>
                      <td>{p.entity_id && alerted.has(p.entity_id) ? "⚠️" : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      <p className="text-xs text-neutral-500">M1~M5 현황은 P3. 편집·매매 입력은 SnowBall(`/ironman/portfolio`)에서.</p>
      <Footer asOf={hc.data?.snapshot_at ? kstString(new Date(hc.data.snapshot_at)) : undefined} />
    </main>
  );
}
