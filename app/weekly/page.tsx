import { Markdown } from "@/app/_components/markdown";
import { Empty, Footer, Guide, Nav, Section } from "@/app/_components/ui";
import { supabaseServer } from "@/lib/supabase/server";
import { kstString } from "@/lib/time";

export const dynamic = "force-dynamic";

type Memo = { week: string; body_md: string | null; grounding_ok: boolean | null; notion_url: string | null; telegram_sent_at: string | null; created_at: string };

/** 주간 투자위원회 (PRD §8 /weekly) — 메모 아카이브. 숫자는 사실표 값만, 서술은 숫자 검증 통과분만 */
export default async function Weekly({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week } = await searchParams;
  const sb = await supabaseServer();
  const list = await sb.from("weekly_memos").select("week,grounding_ok,notion_url,telegram_sent_at,created_at").order("week", { ascending: false }).range(0, 51);
  const memos = (list.data ?? []) as Omit<Memo, "body_md">[];
  const pick = week ?? memos[0]?.week;
  const cur = pick ? await sb.from("weekly_memos").select("week,body_md,grounding_ok,notion_url,telegram_sent_at,created_at").eq("week", pick).maybeSingle() : { data: null };
  const m = cur.data as Memo | null;
  return (
    <main className="mx-auto max-w-5xl px-4 py-4 space-y-8">
      <Nav />
      <Section title="주간 투자위원회" count={memos.length}>
        <Guide items={["🗓️ 매주 토요일 09:30 발행 (FlyWheel 리포트 대기 시 늦어도 10:30)", "🔢 표의 숫자 = JARVIS가 계산한 사실표 값", "✍️ 서술은 숫자 검증을 통과한 것만 · 실패한 주는 표 · 목록만"]} />
        {memos.length ? (
          <div className="flex flex-wrap gap-2 text-xs">
            {memos.map((x) => <a key={x.week} href={`/weekly?week=${x.week}`} className={`rounded border px-2 py-0.5 ${x.week === pick ? "border-gold text-gold" : "border-line"}`}>{x.week}{x.grounding_ok ? "" : " · 표만"}</a>)}
          </div>
        ) : <Empty text="아직 발행된 메모가 없습니다(첫 발행: 토요일 09:30)." />}
      </Section>
      {m?.body_md && (
        <Section title={`${m.week}${m.notion_url ? "" : ""}`}>
          <div className="text-xs text-sub">발행 {kstString(new Date(m.created_at))}{m.notion_url ? <> · <a className="link" href={m.notion_url} target="_blank" rel="noreferrer">노션에서 보기</a></> : null}</div>
          <Markdown md={m.body_md} />
        </Section>
      )}
      <Footer asOf={kstString()} />
    </main>
  );
}
