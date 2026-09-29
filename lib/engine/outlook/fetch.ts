/**
 * M3 ② 원문 처리 (PRD §7.3 ②) — 순수 함수. 네트워크는 scripts/industry_outlook_collect.ts 가 한다(robots·간격·UA 준수).
 *  · 본문: @mozilla/readability 로 기사 본문 텍스트만. 유료벽·로그인 화면은 폐기.
 *  · 발표일: 목록 날짜(RSS pubDate·GDELT seendate·sitemap lastmod)와 본문 메타(article:published_time·JSON-LD datePublished·<time datetime>) 대조.
 *    3일 넘게 다르면 더 이른 날짜. 본문 메타가 없으면 등급 A 만 목록 날짜 인정, 등급 B 는 폐기.
 * 본문은 판정용으로만 쓰고 저장하지 않는다(불변 규칙 5 — quote 문장만 저장).
 */
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

const PAYWALL = [/subscribe to (?:continue|read)/i, /sign in to (?:continue|read)/i, /this content is (?:for|available to) subscribers/i, /로그인 후 이용/, /유료 회원/];

export function articleText(html: string, url: string): { ok: true; text: string; title: string } | { ok: false; reason: string } {
  try {
    const { document } = parseHTML(html);
    const base = document.createElement("base");
    base.setAttribute("href", url);
    document.head?.appendChild(base);
    const art = new Readability(document as unknown as Document, { charThreshold: 200 }).parse();
    const text = (art?.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text.length < 200) return { ok: false, reason: "본문 없음(짧음)" };
    if (PAYWALL.some((re) => re.test(text.slice(0, 1500)))) return { ok: false, reason: "유료벽·로그인" };
    return { ok: true, text, title: art?.title ?? "" };
  } catch (e) {
    return { ok: false, reason: `파싱 실패: ${e instanceof Error ? e.message.slice(0, 80) : String(e)}` };
  }
}

/** 본문 메타 발표일 (YYYY-MM-DD). 여러 개면 가장 이른 것 */
export function metaPublished(html: string): string | null {
  const found: string[] = [];
  const push = (v: string | undefined) => { if (!v) return; const d = new Date(v); if (!Number.isNaN(d.getTime())) found.push(d.toISOString().slice(0, 10)); };
  for (const m of html.matchAll(/<meta[^>]+(?:property|name|itemprop)=["'](?:article:published_time|og:published_time|datePublished|pubdate|publish-date|parsely-pub-date)["'][^>]*>/gi)) {
    push(m[0].match(/content=["']([^"']+)["']/i)?.[1]);
  }
  for (const m of html.matchAll(/"datePublished"\s*:\s*"([^"]+)"/g)) push(m[1]);
  const t = html.match(/<time[^>]+datetime=["']([^"']+)["']/i);
  if (t) push(t[1]);
  return found.length ? found.sort()[0] : null;
}

export type DateBasis = { published: string; basis: "meta" | "list" } | null;

export function decideDate(listDate: string | null, meta: string | null, tier: "A" | "B", maxMismatchDays: number, tierBRequiresMeta: boolean): DateBasis {
  if (meta && listDate) {
    const diff = Math.abs(new Date(meta).getTime() - new Date(listDate).getTime()) / 86400_000;
    return { published: diff > maxMismatchDays ? [meta, listDate].sort()[0] : meta, basis: "meta" };
  }
  if (meta) return { published: meta, basis: "meta" };
  if (listDate && (tier === "A" || !tierBRequiresMeta)) return { published: listDate, basis: "list" };
  return null;
}
