/**
 * P0: M3 ② 무료 소스 4종 스모크 (PRD §16 P0, D19). GitHub Actions 에서 실행한다(로컬 실행은 참고값).
 * - 각 소스 1쿼리 → HTTP 상태·결과 수·90일 이내 수
 * - Google News 원문 URL 해제(구형 base64 → batchexecute) 성공률
 * - 증권사 공개 인사이트 목록 URL·robots.txt·sitemap 실측
 * LLM·유료 API·키 없음. User-Agent·간격·robots 준수. 본문은 저장하지 않는다(상태·개수·호스트만).
 */
import fs from "node:fs";
import { industryGrowthConfig, type BrokerPage } from "@/lib/config/load";
import { dbConfigured, dbInsert } from "@/lib/db";
import {
  brokersOr, buildQuery, decodeGoogleNewsId, fillUrl, googleNewsArticleId, googleNewsBatchBody, hostOf,
  parseGdelt, parseGoogleNewsBatchResponse, parseGoogleNewsPageAttrs, parseRobots, parseRss, robotsAllows,
  unwrapBingLink, withinDays, type SearchItem,
} from "@/lib/engine/outlook/search";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type SourceResult = { source: string; query: string; http_status: number | null; result_count: number; within_90d: number; sample_hosts: string[]; note?: string };
type ResolveResult = { attempted: number; resolved: number; via: Record<string, number>; hosts: string[] };
type BrokerResult = { broker: string; list_url: string; http_status: number | null; final_url?: string; article_links: number;
  robots_allowed: boolean | null; sitemaps: string[]; sitemap?: string; sitemap_status?: number | null; sitemap_matches?: number; sitemap_recent_90d?: number | null; note?: string };

async function get(url: string, ua: string, init: RequestInit = {}): Promise<{ status: number | null; text: string; finalUrl: string }> {
  try {
    const res = await fetch(url, { redirect: "follow", ...init, headers: { "User-Agent": ua, Accept: "*/*", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(20_000) });
    return { status: res.status, text: await res.text(), finalUrl: res.url };
  } catch (e) {
    return { status: null, text: e instanceof Error ? e.message : String(e), finalUrl: url };
  }
}

function summarize(source: string, query: string, status: number | null, items: SearchItem[], recency: number, note?: string): SourceResult {
  const now = new Date();
  const hosts = [...new Set(items.map((i) => hostOf(i.origin === "bing_news" ? unwrapBingLink(i.link) : i.link)).filter(Boolean) as string[])];
  return { source, query, http_status: status, result_count: items.length, within_90d: items.filter((i) => withinDays(i.published, recency, now)).length,
    sample_hosts: hosts.slice(0, 8), note };
}

async function resolveGoogle(items: SearchItem[], ua: string, n = 5): Promise<ResolveResult> {
  const r: ResolveResult = { attempted: 0, resolved: 0, via: {}, hosts: [] };
  // Google 은 브라우저형 UA 가 아니면 동의 페이지로 보낼 수 있다 → 해제 요청만 일반 브라우저 UA 병기
  const browserUa = `Mozilla/5.0 (compatible; ${ua})`;
  for (const it of items.slice(0, n)) {
    r.attempted++;
    let url = decodeGoogleNewsId(it.link);
    let via = "base64";
    if (!url) {
      const id = googleNewsArticleId(it.link);
      if (id) {
        const page = await get(`https://news.google.com/rss/articles/${id}`, browserUa);
        const attrs = parseGoogleNewsPageAttrs(page.text) ?? parseGoogleNewsPageAttrs((await get(`https://news.google.com/articles/${id}`, browserUa)).text);
        if (attrs) {
          const res = await get("https://news.google.com/_/DotsSplashUi/data/batchexecute", browserUa, {
            method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" }, body: googleNewsBatchBody(id, attrs.ts, attrs.sig) });
          url = parseGoogleNewsBatchResponse(res.text);
          via = "batchexecute";
        } else if (page.finalUrl && hostOf(page.finalUrl) !== "news.google.com") {
          url = page.finalUrl; via = "redirect";
        }
      }
      await sleep(1500);
    }
    if (url && hostOf(url) !== "news.google.com") {
      r.resolved++; r.via[via] = (r.via[via] ?? 0) + 1;
      const h = hostOf(url); if (h && !r.hosts.includes(h)) r.hosts.push(h);
    }
  }
  return r;
}

async function probeBroker(page: BrokerPage, ua: string, recency: number): Promise<BrokerResult> {
  const u = new URL(page.list_url);
  const robots = await get(`${u.origin}/robots.txt`, ua);
  const robotsTxt = robots.status === 200 ? robots.text : "";
  const allowed = robots.status === 200 ? robotsAllows(robotsTxt, ua, u.pathname) : robots.status === 404 ? true : null;
  const sitemaps = robots.status === 200 ? parseRobots(robotsTxt).sitemaps.slice(0, 5) : [];
  await sleep(2000);
  if (allowed === false) return { broker: page.broker, list_url: page.list_url, http_status: null, article_links: 0, robots_allowed: false, sitemaps, note: "robots.txt 차단 → 목록 수집 안 함" };
  const list = await get(page.list_url, ua);
  // 같은 도메인의 기사형 링크 수 (insights/research/articles 경로)
  const links = new Set<string>();
  for (const m of list.text.matchAll(/href="([^"#]+)"/g)) {
    try {
      const abs = new URL(m[1], list.finalUrl);
      if (hostOf(abs.href)?.endsWith(u.hostname.replace(/^www\./, "").split(".").slice(-2).join(".")) &&
          /\/(insights|research|articles|ideas|perspectives)\/.+/.test(abs.pathname) && abs.pathname.split("/").filter(Boolean).length >= 3) links.add(abs.pathname);
    } catch { /* skip */ }
  }
  const sm = page.sitemap ?? sitemaps[0];
  let sitemapStatus: number | null | undefined, matches: number | undefined, recent: number | null | undefined;
  if (sm) {
    await sleep(2000);
    const r = await get(sm, ua);
    sitemapStatus = r.status;
    if (r.status === 200) {
      const cut = Date.now() - recency * 86400_000;
      const urls = [...r.text.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => ({ loc: m[1].match(/<loc>([^<]+)/)?.[1] ?? "", lm: m[1].match(/<lastmod>([^<]+)/)?.[1] }));
      const hit = urls.filter((x) => (page.url_pattern ? x.loc.includes(page.url_pattern) : true));
      matches = hit.length;
      recent = page.sitemap_has_lastmod === false ? null : hit.filter((x) => x.lm && Date.parse(x.lm) >= cut).length;
    }
  }
  return { broker: page.broker, list_url: page.list_url, http_status: list.status, final_url: list.finalUrl !== page.list_url ? list.finalUrl : undefined,
    article_links: links.size, robots_allowed: allowed, sitemaps, sitemap: sm, sitemap_status: sitemapStatus, sitemap_matches: matches, sitemap_recent_90d: recent };
}

export async function outlookSmokeJob(args: Record<string, string>): Promise<void> {
  const cfg = industryGrowthConfig();
  const ns = cfg.news_search;
  const ua = ns.user_agent;
  const segment = args.segment ?? ns.segments_en["1b"]?.[2] ?? "AI chips";
  const brokerNames = cfg.us_major_brokers.map((b) => b.name);
  const qt = ns.query_templates;
  const qEn = buildQuery(qt.en, { segment_en: segment, brokers_or: brokersOr(brokerNames) });
  const qBing = buildQuery(qt.bing_en, { segment_en: segment, broker: brokerNames[1] ?? brokerNames[0] });
  const noDot = cfg.us_major_brokers.map((b) => (b.name.includes(".") ? b.aliases.find((a) => !a.includes(".") && /^[A-Za-z ]+$/.test(a)) ?? b.name : b.name));
  const qG = buildQuery(qt.gdelt, { segment_en: segment, brokers_or_nodot: brokersOr(noDot) });
  const runId = `outlook_smoke-${new Date().toISOString()}`;
  const results: SourceResult[] = [];

  // ① Google News RSS
  let gItems: SearchItem[] = [];
  if (ns.sources.google_news_rss.enabled) {
    const r = await get(fillUrl(ns.sources.google_news_rss.url_en, qEn), ua);
    gItems = r.status === 200 ? parseRss(r.text, "google_news") : [];
    results.push(summarize("google_news_rss", qEn, r.status, gItems, ns.recency_days));
  }
  await sleep(2000);
  // ② Bing News RSS
  if (ns.sources.bing_news_rss.enabled) {
    const r = await get(fillUrl(ns.sources.bing_news_rss.url, qBing), ua);
    const items = r.status === 200 ? parseRss(r.text, "bing_news") : [];
    results.push(summarize("bing_news_rss", qBing, r.status, items, ns.recency_days));
  }
  await sleep(2000);
  // ③ GDELT DOC 2.0 (5초 1회, 429 면 1회 백오프)
  if (ns.sources.gdelt_doc.enabled) {
    let r = await get(fillUrl(ns.sources.gdelt_doc.url, qG), ua);
    for (const wait of ns.sources.gdelt_doc.backoff_sec ?? [10, 30, 60]) {
      if (r.status !== 429) break;
      await sleep(wait * 1000);
      r = await get(fillUrl(ns.sources.gdelt_doc.url, qG), ua);
    }
    let items: SearchItem[] = [];
    let note: string | undefined;
    if (r.status === 200) { try { items = parseGdelt(JSON.parse(r.text)); } catch { note = `JSON 아님: ${r.text.slice(0, 80)}`; } }
    results.push(summarize("gdelt_doc", qG, r.status, items, ns.recency_days, note));
  }

  // ④ Google News 원문 URL 해제
  const resolve = gItems.length ? await resolveGoogle(gItems, ua, Number(args.resolve ?? 5)) : null;

  // ⑤ 증권사 공개 인사이트 페이지
  const brokers: BrokerResult[] = [];
  if (ns.sources.broker_sites.enabled) for (const p of ns.sources.broker_sites.pages) brokers.push(await probeBroker(p, ua, ns.recency_days));

  const responded = results.filter((r) => r.http_status === 200 && r.result_count > 0).length + (brokers.some((b) => (b.http_status === 200 && b.article_links > 0) || (b.sitemap_matches ?? 0) > 0) ? 1 : 0);
  const out = { run_id: runId, at: new Date().toISOString(), env: process.env.GITHUB_ACTIONS ? "github_actions" : "local", segment, results, google_resolve: resolve, brokers,
    sources_responding: responded, pass_p0: responded >= 3 };
  fs.mkdirSync("smoke-out", { recursive: true });
  fs.writeFileSync("smoke-out/outlook_smoke.json", JSON.stringify(out, null, 2));

  const md: string[] = [
    `## M3 ② 무료 소스 스모크 (${out.env}) — 응답 소스 ${responded}/4 → P0 ${out.pass_p0 ? "통과" : "미달"}`, "",
    "| 소스 | HTTP | 결과 | 90일 이내 | 호스트 예시 | 비고 |", "|---|---|---|---|---|---|",
    ...results.map((r) => `| ${r.source} | ${r.http_status ?? "-"} | ${r.result_count} | ${r.within_90d} | ${r.sample_hosts.slice(0, 4).join(", ")} | ${r.note ?? ""} |`),
    "", resolve ? `Google News 원문 해제: ${resolve.resolved}/${resolve.attempted} (${JSON.stringify(resolve.via)}) → ${resolve.hosts.join(", ")}` : "Google News 원문 해제: 대상 없음",
    "", "| 증권사 | 목록 URL | HTTP | 목록 링크 | robots | sitemap | 패턴 일치 | 90일 lastmod |", "|---|---|---|---|---|---|---|---|",
    ...brokers.map((b) => `| ${b.broker} | ${b.final_url ?? b.list_url} | ${b.http_status ?? "-"} | ${b.article_links} | ${b.robots_allowed === null ? "?" : b.robots_allowed ? "허용" : "차단"} | ${b.sitemap ?? "-"} (${b.sitemap_status ?? "-"}) | ${b.sitemap_matches ?? "-"} | ${b.sitemap_recent_90d === null ? "lastmod 없음" : b.sitemap_recent_90d ?? "-"} |`),
  ];
  console.log(md.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join("\n") + "\n");

  if (dbConfigured()) {
    const rows = [
      ...results.map((r) => ({ run_id: runId, source: r.source.replace(/_rss$|_doc$/, ""), query: r.query, http_status: r.http_status, result_count: r.result_count, note: `within_90d=${r.within_90d}` })),
      ...brokers.map((b) => ({ run_id: runId, source: "broker_site", query: b.list_url, http_status: b.http_status, result_count: b.article_links, note: `robots=${b.robots_allowed}` })),
    ];
    const w = await dbInsert("outlook_fetch_log", rows);
    console.log(w.ok ? `outlook_fetch_log ${w.data}행 기록` : `outlook_fetch_log 기록 실패: ${w.reason}`);
  }
}
