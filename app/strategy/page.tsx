import type { ReactNode } from "react";
import { PathChart } from "@/app/_components/charts";
import { Card, Empty, Footer, Guide, Nav, Page, Section } from "@/app/_components/ui";
import { taxonomyConfig } from "@/lib/config/load";
import { rules } from "@/lib/jobs/context";
import { loadStrategy, precedentCharts, strategyMonths, type StrategyEvent } from "@/lib/dashboard/strategy";
import { kstDate } from "@/lib/time";

export const dynamic = "force-dynamic";

const TONE = { gold: "text-gold", good: "text-good", hot: "text-hot", cool: "text-cool", warn: "text-warn", arc: "text-arc" } as const;
const BORDER = { gold: "border-gold/60", good: "border-good/60", hot: "border-hot/60", cool: "border-cool/60", warn: "border-warn/60", arc: "border-arc/60" } as const;
const BAR = { gold: "bg-gold", good: "bg-good", hot: "bg-hot", cool: "bg-cool", warn: "bg-warn", arc: "bg-arc" } as const;
const ym = (m: string) => `${m.slice(0, 4)}년 ${Number(m.slice(5, 7))}월`;
const pct = (v: number | null) => (v === null ? "-" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);

/** 📅 월간 투자 전략 (D63) — 매크로·산업·기업 이벤트 6개월 달력 + 핵심 전략 + 과거 사례. 표시 전용(판정 미사용) */
export default async function StrategyPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  const months = strategyMonths();
  const pick = m && months.includes(m) ? m : months[0];
  const s = pick ? loadStrategy(pick) : null;
  if (!s) {
    return (
      <Page wide>
        <Nav />
        <Empty text="아직 발행된 월간 전략이 없습니다." />
        <Footer />
      </Page>
    );
  }
  const charts = await precedentCharts(s);
  const l1 = new Map(taxonomyConfig().l1.map((x) => [x.code, x.name]));
  const nowYm = kstDate().slice(0, 7);
  const PP = rules().portfolio_policy;
  const pc = (x: number) => `${Math.round(x * 100)}%`;
  const TERM = { "3m": "⏱️ 3개월", "6m": "🗓️ 6개월" } as const;
  const groups = s.plans?.length ? (["3m", "6m"] as const).map((k) => ({ k, xs: s.strategies.filter((x) => (x.term ?? "6m") === k) })).filter((g) => g.xs.length) : [{ k: null, xs: s.strategies }];

  return (
    <Page wide>
      <Nav />

      {months.length > 1 && (
        <div className="flex flex-wrap gap-2 text-sm">
          {months.map((x) => <a key={x} href={`/strategy?m=${x}`} className={`rounded-full border px-3 py-1 ${x === pick ? "border-gold bg-gold/15 text-gold font-bold" : "border-line hover:border-arc hover:text-arc"}`}>📅 {ym(x)}호</a>)}
        </div>
      )}

      <div className="glass rounded-2xl border-l-4 border-l-gold p-5 space-y-3">
        <p className="text-sm text-sub">📅 <b className="text-gold">{ym(s.month)}호</b> · 대상 기간 <b className="text-white">{s.horizon}</b> · 작성 {s.as_of}</p>
        <h1 className="text-2xl font-extrabold leading-snug">{s.title}</h1>
        <ul className="space-y-1.5">{s.headline.map((h, i) => <li key={i} className={i === s.headline.length - 1 ? "font-bold text-gold" : ""}>{h}</li>)}</ul>
        <div className="flex flex-wrap gap-2 pt-1">
          {s.stance.map((x) => (
            <span key={x.label} className={`rounded-lg border ${BORDER[x.tone]} bg-panel2/70 px-3 py-1.5 text-sm`}>
              <span className="text-sub">{x.label}</span> <b className={TONE[x.tone]}>{x.value}</b>
            </span>
          ))}
        </div>
      </div>

      <Section title="🌡️ 지금 시장 (작성일 기준)">
        <Guide items={["작성일 종가 기준 — 실시간 값은 🏠 오늘 탭", <>🔴 빨강 = 오른 것 · 🔵 파랑 = 빠진 것 · 🟠 주황 = 부담 요인</>]} />
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          {s.snapshot.map((x) => (
            <div key={x.label} className="glass rounded-xl px-3 py-2">
              <div className="text-xs text-sub">{x.label}</div>
              <div className={`text-xl font-extrabold tabular-nums ${TONE[x.tone]}`}>{x.value}</div>
              <div className="text-xs text-sub leading-snug">{x.note}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="🧭 6개월 시나리오" count={s.scenarios.length}>
        <Guide items={["확률은 작성자 판단 — 매월 다시 매긴다", "어느 쪽으로 가는지는 아래 ✅ 점검표 숫자로 확인"]} />
        <div className="grid gap-3 md:grid-cols-3">
          {s.scenarios.map((x) => (
            <div key={x.name} className={`glass rounded-xl border-t-4 ${BORDER[x.tone]} p-4 space-y-2 text-sm`}>
              <div className="flex items-center justify-between gap-2">
                <p className={`font-bold ${TONE[x.tone]}`}>{x.name}</p>
                <span className={`text-2xl font-extrabold tabular-nums ${TONE[x.tone]}`}>{x.prob}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-panel2"><div className={`h-1.5 rounded-full ${BAR[x.tone]}`} style={{ width: `${x.prob}%` }} /></div>
              <p>🔎 <b>조건</b> {x.when}</p>
              <p>🛤️ <b>경로</b> {x.path}</p>
              <p>🎯 <b>범위</b> <span className="text-arc">{x.targets}</span></p>
              <p>💵 <b>현금</b> <span className="text-gold">{x.cash}</span></p>
              <p>👉 <b>대응</b> {x.play}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="🗺️ 3개월 · 6개월 투자 전략" count={s.plans?.length ?? 0}>
        <Guide items={[<>📐 포트폴리오 정책 — 🌏 <b className="text-gold">해외 {pc(PP.overseas_band.low)}~{pc(PP.overseas_band.high)}</b> 유지 · ⚖️ 종목 상한 <b className="text-gold">글로벌 시총 20위 {pc(PP.tier_caps.global_top20)}</b> · 미국 {pc(PP.tier_caps.us)} · 국내 {pc(PP.tier_caps.kr)}</>, "3개월 계획의 성공 · 실패 기준이 6개월 계획을 계속할지 정한다"]} />
        {!s.plans?.length ? <Empty text="이 달 호에는 기간별 계획이 없습니다." /> : (
          <div className="grid gap-3 lg:grid-cols-2">
            {s.plans.map((p) => (
              <div key={p.term} className={`glass rounded-xl border-t-4 ${p.term === "3m" ? "border-arc/70" : "border-gold/70"} p-4 space-y-2 text-sm`}>
                <p className={`text-xs font-bold ${p.term === "3m" ? "text-arc" : "text-gold"}`}>{TERM[p.term]} · {p.period}</p>
                <p className="text-base font-extrabold leading-snug">{p.title}</p>
                <Block title="🎯 목표">{p.goal.map((x, i) => <li key={i}>{x}</li>)}</Block>
                <Block title="💼 비중">{p.allocation.map((x, i) => <li key={i}>{x}</li>)}</Block>
                <Block title="🪜 핵심 행동">{p.moves.map((x, i) => <li key={i}>{x}</li>)}</Block>
                <div>
                  <p className="font-bold mb-1">📍 점검일</p>
                  <ul className="flex flex-wrap gap-1.5">{p.checkpoints.map((c, i) => <li key={i} className="rounded-full border border-line bg-panel2/70 px-2 py-0.5 text-xs"><span className="text-gold tabular-nums">{c.date}</span> {c.title}</li>)}</ul>
                </div>
                <Block title="🏁 성공 · 실패 기준">{p.success.map((x, i) => <li key={i} className={x.startsWith("❌") ? "text-hot" : "text-good"}>{x}</li>)}</Block>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="🎯 핵심 투자 전략" count={s.strategies.length}>
        <Guide items={["💡 왜 지금 → 📜 과거엔 어땠나 → 🪜 언제 · 얼마나 → 🚪 언제 손 떼나", "분할 회차는 '조건이 맞을 때만' 실행 — 날짜가 와도 조건이 안 맞으면 건너뜀", <>종목은 예시 — 실제 매수 판단은 <a className="link" href="/">🏠 오늘</a> 의 ⏱️ 타이밍 · <a className="link" href="/entry">🚦 진입 보드</a> 로</>]} />
        {groups.map((g) => (
          <div key={g.k ?? "all"} className="space-y-3">
            {g.k && <p className={`text-base font-bold ${g.k === "3m" ? "text-arc" : "text-gold"}`}>{TERM[g.k]} 전략 · {g.xs.length}개</p>}
          {g.xs.map((x) => { const n = s.strategies.indexOf(x); return (
            <Card key={x.id} tone={n === 0 ? "gold" : "muted"}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-lg font-bold"><span className="mr-2 rounded-md bg-gold px-2 py-0.5 text-ink text-sm align-middle">{n + 1}</span>{x.icon} {x.title}</p>
              <div className="flex flex-wrap gap-1.5 text-xs">
                <span className="rounded-full border border-gold/60 bg-gold/10 px-2 py-0.5 text-gold">확신 {x.conviction}</span>
                <span className="rounded-full border border-arc/50 bg-arc/10 px-2 py-0.5 text-arc">⏳ {x.horizon}</span>
                {x.l1.map((c) => <a key={c} href="/radar" className="rounded-full border border-line px-2 py-0.5 hover:border-arc hover:text-arc">📡 {l1.get(c) ?? c}</a>)}
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Block title="💡 왜 지금">{x.thesis.map((t, i) => <li key={i}>{t}</li>)}</Block>
              <Block title="📜 과거엔 어땠나">{x.precedent.map((t, i) => <li key={i}>{t}</li>)}</Block>
            </div>
            <div>
              <p className="font-bold mb-1">🪜 실행 계획</p>
              <ol className="space-y-1.5">
                {x.plan.map((p, i) => (
                  <li key={i} className="rounded-lg bg-panel2/70 px-3 py-2">
                    <b className="text-gold">{p.when}</b><br />👉 {p.action}
                  </li>
                ))}
              </ol>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Block title="👀 확인할 것">{x.watch.map((t, i) => <li key={i}>{t}</li>)}</Block>
              <Block title="🚪 무효화 · 매도 규칙">{x.exit.map((t, i) => <li key={i} className={t.startsWith("❌") ? "text-hot" : t.startsWith("🚫") ? "text-hot font-semibold" : "text-warn"}>{t}</li>)}</Block>
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1 text-xs">
              {x.tickers.map((t) => <span key={t.code} className="rounded-full border border-arc/50 bg-arc/10 px-2.5 py-1 text-arc">{t.market === "US" ? "🇺🇸" : "🇰🇷"} {t.name} <span className="text-sub">{t.code}</span></span>)}
            </div>
          </Card>
          ); })}
          </div>
        ))}
      </Section>

      <Section title="📜 과거 사례와 주가 움직임" count={s.precedents.length}>
        <Guide items={["시작일 = 100 · 가로축 = 시작 후 경과 거래일", "야후 일봉으로 화면을 열 때 계산 (선 끝 숫자 = 마지막 값의 등락률)", <><b className="text-gold">금색 굵은 선 = 지금</b> — 과거 선들과 겹쳐 보고 어디쯤인지 확인</>]} />
        {s.precedents.map((p) => {
          const c = charts.find((x) => x.id === p.id);
          const ok = c && c.lines.some((l) => l.last !== null);
          return (
            <div key={p.id} className="glass rounded-xl p-4 space-y-2">
              <p className="text-base font-bold">{p.title}</p>
              <p className="text-sm text-arc">❓ {p.question}</p>
              {ok && c ? <PathChart data={c.data} lines={c.lines} days={p.days} /> : <Empty text="시세 자료를 불러오지 못했습니다." />}
              {c && (
                <div className="table-wrap">
                  <table className="text-sm">
                    <thead><tr><th>사례</th><th>배경</th><th>마지막</th><th>최저</th><th>경과</th></tr></thead>
                    <tbody>{c.lines.map((l) => (
                      <tr key={l.key} className="border-t border-line/50">
                        <td className="whitespace-nowrap font-semibold" style={{ color: l.color }}>● {l.label}</td>
                        <td>{l.note}</td>
                        <td className={`tabular-nums whitespace-nowrap ${l.last !== null && l.last >= 100 ? "text-hot" : "text-cool"}`}>{pct(l.last === null ? null : l.last - 100)}</td>
                        <td className="tabular-nums whitespace-nowrap text-cool">{pct(l.min === null ? null : l.min - 100)}</td>
                        <td className="tabular-nums whitespace-nowrap">{l.day}일</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
              <ul className="space-y-1 text-sm">{p.takeaways.map((t, i) => <li key={i}>👉 {i === 0 ? <b className="text-gold">{t}</b> : t}</li>)}</ul>
            </div>
          );
        })}
      </Section>

      <Section title="🗓️ 6개월 이벤트 달력" count={s.months.length}>
        <Guide items={["🏛️ 매크로 · 🏭 산업 · 🏢 기업 이벤트 → 그달의 🎬 할 일", "(예정) = 회사·기관 확정 공시 전 — 날짜가 바뀔 수 있음"]} />
        <div className="grid gap-3 md:grid-cols-2">
          {s.months.map((x) => {
            const now = x.ym === nowYm;
            return (
              <div key={x.ym} className={`glass rounded-xl p-4 space-y-2 text-sm border ${now ? "border-gold shadow-[0_0_14px_rgba(252,211,77,0.35)]" : "border-transparent"}`}>
                <p className="text-base font-bold">{now && <span className="mr-2 rounded-md bg-gold px-2 py-0.5 text-ink text-xs align-middle">📍 이번 달</span>}<span className="text-gold">{ym(x.ym)}</span> <span className="text-white">— {x.theme}</span></p>
                <Events icon="🏛️" title="매크로" xs={x.macro} />
                <Events icon="🏭" title="산업" xs={x.industry} />
                <Events icon="🏢" title="기업" xs={x.company} />
                <div className="rounded-lg border border-gold/40 bg-gold/5 px-3 py-2">
                  <p className="font-bold text-gold mb-0.5">🎬 이달 할 일</p>
                  <ul className="space-y-0.5">{x.playbook.map((t, i) => <li key={i}>{t}</li>)}</ul>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="⚠️ 리스크와 대응" count={s.risks.length}>
        <div className="table-wrap">
          <table className="text-sm">
            <thead><tr><th>리스크</th><th>이렇게 알 수 있다</th><th>이렇게 대응</th></tr></thead>
            <tbody>{s.risks.map((r) => (
              <tr key={r.risk} className="border-t border-line/50 align-top">
                <td className="font-semibold text-hot">{r.risk}</td>
                <td>{r.signal}</td>
                <td className="text-good">{r.response}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Section>

      <Section title="✅ 매주 점검표">
        <ul className="grid gap-2 sm:grid-cols-2 text-sm">{s.checklist.map((t, i) => <li key={i} className="glass rounded-lg px-3 py-2">{t}</li>)}</ul>
      </Section>

      <details className="glass rounded-xl px-4 py-3 text-sm">
        <summary className="cursor-pointer font-bold">📚 출처 {s.sources.length}건 <span className="text-xs font-normal text-sub">펼치기</span></summary>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">{s.sources.map((x) => <li key={x.url}>🔗 <a className="link" href={x.url} target="_blank" rel="noreferrer">{x.title}</a></li>)}</ul>
      </details>

      <Footer asOf={`${s.as_of} 작성 · 판정(🎯 · 🟢)에 쓰지 않는 참고 전략`} />
    </Page>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="font-bold mb-1">{title}</p>
      <ul className="space-y-1 list-none">{children}</ul>
    </div>
  );
}

function Events({ icon, title, xs }: { icon: string; title: string; xs: StrategyEvent[] }) {
  if (!xs.length) return null;
  return (
    <div>
      <p className="font-semibold text-arc">{icon} {title}</p>
      <ul className="space-y-0.5">
        {xs.map((e, i) => (
          <li key={i}>
            <span className="mr-1.5 inline-block rounded bg-panel2 px-1.5 text-xs tabular-nums text-gold">{e.date}</span>
            {e.title}{e.why ? <span className="text-sub"> — {e.why}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

