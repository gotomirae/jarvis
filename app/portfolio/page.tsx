import { Bad, Card, Empty, Footer, Guide, Hi, Nav, Section } from "@/app/_components/ui";
import { taxonomyConfig } from "@/lib/config/load";
import { pLevel } from "@/lib/engine/explain";
import { regionLine, regionMix } from "@/lib/engine/portfolio-policy";
import { rules } from "@/lib/jobs/context";
import { fmtWeight } from "@/lib/format";
import { yesNo } from "@/lib/labels";
import { supabaseServer } from "@/lib/supabase/server";
import { kstString } from "@/lib/time";

export const dynamic = "force-dynamic";

type Pos = { asset_id: string; ticker: string; name: string; market: string; entity_id: string | null; asset_class: string; sector: string | null; weight: number | null; allowed_weight: number | null; heat_score: number | null; conviction: number | null; thesis_version: number | null; open_triggers: number | null };
type Axis = { entity_id: string; n_on: boolean; c_on: boolean; f_on: boolean; p_value: number | null; evidence: { F?: { grade?: string | null } } };
const CLASS: Record<string, string> = { stock: "주식", etf: "ETF", fund: "펀드" };

/** 🦾 아이언맨의 포트폴리오 × 신호 (PRD §8, 10/5 이름 변경) — 맨 위에 ⚠️ 보유 경고(10/8 오늘 탭에서 이동) — SnowBall 보유를 읽기만 한다. 수량·원가는 표시하지 않는다(D26). */
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
    sb.from("notifications").select("entity_id,payload,sent_at,created_at").eq("kind", "holding_alert").gte("created_at", new Date(Date.now() - 7 * 86400_000).toISOString()).order("created_at", { ascending: false }).range(0, 999),
  ]);
  const ax = new Map(((axes.data ?? []) as Axis[]).map((a) => [a.entity_id, a]));
  const el = new Map(((ents.data ?? []) as { id: string; l1_codes: string[] }[]).map((e) => [e.id, e]));
  const m3 = new Map(((heat.data ?? []) as { l1: string; m3_pass: boolean }[]).map((h) => [h.l1, h.m3_pass]));
  type Alert = { entity_id: string | null; payload: { name?: string; summary?: string; source?: string; bootstrap?: boolean; asset_id?: string }; sent_at: string | null };
  const alertRows = (alerts.data ?? []) as Alert[];
  const alerted = new Set(alertRows.map((a) => a.entity_id));
  // 보유 경고: 종목별로 묶어서 (🏠 오늘 탭에서 이동, 10/8)
  const alertBy = new Map<string, { name: string; entity_id: string | null; lines: { summary: string; source: string; when: string }[] }>();
  for (const a of alertRows) {
    const p = a.payload ?? {};
    const k = a.entity_id ?? p.asset_id ?? p.name ?? "-";
    const cur = alertBy.get(k) ?? alertBy.set(k, { name: p.name ?? k, entity_id: a.entity_id, lines: [] }).get(k)!;
    cur.lines.push({ summary: p.summary ?? "", source: p.source ?? "", when: a.sent_at ? `알림 ${kstString(new Date(a.sent_at))}` : p.bootstrap ? "처음 실행 때 기록(알림 안 보냄)" : "미발송" });
  }
  const tx = taxonomyConfig();
  const name = (c: string) => tx.l1.find((r) => r.code === c)?.name ?? c;
  const th = "py-1 pr-2 font-normal";
  // 포트폴리오 정책(사용자 지정 10/8, SnowBall D-71): 종목 상한 글로벌 시총 20위 25% · 미국 10% · 국내 10%, 해외 비중 50~60%
  const PP = rules().portfolio_policy;
  const mix = regionMix(positions.map((p) => ({ market: p.market, weight: p.weight })), PP);
  const pc = (x: number) => `${Math.round(x * 100)}%`;

  return (
    <main className="mx-auto max-w-6xl px-4 py-4 space-y-8">
      <Nav />
      <Section title="⚠️ 보유 경고 (최근 7일)" count={alertBy.size}>
        <Guide items={[<>📉 고점 대비 <b className="text-hot">−20% 이하 하락</b></>, <>⚖️ <b className="text-hot">허용 비중 초과</b></>, "💔 투자 논지를 깨는 이벤트 · 등급 하락"]}>보유 종목의 위험 신호를 종목별로 묶었습니다.</Guide>
        {alertBy.size === 0 ? <Empty text="없음 — 보유 종목에 새 위험 신호가 없습니다." /> : [...alertBy.entries()].map(([k, v]) => (
          <Card key={k} tone="warn">
            <p className="text-base font-bold">{v.entity_id ? <a href={`/stock/${encodeURIComponent(v.entity_id)}`} className="link">{v.name}</a> : v.name}</p>
            <ul className="space-y-1">{v.lines.map((l, i) => <li key={i}>🔸 <Bad>{l.summary}</Bad> <span className="text-xs text-sub">— {l.source} · {l.when}</span></li>)}</ul>
            <p className="text-sm">👉 할 일: <Hi>투자 논지 다시 보기 → SnowBall에 결정 기록</Hi></p>
          </Card>
        ))}
      </Section>
      <Section title="🦾 아이언맨의 포트폴리오" count={positions.length}>
        <div className={`glass rounded-xl border-l-4 ${mix?.status === "within" ? "border-l-good" : "border-l-hot"} px-4 py-3 text-sm space-y-1`}>
          <p className="font-bold">📐 포트폴리오 정책</p>
          <p className={mix?.status === "within" ? "text-good font-semibold" : "text-hot font-semibold"}>{regionLine(mix, PP)}</p>
          <p>⚖️ 종목당 동적 허용 상한 — <b className="text-gold">글로벌 시총 20위 {pc(PP.tier_caps.global_top20)}</b> · 미국 {pc(PP.tier_caps.us)} · 국내 {pc(PP.tier_caps.kr)} <span className="text-sub">(주식 포트폴리오 대비 · SnowBall이 계산한 값을 아래 표에 표시)</span></p>
        </div>
        <Guide items={["❄️ SnowBall 장부를 읽어서 표시 (편집 · 매매 입력은 SnowBall)", <>🔴 비중이 <b className="text-hot">허용 비중을 넘으면 빨간색</b></>, "⚠️ 최근 7일 보유 경고가 있으면 맨 오른쪽 표시"]} />
        <details className="glass rounded-lg px-3 py-2 text-sm">
          <summary className="cursor-pointer text-arc whitespace-nowrap">📖 열 설명 보기</summary>
          <ul className="space-y-1 mt-2">
            <li>🌱 <b className="text-gold">산업 (고성장 ✓)</b> — 실적 · 증권사 · 시장 전망 중 하나라도 15% 이상 성장</li>
            <li>🔥 <b className="text-gold">과열 점수</b> — SnowBall 계산 0~100, 76 이상이면 익절 검토</li>
            <li>📣 <b className="text-gold">산업 · 종목 이야기</b> — FlyWheel 산업 흐름 · 위키 언급, Sage 멘토 합의</li>
            <li>⚡ <b className="text-gold">실적 촉매</b> — HermesCall 미국 실적 수혜 7 이상 · 가이던스 · 서프라이즈</li>
            <li>📊 <b className="text-gold">실적 숫자</b> — Heimdallr 게이트 통과 + 점수 75 이상 (미국: 성장 가속 · 이익률 개선) <b className="text-good">또는</b> 영업이익 흑자 전환 + 매출 증가(턴어라운드)</li>
            <li>🎚️ <b className="text-gold">주가 반영도</b> — 0~100, 낮을수록 실적이 주가에 덜 반영 (40 미만 덜 · 65 이상 많이)</li>
          </ul>
        </details>
        {positions.length === 0 ? <Empty text="보유 동기화 결과가 없습니다." /> : (
          <div className="table-wrap">
            <table className="w-full text-sm">
              <thead className="text-xs text-sub text-left">
                <tr><th className={th}>종목</th><th className={th}>산업 (고성장 ✓)</th><th className={th}>비중 / 허용 비중</th><th className={th}>과열 점수</th>
                  <th className={th}>산업 · 종목 이야기</th><th className={th}>실적 촉매</th><th className={th}>실적 숫자</th><th className={th}>주가 반영도</th><th className={th}>Heimdallr 등급</th><th className={th}>투자 논지</th><th className={th}>경고</th></tr>
              </thead>
              <tbody>
                {positions.map((p) => {
                  const a = p.entity_id ? ax.get(p.entity_id) : undefined;
                  const e = p.entity_id ? el.get(p.entity_id) : undefined;
                  const over = p.weight !== null && p.allowed_weight !== null && p.weight > p.allowed_weight;
                  const pv = a?.p_value ?? null;
                  return (
                    <tr key={p.asset_id} className="border-t border-line/50 align-top">
                      <td className="py-1 pr-2">
                        {p.entity_id ? <a href={`/stock/${encodeURIComponent(p.entity_id)}`} className="link">{p.name}</a> : p.name}
                        <span className="block text-xs text-sub">{p.ticker}{p.asset_class !== "stock" ? ` · ${CLASS[p.asset_class] ?? p.asset_class}` : ""}</span>
                      </td>
                      <td className="pr-2">{e ? e.l1_codes.map((c) => `${name(c)}${m3.get(c) ? " ✓" : ""}`).join(" + ") : p.sector ?? "-"}</td>
                      <td className={`pr-2 ${over ? "text-hot font-medium" : ""}`}>{fmtWeight(p.weight)} / {fmtWeight(p.allowed_weight)}</td>
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
      <Footer asOf={hc.data?.snapshot_at ? kstString(new Date(hc.data.snapshot_at)) : undefined} />
    </main>
  );
}
