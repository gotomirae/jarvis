import { notFound } from "next/navigation";
import { linksConfig, taxonomyConfig } from "@/lib/config/load";
import { env } from "@/lib/env";
import { stockLinks, type LinkEntity } from "@/lib/links";
import { supabaseServer } from "@/lib/supabase/server";
import { kstString } from "@/lib/time";

export const dynamic = "force-dynamic";

/** 종목 통합 (PRD §8). P1: 기본 정보 + 링크 세트(텔레그램과 같은 함수). 신호 타임라인·M1~M5 는 P2~P3. */
export default async function StockPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entityId = decodeURIComponent(id);
  const sb = await supabaseServer();
  const { data } = await sb.from("entities").select("id,market,symbol,name,aliases,primary_l1,l1_codes,l1_basis,asset_class,snowball_asset_id,hermes_analysis_id,naver_us_code,updated_at").eq("id", entityId).maybeSingle();
  if (!data) notFound();
  const e = data as LinkEntity & { aliases: string[]; l1_codes: string[]; l1_basis: string | null; asset_class: string; updated_at: string };
  const tx = taxonomyConfig();
  const l1Name = (c: string) => tx.l1.find((r) => r.code === c)?.name ?? c;
  const links = stockLinks(e, { links: linksConfig(), taxonomy: tx, jarvisUrl: env().JARVIS_URL });

  return (
    <main className="mx-auto max-w-xl p-4 space-y-4">
      <a href="/" className="text-sm text-neutral-500">← 오늘</a>
      <header>
        <h1 className="text-2xl font-bold">{e.market === "KR" ? "🇰🇷" : "🇺🇸"} {e.name} <span className="text-base font-normal text-neutral-500">{e.symbol}</span></h1>
        <p className="text-sm text-neutral-500">
          {e.l1_codes.map(l1Name).join(" + ")} · 근거 {e.l1_basis ?? "-"} · {e.asset_class}{e.snowball_asset_id ? " · SnowBall 보유/관심" : ""}
        </p>
        {e.aliases.length > 0 && <p className="text-xs text-neutral-500">별칭: {e.aliases.join(", ")}</p>}
      </header>
      <section className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {links.map((l) => (
          <a key={l.key} href={l.button.url} target="_blank" rel="noreferrer" className="rounded border border-neutral-300 dark:border-neutral-700 px-3 py-2 text-sm text-center">{l.button.text}</a>
        ))}
      </section>
      <p className="text-xs text-neutral-500">기준 {kstString(new Date(e.updated_at as unknown as string))} KST · 신호 타임라인·M1~M5 체크리스트는 P2~P3에서 추가됩니다.</p>
      <p className="text-xs text-neutral-500">⚠️ 매수 확정 신호가 아닙니다. 최종 판단·입력은 SnowBall에서.</p>
    </main>
  );
}
