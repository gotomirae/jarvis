import { Empty, Footer, Guide, Hi, Nav, Page, Pct, Section, Stat } from "@/app/_components/ui";
import { DIMENSION_NAME } from "@/lib/engine/feedback";
import { bucketTitle, type Policy, type Rule } from "@/lib/engine/pick-policy";
import { VERDICT_SHORT, type Verdict } from "@/lib/engine/timing";
import { rules } from "@/lib/jobs/context";
import { supabaseServer } from "@/lib/supabase/server";
import { kstString } from "@/lib/time";

export const dynamic = "force-dynamic";

type Led = { id: number; entity_id: string | null; market: "KR" | "US"; tag: string; signal_date: string; entry_date: string | null; entry_price: number | null; payload: { picked?: boolean; rank?: number | null; brief?: string; features?: { timing?: { score: number; verdict: string } | null } | null } };
type Out = { ledger_id: number; horizon_days: number; ret_pct: number; excess_pct: number | null };
type Stat = { scope: string; dimension: string; bucket: string; horizon_days: number; n: number; median_excess: number | null; hit_rate: number | null };
type PolicyState = { policy?: Policy; history?: { as_of: string; added: string[]; removed: string[] }[]; at?: string };

const PAGE = 1000;
const KIND: Record<string, Rule["kind"]> = { timing_verdict: "verdict", timing_check: "check", timing_score: "score" };

/** 사후 검증 (D54) — 텔레그램 🎯 추천 종목을 빠짐없이 D+5·20·40·60 으로 채점하고, 승률이 높은 추천 기준을 찾아 다음 추천에 반영한다. 보기 전용 */
export default async function Verify() {
  const sb = await supabaseServer();
  const R = rules();
  const H = R.outcomes.horizons_days;
  const P = R.feedback.primary_horizon;

  // 원장(pick) — PostgREST 1,000행 제한 → 페이징 (불변 규칙 11)
  const led: Led[] = [];
  for (let i = 0; ; i += PAGE) {
    const r = await sb.from("signal_ledger").select("id,entity_id,market,tag,signal_date,entry_date,entry_price,payload").eq("event_type", "pick").order("signal_date", { ascending: false }).order("id").range(i, i + PAGE - 1);
    led.push(...((r.data ?? []) as Led[]));
    if (!r.data || r.data.length < PAGE) break;
  }
  const outs: Out[] = [];
  const ids = led.map((l) => l.id);
  for (let i = 0; i < ids.length; i += 200) {
    const r = await sb.from("outcomes").select("ledger_id,horizon_days,ret_pct,excess_pct").in("ledger_id", ids.slice(i, i + 200)).range(0, PAGE - 1);
    outs.push(...((r.data ?? []) as Out[]));
  }
  const last = await sb.from("perf_stats").select("as_of").order("as_of", { ascending: false }).limit(1).maybeSingle();
  const [st, pol, ents] = await Promise.all([
    last.data ? sb.from("perf_stats").select("scope,dimension,bucket,horizon_days,n,median_excess,hit_rate").eq("as_of", last.data.as_of).in("scope", ["pick", R.pick_policy.scope]).range(0, 4999) : Promise.resolve({ data: [] }),
    sb.from("bot_state").select("value").eq("key", "pick_policy").maybeSingle(),
    sb.from("entities").select("id,name,symbol").in("id", [...new Set(led.map((l) => l.entity_id).filter(Boolean))] as string[]),
  ]);
  const stats = (st.data ?? []) as Stat[];
  const ps = (pol.data?.value ?? {}) as PolicyState;
  const policy = ps.policy ?? null;
  const name = new Map(((ents.data ?? []) as { id: string; name: string; symbol: string }[]).map((e) => [e.id, e]));
  const outBy = new Map<number, Map<number, Out>>();
  for (const o of outs) (outBy.get(o.ledger_id) ?? outBy.set(o.ledger_id, new Map()).get(o.ledger_id)!).set(o.horizon_days, o);

  const top = led.filter((l) => l.payload.picked);
  const cand = led.filter((l) => !l.payload.picked);
  const get = (scope: string, h: number) => stats.find((s) => s.scope === scope && s.dimension === "all" && s.bucket === "all" && s.horizon_days === h);
  const pickP = get("pick", P), allP = get(R.pick_policy.scope, P);
  const measured = top.filter((l) => outBy.get(l.id)?.has(P)).length;
  const excl = new Set((policy?.exclude ?? []).map((x) => `${x.kind}|${x.bucket}`));
  const pref = new Set((policy?.prefer ?? []).map((x) => `${x.kind}|${x.bucket}`));
  const crit = stats.filter((s) => s.scope === R.pick_policy.scope && s.horizon_days === P && KIND[s.dimension])
    .sort((a, b) => a.dimension.localeCompare(b.dimension) || (b.hit_rate ?? -1) - (a.hit_rate ?? -1));
  const hit = (s?: Stat) => (s?.hit_rate == null ? "측정 중" : `${Math.round(s.hit_rate * 100)}%`);
  const th = "py-2 pr-3 text-left";

  const row = (l: Led) => {
    const e = l.entity_id ? name.get(l.entity_id) : undefined;
    const t = l.payload.features?.timing;
    const o = outBy.get(l.id);
    const main = o?.get(P);
    const res = !main || main.excess_pct === null ? <span className="text-sub">⏳ 측정 중</span> : main.excess_pct > 0 ? <b className="text-good">✅ 승</b> : <b className="text-hot">❌ 패</b>;
    return (
      <tr key={l.id} className="border-t border-line/50 align-top">
        <td className="py-2 pr-3 whitespace-nowrap">{l.signal_date.slice(5).replace("-", "/")}<div className="text-xs text-sub">{l.payload.brief === "brief_morning" ? "☀️ 아침" : l.payload.brief === "brief_evening" ? "🌙 저녁" : ""}{l.payload.rank ? ` #${l.payload.rank}` : ""}</div></td>
        <td className="py-2 pr-3">{l.entity_id ? <a className="link" href={`/stock/${encodeURIComponent(l.entity_id)}`}>{l.market === "US" ? "🇺🇸" : "🇰🇷"} {e?.name ?? l.entity_id}</a> : "-"}</td>
        <td className="py-2 pr-3 whitespace-nowrap">{t ? <span className={t.verdict === "high" ? "text-hot font-semibold" : t.verdict === "mid" ? "text-gold font-semibold" : "text-sub"}>{VERDICT_SHORT[t.verdict as Verdict] ?? t.verdict} {t.score > 0 ? "+" : ""}{t.score}</span> : <span className="text-sub">기록 전</span>}</td>
        <td className="py-2 pr-3 tabular-nums">{l.entry_price === null ? <span className="text-sub">대기</span> : l.market === "KR" ? `${Math.round(l.entry_price).toLocaleString("en-US")}원` : `$${Number(l.entry_price).toFixed(2)}`}</td>
        {H.map((h) => { const x = o?.get(h); return <td key={h} className="py-2 pr-3">{x ? <><Pct v={x.excess_pct} arrow={false} /><div className="text-xs text-sub">주가 {x.ret_pct > 0 ? "+" : ""}{Number(x.ret_pct).toFixed(1)}%</div></> : <span className="text-sub">-</span>}</td>; })}
        <td className="py-2 pr-3 whitespace-nowrap">{res}</td>
      </tr>
    );
  };
  const table = (xs: Led[]) => (
    <div className="overflow-x-auto glass rounded-xl px-3">
      <table className="w-full text-sm">
        <thead><tr><th className={th}>추천일</th><th className={th}>종목</th><th className={th}>⏱️ 매수 매력</th><th className={th}>진입가</th>{H.map((h) => <th key={h} className={th}>{h}거래일 뒤 (시장 대비)</th>)}<th className={th}>{P}일 판정</th></tr></thead>
        <tbody>{xs.map(row)}</tbody>
      </table>
    </div>
  );

  return (
    <Page wide>
      <Nav />
      <div className="flex flex-wrap gap-3">
        <Stat icon="📨" label="텔레그램 추천" value={`${top.length}건`} sub={`미추천 후보 ${cand.length}건도 함께 채점`} />
        <Stat icon="✅" label={`추천 승률 (${P}거래일)`} value={hit(pickP)} tone="good" sub={`측정 완료 ${measured}건`} />
        <Stat icon="📊" label="시장 대비 초과수익 (중앙값)" value={pickP?.median_excess == null ? "-" : `${pickP.median_excess > 0 ? "+" : ""}${pickP.median_excess.toFixed(1)}%`} tone={pickP?.median_excess != null && pickP.median_excess < 0 ? "hot" : "good"} sub={`${P}거래일 뒤`} />
        <Stat icon="🧪" label="후보 전체 승률" value={hit(allP)} tone="arc" sub="추천 기준이 효과 있으면 추천 승률이 더 높아야 함" />
      </div>

      <Section title="📏 채점 방법">
        <Guide>
          텔레그램 아침·저녁 브리핑의 🎯 <b className="text-white">매수 검토 후보 전체</b>를 매일 20:00에 채점합니다. 진입가 = 추천 <Hi>다음 거래일 종가</Hi>, 기준 = 국내 KOSPI·KOSDAQ / 미국 S&amp;P 500.
          {P}거래일 뒤 <Hi>시장보다 더 올랐으면 승</Hi>입니다. 추천하지 않은 후보도 똑같이 채점해 &quot;추천 기준이 실제로 승률을 높였는지&quot;를 비교합니다.
        </Guide>
      </Section>

      <Section title="📐 지금 적용 중인 추천 기준" count={(policy?.exclude.length ?? 0) + 1}>
        <ul className="space-y-2 text-sm">
          <li className="glass rounded-lg px-3 py-2">🧱 <b className="text-gold">기본 기준</b> — ⏱️ 지금 매수 매력이 <b className="text-white">{R.pick_policy.base_exclude_verdicts.map((v) => VERDICT_SHORT[v]).join(" · ")}</b> 이면 추천하지 않음 (점수 {R.buy_timing.verdict.mid_min} 미만)</li>
          {(policy?.exclude ?? []).map((x) => (
            <li key={x.title} className="glass rounded-lg px-3 py-2 border-l-4 border-l-hot">
              🚫 <b className="text-hot">{x.title}</b> → TOP 추천에서 {policy?.applied ? <b className="text-white">자동 제외 중</b> : "제외 제안(미적용)"}
              <div className="text-xs text-sub mt-0.5">{x.evidence}</div>
            </li>
          ))}
          {(policy?.prefer ?? []).map((x) => (
            <li key={x.title} className="glass rounded-lg px-3 py-2 border-l-4 border-l-good">
              ⭐ <b className="text-good">{x.title}</b> → 승률 높음, 추천 순위에 가중
              <div className="text-xs text-sub mt-0.5">{x.evidence}</div>
            </li>
          ))}
        </ul>
        {!policy?.exclude.length && !policy?.prefer.length && <Empty text={`아직 기준을 바꿀 만큼 표본이 쌓이지 않았습니다 — 구간별 ${R.pick_policy.min_samples}건이 넘으면 승률 ${Math.round(R.pick_policy.target_hit_rate * 100)}% 미만 구간을 자동으로 뺍니다.`} />}
        {ps.history?.length ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-arc">🗓️ 기준 변경 이력 ({ps.history.length})</summary>
            <ul className="mt-2 space-y-1">{ps.history.map((h) => <li key={h.as_of}>{h.as_of} · {h.added.map((a) => <span key={a} className="text-hot mr-2">+ {a}</span>)}{h.removed.map((a) => <span key={a} className="text-good mr-2">− {a} (해제)</span>)}</li>)}</ul>
          </details>
        ) : null}
      </Section>

      <Section title={`🔬 기준별 승률 — ${P}거래일 뒤 (후보 전체)`} count={crit.length}>
        <Guide>어떤 근거가 실제로 통했는지 보여 줍니다. 표본 <Hi>{R.pick_policy.min_samples}건 이상</Hi> 구간만 기준 수립에 씁니다(우연 방지). 목표 승률 <Hi>{Math.round(R.pick_policy.target_hit_rate * 100)}%</Hi>.</Guide>
        {crit.length === 0 ? <Empty text="아직 측정이 끝난 후보가 없습니다 — 첫 결과는 추천 후 약 1주(5거래일) 뒤부터 나옵니다." /> : (
          <div className="overflow-x-auto glass rounded-xl px-3">
            <table className="w-full text-sm">
              <thead><tr><th className={th}>기준</th><th className={th}>구간</th><th className={th}>승률</th><th className={th}>시장 대비 중앙값</th><th className={th}>건수</th><th className={th}>상태</th></tr></thead>
              <tbody>{crit.map((s) => {
                const k = `${KIND[s.dimension]}|${s.bucket}`;
                return (
                  <tr key={`${s.dimension}|${s.bucket}`} className="border-t border-line/50">
                    <td className="py-2 pr-3">{DIMENSION_NAME[s.dimension] ?? s.dimension}</td>
                    <td className="py-2 pr-3 font-semibold">{bucketTitle(KIND[s.dimension], s.bucket)}</td>
                    <td className={`py-2 pr-3 font-bold ${s.hit_rate == null ? "text-sub" : s.hit_rate >= R.pick_policy.target_hit_rate ? "text-good" : "text-hot"}`}>{hit(s)}</td>
                    <td className="py-2 pr-3"><Pct v={s.median_excess} arrow={false} /></td>
                    <td className="py-2 pr-3 tabular-nums">{s.n}</td>
                    <td className="py-2 pr-3">{excl.has(k) ? <b className="text-hot">🚫 제외</b> : pref.has(k) ? <b className="text-good">⭐ 우수</b> : s.n < R.pick_policy.min_samples ? <span className="text-sub">표본 부족</span> : <span>보통</span>}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="📨 텔레그램 추천 종목 채점표" count={top.length}>
        <Guide>숫자는 <Hi>시장 대비 초과수익</Hi>(주가 수익률 − 지수 수익률), 아래 작은 글씨는 주가 자체 수익률입니다. 상승 빨강 · 하락 파랑.</Guide>
        {top.length === 0 ? <Empty text="아직 기록된 추천이 없습니다 — 다음 브리핑부터 기록됩니다." /> : table(top)}
      </Section>

      <Section title="🧪 추천하지 않은 후보 (비교용)" count={cand.length}>
        {cand.length === 0 ? <Empty text="없음" /> : <details><summary className="cursor-pointer text-arc text-sm">펼쳐 보기</summary><div className="mt-2">{table(cand.slice(0, 300))}</div></details>}
      </Section>
      <Footer asOf={last.data ? `${last.data.as_of} 성과 · 기준 갱신 ${ps.at ? kstString(new Date(ps.at)) : "-"}` : kstString()} />
    </Page>
  );
}
