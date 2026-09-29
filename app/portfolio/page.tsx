import { Empty, Footer, Guide, Nav, Section } from "@/app/_components/ui";
import { taxonomyConfig } from "@/lib/config/load";
import { pLevel } from "@/lib/engine/explain";
import { fmtWeight } from "@/lib/format";
import { yesNo } from "@/lib/labels";
import { supabaseServer } from "@/lib/supabase/server";
import { kstString } from "@/lib/time";

export const dynamic = "force-dynamic";

type Pos = { asset_id: string; ticker: string; name: string; market: string; entity_id: string | null; asset_class: string; sector: string | null; weight: number | null; allowed_weight: number | null; heat_score: number | null; conviction: number | null; thesis_version: number | null; open_triggers: number | null };
type Axis = { entity_id: string; n_on: boolean; c_on: boolean; f_on: boolean; p_value: number | null; evidence: { F?: { grade?: string | null } } };
const CLASS: Record<string, string> = { stock: "주식", etf: "ETF", fund: "펀드" };

/** 내 보유 종목 × 신호 (PRD §8) — SnowBall 보유를 읽기만 한다. 수량·원가는 표시하지 않는다(D26). */
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
  const el = new Map(((ents.data ?? []) as { id: string; l1_codes: string[] }[]).map((e) => [e.id, e]));
  const m3 = new Map(((heat.data ?? []) as { l1: string; m3_pass: boolean }[]).map((h) => [h.l1, h.m3_pass]));
  const alerted = new Set(((alerts.data ?? []) as { entity_id: string | null }[]).map((a) => a.entity_id));
  const tx = taxonomyConfig();
  const name = (c: string) => tx.l1.find((r) => r.code === c)?.name ?? c;
  const th = "py-1 pr-2 font-normal";

  return (
    <main className="mx-auto max-w-6xl p-4 space-y-5">
      <Nav />
      <Section title="내 보유 종목 × 신호" count={positions.length}>
        <Guide>SnowBall 장부를 읽어서 보여 줍니다(편집·매매 입력은 SnowBall). 비중이 허용 비중을 넘으면 빨간색입니다.</Guide>
        <details className="text-xs text-neutral-500">
          <summary className="cursor-pointer">열 설명</summary>
          <ul className="list-disc pl-5 space-y-0.5 mt-1">
            <li><b>산업(고성장 ✓)</b>: 노션 산업 분류. ✓ 는 실제 실적·증권사 전망·시장 전망 중 하나 이상에서 15% 이상 성장이 확인된 산업</li>
            <li><b>과열 점수</b>: SnowBall이 계산한 과열 정도(0~100, 76 이상이면 익절 검토 대상)</li>
            <li><b>산업·종목 이야기</b>: FlyWheel 산업 흐름·위키 언급 또는 Sage 멘토 합의가 켜짐</li>
            <li><b>실적 촉매</b>: HermesCall 미국 실적 수혜 강도 7 이상 또는 미국 기업 가이던스·서프라이즈</li>
            <li><b>실적 숫자</b>: Heimdallr 게이트 통과 + 점수 75 이상(미국은 성장 가속·이익률 개선)</li>
            <li><b>주가 반영도</b>: 0~100, 낮을수록 좋은 실적이 주가에 덜 반영됨(40 미만 덜 반영 · 65 이상 많이 반영)</li>
          </ul>
        </details>
        {positions.length === 0 ? <Empty text="보유 동기화 결과가 없습니다." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-neutral-500 text-left">
                <tr><th className={th}>종목</th><th className={th}>산업 (고성장 ✓)</th><th className={th}>비중 / 허용 비중</th><th className={th}>과열 점수</th>
                  <th className={th}>산업·종목 이야기</th><th className={th}>실적 촉매</th><th className={th}>실적 숫자</th><th className={th}>주가 반영도</th><th className={th}>Heimdallr 등급</th><th className={th}>투자 논지</th><th className={th}>경고</th></tr>
              </thead>
              <tbody>
                {positions.map((p) => {
                  const a = p.entity_id ? ax.get(p.entity_id) : undefined;
                  const e = p.entity_id ? el.get(p.entity_id) : undefined;
                  const over = p.weight !== null && p.allowed_weight !== null && p.weight > p.allowed_weight;
                  const pv = a?.p_value ?? null;
                  return (
                    <tr key={p.asset_id} className="border-t border-neutral-100 dark:border-neutral-900 align-top">
                      <td className="py-1 pr-2">
                        {p.entity_id ? <a href={`/stock/${encodeURIComponent(p.entity_id)}`} className="underline decoration-dotted">{p.name}</a> : p.name}
                        <span className="block text-xs text-neutral-500">{p.ticker}{p.asset_class !== "stock" ? ` · ${CLASS[p.asset_class] ?? p.asset_class}` : ""}</span>
                      </td>
                      <td className="pr-2">{e ? e.l1_codes.map((c) => `${name(c)}${m3.get(c) ? " ✓" : ""}`).join(" + ") : p.sector ?? "-"}</td>
                      <td className={`pr-2 ${over ? "text-red-600 font-medium" : ""}`}>{fmtWeight(p.weight)} / {fmtWeight(p.allowed_weight)}</td>
                      <td className="pr-2">{p.heat_score ?? "-"}</td>
                      <td className="pr-2">{a ? yesNo(a.n_on) : "-"}</td>
                      <td className="pr-2">{a ? yesNo(a.c_on) : "-"}</td>
                      <td className="pr-2">{a ? yesNo(a.f_on) : "-"}</td>
                      <td className="pr-2">{pv !== null ? `${Math.round(pv)} (${pLevel(pv)})` : "-"}</td>
                      <td className="pr-2">{a?.evidence?.F?.grade ?? "-"}</td>
                      <td className="pr-2 text-xs">{p.thesis_version ? `${p.thesis_version}번째 판 · 확신도 ${p.conviction ?? "-"}` : "없음"}{p.open_triggers ? ` · 대기 트리거 ${p.open_triggers}` : ""}</td>
                      <td>{p.entity_id && alerted.has(p.entity_id) ? "⚠️" : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      <p className="text-xs text-neutral-500">진입 필수 조건 5가지 현황은 다음 단계(Heimdallr·HermesCall 연계 후)에서 추가됩니다.</p>
      <Footer asOf={hc.data?.snapshot_at ? kstString(new Date(hc.data.snapshot_at)) : undefined} />
    </main>
  );
}
