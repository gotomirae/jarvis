/**
 * industry_outlook_collect (PRD §7.3 ②, D19 · §14 일·수 04:00) — 무료·완전 자동, LLM·유료 API 없음.
 *  ① 검색: L1 × segments × {Google News RSS, Bing News RSS, GDELT} + 증권사 sitemap(lastmod 90일)
 *  ② 원문: 등급 A·B 도메인만 받는다(그 외는 채택 불가라 받지 않음). robots·도메인당 2초·UA
 *  ③ 추출(정규식) → ④ 채택(A1/B1/B2, 이전 실행 후보와 함께 교차 판정) → ⑤ 만료·제외
 *  · 4개 소스가 모두 실패하면 source_health 로 2회 연속 → 🔧 (T21). 기존 adopted 는 만료 전까지 유지.
 */
import { industryGrowthConfig, taxonomyConfig } from "@/lib/config/load";
import { dbInsert, dbSelectAll, dbUpsertBatched } from "@/lib/db";
import { adoptAll, tierOf, type Candidate, type DomainTiers } from "@/lib/engine/outlook/adopt";
import { extractArticle, type ExtractCtx, type GrowthPatterns } from "@/lib/engine/outlook/extract";
import { articleText, decideDate, metaPublished } from "@/lib/engine/outlook/fetch";
import { l1KeywordMap } from "@/lib/engine/outlook/keywords";
import { brokersOr, buildQuery, fillUrl, hostOf, normalizeUrl, parseGdelt, parseRss, unwrapBingLink, withinDays, type SearchItem } from "@/lib/engine/outlook/search";
import { Fetcher, pool } from "@/lib/ingest/news";
import { recordSource } from "@/lib/jobs";
import { kstDate } from "@/lib/time";
import { loadEntities, rules } from "./context";

type IG = {
  us_major_brokers: { name: string; aliases: string[] }[];
  domain_tiers: DomainTiers;
  growth_patterns: GrowthPatterns;
  excluded_outlooks?: string[];
  news_search: {
    recency_days: number; user_agent: string; per_domain_delay_sec: number;
    sources: {
      google_news_rss: { enabled: boolean; url_en: string; url_ko: string };
      bing_news_rss: { enabled: boolean; url: string };
      gdelt_doc: { enabled: boolean; url: string; min_interval_sec: number; backoff_sec?: number[] };
      broker_sites: { enabled: boolean; pages: { broker: string; sitemap?: string; url_pattern?: string; sitemap_has_lastmod?: boolean }[] };
    };
    query_templates: { en: string; ko: string; bing_en: string; gdelt: string };
    segments_en: Record<string, string[]>; segments_ko: Record<string, string[]>;
  };
};

type Found = { url: string; listDate: string | null; origin: "google_news" | "bing_news" | "gdelt" | "broker_site"; l1Hint: string | null; query: string; publisherDomain: string | null };

export async function collectOutlooks(now = new Date(), opts: { l1?: string; maxArticles?: number } = {}): Promise<Record<string, unknown>> {
  const ig = industryGrowthConfig() as unknown as IG;
  const R = rules().entry_core.M3_industry_high_growth.us_major_broker;
  const ns = ig.news_search;
  const f = new Fetcher(ns.user_agent, ns.per_domain_delay_sec * 1000);
  const runId = `outlook-${now.toISOString()}`;
  const today = kstDate(now);
  const brokers = ig.us_major_brokers.map((b) => b.name);
  const brokersKo = ig.us_major_brokers.flatMap((b) => b.aliases.filter((a) => /[가-힣]/.test(a)).slice(0, 1));
  const noDot = ig.us_major_brokers.map((b) => (b.name.includes(".") ? b.aliases.find((a) => /^[A-Za-z ]+$/.test(a)) ?? b.name : b.name));
  const l1s = opts.l1 ? [opts.l1] : Object.keys(ns.segments_en);
  const found = new Map<string, Found>();
  const log: Record<string, unknown>[] = [];
  const srcOk: Record<string, boolean> = { google_news: false, bing_news: false, gdelt: false, broker_site: false };
  const add = (items: SearchItem[], origin: Found["origin"], l1: string, query: string, map: (i: SearchItem) => string = (i) => i.link) => {
    for (const it of items) {
      if (!withinDays(it.published, ns.recency_days, now)) continue;
      const url = map(it);
      const key = origin === "google_news" ? url : normalizeUrl(url);
      const pub = origin === "google_news" ? (it.publisher_url ? hostOf(it.publisher_url) : null) : hostOf(url);
      if (!found.has(key)) found.set(key, { url, listDate: it.published?.slice(0, 10) ?? null, origin, l1Hint: l1, query, publisherDomain: pub });
    }
  };

  // ① 검색
  for (const l1 of l1s) {
    const segs = ns.segments_en[l1] ?? [];
    for (const seg of segs) {
      if (ns.sources.google_news_rss.enabled) {
        const q = buildQuery(ns.query_templates.en, { segment_en: seg, brokers_or: brokersOr(brokers) });
        const r = await f.get(fillUrl(ns.sources.google_news_rss.url_en, q), {}, { skipRobots: true });
        const items = r.status === 200 ? parseRss(r.text, "google_news") : [];
        if (r.status === 200) srcOk.google_news = true;
        add(items, "google_news", l1, q);
        log.push({ run_id: runId, source: "google_news", l1, query: q, http_status: r.status, result_count: items.length });
      }
      if (ns.sources.bing_news_rss.enabled && seg === segs[0]) {          // Bing 은 OR 불가 → 증권사별 쿼리라 첫 세그먼트만(시간 절약)
        for (const b of brokers) {
          const q = buildQuery(ns.query_templates.bing_en, { segment_en: seg, broker: b });
          const r = await f.get(fillUrl(ns.sources.bing_news_rss.url, q), {}, { skipRobots: true });
          const items = r.status === 200 ? parseRss(r.text, "bing_news") : [];
          if (r.status === 200) srcOk.bing_news = true;
          add(items, "bing_news", l1, q, (i) => unwrapBingLink(i.link));
          log.push({ run_id: runId, source: "bing_news", l1, query: q, http_status: r.status, result_count: items.length });
        }
      }
    }
    if (ns.sources.gdelt_doc.enabled && segs.length) {
      const q = `(${segs.map((s) => `"${s}"`).join(" OR ")}) (${brokersOr(noDot)})`;
      let r = await f.get(fillUrl(ns.sources.gdelt_doc.url, q), {}, { skipRobots: true });
      for (const w of ns.sources.gdelt_doc.backoff_sec ?? []) { if (r.status !== 429) break; await new Promise((s) => setTimeout(s, w * 1000)); r = await f.get(fillUrl(ns.sources.gdelt_doc.url, q), {}, { skipRobots: true }); }
      let items: SearchItem[] = [];
      if (r.status === 200) { try { items = parseGdelt(JSON.parse(r.text)); srcOk.gdelt = true; } catch { /* JSON 아님 */ } }
      add(items, "gdelt", l1, q);
      log.push({ run_id: runId, source: "gdelt", l1, query: q, http_status: r.status, result_count: items.length });
      await new Promise((s) => setTimeout(s, ns.sources.gdelt_doc.min_interval_sec * 1000));
    }
    if (ns.sources.google_news_rss.enabled && (ns.segments_ko[l1] ?? []).length) {
      const q = buildQuery(ns.query_templates.ko, { segment_ko: ns.segments_ko[l1][0], brokers_or_ko: brokersKo.join(" OR ") });
      const r = await f.get(fillUrl(ns.sources.google_news_rss.url_ko, q), {}, { skipRobots: true });
      const items = r.status === 200 ? parseRss(r.text, "google_news") : [];
      add(items, "google_news", l1, q);
      log.push({ run_id: runId, source: "google_news", l1, query: q, http_status: r.status, result_count: items.length });
    }
  }
  if (ns.sources.broker_sites.enabled && !opts.l1) {
    for (const p of ns.sources.broker_sites.pages) {
      if (!p.sitemap) continue;
      const r = await f.get(p.sitemap);
      let n = 0;
      if (r.status === 200) {
        srcOk.broker_site = true;
        for (const m of r.text.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
          const loc = m[1].match(/<loc>([^<]+)/)?.[1]?.trim();
          const lm = m[1].match(/<lastmod>([^<]+)/)?.[1]?.trim() ?? null;
          if (!loc || (p.url_pattern && !loc.includes(p.url_pattern))) continue;
          if (p.sitemap_has_lastmod !== false && !withinDays(lm, ns.recency_days, now)) continue;
          const key = normalizeUrl(loc);
          if (!found.has(key)) { found.set(key, { url: loc, listDate: lm ? lm.slice(0, 10) : null, origin: "broker_site", l1Hint: null, query: p.sitemap, publisherDomain: hostOf(loc) }); n++; }
        }
      }
      log.push({ run_id: runId, source: "broker_site", l1: null, query: p.sitemap, http_status: r.status, result_count: n });
    }
  }
  for (const [s, ok] of Object.entries(srcOk)) await recordSource(`outlook_${s}`, ok, ok ? undefined : "응답 없음/0건");

  // ② 이미 본 URL 제외 → Google 해제 → 등급 A·B 만 원문
  const seen = await dbSelectAll<{ url: string }>("outlook_seen", `select=url&seen_at=gte.${new Date(now.getTime() - 120 * 86400_000).toISOString()}`);
  const seenSet = new Set((seen.ok ? seen.data : []).map((x) => x.url));
  const ents = await loadEntities();
  const brokerWords = new Set(ig.us_major_brokers.flatMap((b) => [b.name, ...b.aliases]).map((x) => x.toLowerCase()));
  const ctx: ExtractCtx = {
    patterns: ig.growth_patterns, brokers: ig.us_major_brokers,
    l1Keywords: l1KeywordMap(taxonomyConfig(), ns.segments_en, ns.segments_ko),
    companies: ents.names.filter((n) => n.length >= 4 && !brokerWords.has(n.toLowerCase())),
    year: Number(today.slice(0, 4)), horizonMaxYearsAhead: R.horizon_end_max_years_ahead,
  };
  const excluded = new Set((ig.excluded_outlooks ?? []).map(normalizeUrl));
  const cands: (Candidate & { metric: string; horizon: string; origin: string; date_basis: string; tier: string; match_detail: Record<string, unknown> })[] = [];
  const seenRows: Record<string, unknown>[] = [];
  let fetched = 0;
  const max = opts.maxArticles ?? 400;
  await pool([...found.values()], 6, async (fnd) => {
    if (fetched >= max) return;
    // 등급 A·B 매체가 아니면 원문 해제·수집을 하지 않는다 (Google 링크 해제는 건당 약 4초)
    const adoptable = (d: string | null) => !!d && brokers.some((b) => ["A", "B"].includes(tierOf(d, b, ig.domain_tiers)));
    if (fnd.publisherDomain && !adoptable(fnd.publisherDomain)) return;
    let url = fnd.url;
    if (fnd.origin === "google_news") { const u = await f.resolveGoogle(url); if (!u) return; url = u; }
    const norm = normalizeUrl(url);
    if (seenSet.has(norm) || excluded.has(norm)) return;
    seenSet.add(norm);
    const domain = hostOf(url) ?? "";
    const tiers = new Set(brokers.map((b) => tierOf(domain, b, ig.domain_tiers)));
    if (!tiers.has("A") && !tiers.has("B")) return;
    const page = await f.get(url);
    fetched++;
    let n = 0;
    if (page.status === 200) {
      const art = articleText(page.text, url);
      if (art.ok) {
        const meta = metaPublished(page.text);
        for (const x of extractArticle(art.text, ctx)) {
          const tier = tierOf(domain, x.broker, ig.domain_tiers);
          if (tier !== "A" && tier !== "B") continue;
          const d = decideDate(fnd.listDate, meta, tier, R.adoption.date_mismatch_max_days, R.adoption.tier_b_requires_meta_date);
          if (!d) continue;
          cands.push({ url, domain, broker: x.broker, l1: x.l1, value_pct: x.value_pct, published: d.published, quote: x.quote, has_cagr_word: x.has_cagr_word, has_year_range: x.has_year_range,
            metric: x.metric, horizon: x.horizon, origin: fnd.origin, date_basis: d.basis, tier, match_detail: { l1_keyword: x.l1_keyword, broker_via: x.broker_via, query: fnd.query, publisher_title: art.title.slice(0, 200), has_cagr_word: x.has_cagr_word, has_year_range: x.has_year_range } });
          n++;
        }
      }
    }
    seenRows.push({ url: norm, seen_at: now.toISOString(), http_status: page.status, candidates: n });
  });
  await dbUpsertBatched("outlook_seen", seenRows, "url");

  // ④ 이전 후보와 합쳐 채택 판정 (B1 교차는 실행을 넘어서도 성립)
  const prior = await dbSelectAll<{ url: string; domain: string; broker: string; l1: string; value_pct: number; published_date: string; quote: string; metric: string; horizon: string; origin: string; date_basis: string; tier: string; match_detail: Record<string, unknown> }>(
    "industry_outlooks", `select=url,domain,broker,l1,value_pct,published_date,quote,metric,horizon,origin,date_basis,tier,match_detail&origin=neq.yaml&status=in.(adopted,unverified)`);
  const all = [...(prior.ok ? prior.data.map((p) => ({ ...p, value_pct: Number(p.value_pct), published: p.published_date, has_cagr_word: p.match_detail?.has_cagr_word === true, has_year_range: p.match_detail?.has_year_range === true })) : []), ...cands];
  const groups = adoptAll(all, ig.domain_tiers, R.adoption, today, R.max_published_age_days);
  const rowsOut: Record<string, unknown>[] = [];
  let adopted = 0;
  for (const g of groups) {
    for (const it of g.items) {
      const src = all.find((a) => a.url === it.url && a.value_pct === it.value_pct && a.broker === it.broker && a.l1 === it.l1)!;
      const isAdopted = it.item_status === "adopted";
      if (isAdopted) adopted++;
      rowsOut.push({
        l1: g.l1, source_type: "broker", broker: g.broker, segment: null, metric: src.metric, value_pct: it.value_pct, horizon: src.horizon, published_date: it.published,
        date_basis: src.date_basis, publisher: hostOf(it.url ?? "") ?? it.domain, domain: it.domain, tier: it.tier, url: it.url, quote: it.quote, origin: src.origin,
        adoption_rule: isAdopted ? it.item_rule : null, corroborating_urls: isAdopted ? it.corroborating : [], conflict: isAdopted && g.conflict,
        status: it.item_status === "expired" ? "expired" : isAdopted ? "adopted" : "unverified", match_detail: src.match_detail,
        adopted_at: isAdopted ? now.toISOString() : null, expires_at: new Date(new Date(it.published).getTime() + R.max_published_age_days * 86400_000).toISOString(),
      });
    }
  }
  const dedup = [...new Map(rowsOut.map((r) => [`${r.url}|${r.broker}|${r.l1}|${r.metric}|${r.value_pct}`, r])).values()];
  const w = await dbUpsertBatched("industry_outlooks", dedup, "url,broker,l1,metric,value_pct");
  if (!w.ok) throw new Error(w.reason);
  await dbInsert("outlook_fetch_log", log.map((l) => ({ ...l, articles_fetched: fetched, candidates: cands.length, adopted })));
  const allFailed = !Object.values(srcOk).some(Boolean);
  return { run_id: runId, found: found.size, fetched, candidates: cands.length, adopted_items: adopted, groups: groups.length, sources_ok: srcOk, all_sources_failed: allFailed };
}

/** 90일 지난 adopted·unverified → expired, yaml excluded_outlooks → excluded */
export async function expireOutlooks(now = new Date()): Promise<number> {
  const ig = industryGrowthConfig() as unknown as IG;
  const { dbUpdate } = await import("@/lib/db");
  const r = await dbUpdate("industry_outlooks", `status=in.(adopted,unverified)&expires_at=lt.${now.toISOString()}`, { status: "expired" });
  for (const u of ig.excluded_outlooks ?? []) await dbUpdate("industry_outlooks", `url=eq.${encodeURIComponent(u)}`, { status: "excluded" });
  return r.ok ? r.data : 0;
}
