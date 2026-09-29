import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { industryGrowthConfig, loadYaml, taxonomyConfig } from "@/lib/config/load";
import {
  adoptAll, adoptGroup, aggregateL1, hostMatches, independentSources, similarity, tierOf, type AdoptionRules, type Candidate, type DomainTiers,
} from "./adopt";
import {
  derivedCagr, extractArticle, extractSentence, findBroker, keywordIndex, lowerBoundRanges, matchL1, pyRegex, splitSentences, yearsIn,
  type ExtractCtx, type GrowthPatterns,
} from "./extract";
import { articleText, decideDate, metaPublished } from "./fetch";
import { l1KeywordMap } from "./keywords";

type Fx = {
  today: string;
  extract: { positive: Record<string, unknown>[]; negative: { text: string; reason: string }[] };
  adopt: { case: string; items: Candidate[]; expect: { status: string; rule?: string; value_used?: number; conflict?: boolean } }[];
  aggregate: { case: string; adopted: Record<string, number>; expect: { median: number; pass: boolean } }[];
};
const fx = parse(fs.readFileSync(path.join(process.cwd(), "docs/reference/outlook_extract_fixtures.yaml"), "utf8")) as Fx;
const ig = industryGrowthConfig() as unknown as { growth_patterns: GrowthPatterns; us_major_brokers: ExtractCtx["brokers"]; domain_tiers: DomainTiers; news_search: { segments_en: Record<string, string[]>; segments_ko: Record<string, string[]> } };
const rules = loadYaml<{ entry_core: { M3_industry_high_growth: { us_major_broker: { adoption: AdoptionRules; max_published_age_days: number; growth_min_pct: number; horizon_end_max_years_ahead: number } } } }>("rules.yaml");
const ub = rules.entry_core.M3_industry_high_growth.us_major_broker;
const ctx: ExtractCtx = {
  patterns: ig.growth_patterns, brokers: ig.us_major_brokers,
  l1Keywords: l1KeywordMap(taxonomyConfig(), ig.news_search.segments_en, ig.news_search.segments_ko),
  companies: ["Samsung Electronics", "Nvidia"], year: Number(fx.today.slice(0, 4)), horizonMaxYearsAhead: ub.horizon_end_max_years_ahead,
};

describe("M3 ② 추출 — fixture 정탐", () => {
  for (const p of fx.extract.positive) {
    it(String(p.text).slice(0, 60), () => {
      const r = extractSentence(String(p.text), (p.prev as string) ?? null, ctx);
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (!r.ok) return;
      expect(r.broker).toBe(p.broker);
      expect(r.l1).toBe(p.l1);
      expect(r.metric).toBe(p.metric);
      expect(r.value_pct).toBe(p.value_pct);
      if (p.horizon_end) expect(r.horizon_end).toBe(p.horizon_end);
      expect(r.quote).toBe(String(p.text));   // quote = 원문 문장 그대로
    });
  }
});

describe("M3 ② 추출 — fixture 오탐", () => {
  const map: Record<string, string> = { exclude_term: "exclude_term", company_subject: "company_subject", past_tense_only: "past_tense_only", non_us_major_broker: "non_us_major_broker", horizon_too_far: "horizon_too_far", no_broker: "no_broker", no_l1_match: "no_l1_match" };
  for (const n of fx.extract.negative) {
    it(`${n.reason}: ${n.text.slice(0, 50)}`, () => {
      const r = extractSentence(n.text, null, ctx);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe(map[n.reason]);
    });
  }
});

describe("M3 ② 추출 — 규칙 단위", () => {
  it("regex·키워드·범위·연도·파생 CAGR", () => {
    expect(pyRegex("(?i)abc").flags).toBe("i");
    expect(pyRegex("abc", "g").flags).toBe("g");
    expect(keywordIndex("humanoid robots rise", "humanoid robot")).toBe(0);
    expect(keywordIndex("SAID it", "AI")).toBe(-1);
    expect(keywordIndex("x", " ")).toBe(-1);
    expect(keywordIndex("HBM 시장", "시장")).toBe(4);
    expect(lowerBoundRanges("grow 20-25% and 10 to 12% or 5~6 %")).toBe("grow 20% and 10% or 5%");
    expect(yearsIn("from 2026 to 2030, by 2031, 2028년까지", ig.growth_patterns.year_range_regex)).toEqual([2026, 2030, 2031, 2028]);
    expect(derivedCagr(400, "billion", 2025, 900, "billion", 2029)).toBe(22.5);
    expect(derivedCagr(1, "trillion", 2025, 1500, "bn", 2027)).toBe(22.5);
    expect(derivedCagr(1, "bn", 2027, 2, "bn", 2025)).toBeNull();
    expect(derivedCagr(0, "bn", 2025, 2, "bn", 2027)).toBeNull();
    expect(findBroker("nothing here", ctx.brokers)).toBeNull();
    expect(matchL1("the market", ctx.l1Keywords)).toBeNull();
    expect(matchL1("ab cd", { "1a": ["ab"], "1b": ["cd"] })).toBe("ambiguous");
    expect(matchL1("abc", { "1a": ["abc"], "1b": ["ab"] })).toEqual({ l1: "1a", keyword: "abc" });
  });

  it("모호 L1·시장 명사 없음·수치 없음·범위 밖·기간 없음", () => {
    const x = { ...ctx, l1Keywords: { "1a": ["alpha"], "1b": ["gamma"] } };
    expect(extractSentence("Morgan Stanley expects the alpha and gamma market to grow 20% next year.", null, x)).toMatchObject({ ok: false, reason: "ambiguous_l1" });
    expect(extractSentence("Morgan Stanley expects quantum computing to grow at a 40% CAGR through 2029.", null, ctx)).toMatchObject({ ok: false, reason: "no_industry_noun" });
    expect(extractSentence("Morgan Stanley expects the quantum computing market to boom.", null, ctx)).toMatchObject({ ok: false, reason: "no_growth" });
    expect(extractSentence("Morgan Stanley expects the quantum computing market to grow at a 250% CAGR through 2029.", null, ctx)).toMatchObject({ ok: false, reason: "value_out_of_range" });
    expect(extractSentence("Morgan Stanley expects the quantum computing market to grow 20% by 2029.", null, ctx)).toMatchObject({ ok: false, reason: "no_horizon" });
    expect(extractSentence("Morgan Stanley expects the quantum computing market to grow at a 40% CAGR.", null, ctx)).toMatchObject({ ok: false, reason: "no_horizon" });
    expect(extractSentence("Morgan Stanley expects the quantum computing market to grow at a 40% CAGR through 2024.", null, ctx)).toMatchObject({ ok: false, reason: "no_horizon" });
  });

  it("연도로 내년 판정, 기간 표기, 등급 판정용 플래그", () => {
    const r = extractSentence(`Goldman Sachs expects the shipbuilding market to grow 12% in ${ctx.year + 1}.`, null, ctx);
    expect(r).toMatchObject({ ok: true, metric: "NEXT_YEAR", value_pct: 12, horizon: String(ctx.year + 1), has_cagr_word: false });
    const c = extractSentence("Citi expects the quantum computing market to grow at a 40% CAGR from 2026 to 2029.", null, ctx);
    expect(c).toMatchObject({ ok: true, horizon: "2026-2029", has_year_range: true, has_cagr_word: true, broker_via: "same" });
    const d = extractSentence("Citi expects the quantum computing market to grow at a 40% CAGR through 2029.", null, ctx);
    expect(d).toMatchObject({ ok: true, horizon: "~2029" });
    expect(extractSentence("The firm expects the quantum computing market to grow at a 40% CAGR through 2029.", "Nothing.", ctx)).toMatchObject({ ok: false, reason: "no_broker" });
  });

  it("문장 분리(약어 보호)와 기사 전체 추출", () => {
    expect(splitSentences("J.P. Morgan said so. The U.S. market grew. 다음 문장.", ig.growth_patterns.abbreviations)).toEqual(["J.P. Morgan said so.", "The U.S. market grew.", "다음 문장."]);
    const body = "Wells Fargo Investment Institute published its new outlook on Monday. The firm expects the quantum computing market to grow at a 40% CAGR through 2029. Stocks rallied.";
    const out = extractArticle(body, ctx);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ broker: "Wells Fargo", broker_via: "anaphora", l1: "3c" });
  });
});

describe("M3 ② 채택 — fixture", () => {
  const today = fx.today;
  for (const c of fx.adopt) {
    it(c.case, () => {
      const g = adoptGroup(c.items[0].broker, c.items[0].l1, c.items, ig.domain_tiers, ub.adoption, today, ub.max_published_age_days);
      expect(g.status).toBe(c.expect.status);
      if (c.expect.rule) expect(g.rule).toBe(c.expect.rule);
      if (c.expect.value_used !== undefined) expect(g.value_used).toBe(c.expect.value_used);
      if (c.expect.conflict !== undefined) expect(g.conflict).toBe(c.expect.conflict);
    });
  }
  for (const a of fx.aggregate) {
    it(a.case, () => {
      expect(aggregateL1(a.adopted, ub.growth_min_pct)).toMatchObject({ median: a.expect.median, pass: a.expect.pass });
    });
  }
});

describe("M3 ② 채택 — 규칙 단위", () => {
  const t = ig.domain_tiers;
  it("도메인 등급·유사도·독립 매체", () => {
    expect(hostMatches("www.Reuters.com", "reuters.com")).toBe(true);
    expect(hostMatches("fakereuters.com", "reuters.com")).toBe(false);
    expect(tierOf("am.jpmorgan.com", "J.P. Morgan", t)).toBe("A");
    expect(tierOf("morganstanley.com", "Citi", t)).toBe("other");      // 다른 증권사 도메인은 A 아님
    expect(tierOf("medium.com", "Citi", t)).toBe("deny");
    expect(similarity("", "")).toBe(1);
    expect(similarity("a b c", "a b d")).toBe(0.5);
    const same = "Citi expects the defense spending market to grow 20% next year";
    expect(independentSources([
      { domain: "reuters.com", broker: "Citi", l1: "1g", value_pct: 20, published: "2026-09-10", quote: same },
      { domain: "cnbc.com", broker: "Citi", l1: "1g", value_pct: 20, published: "2026-09-10", quote: same.replace("defense", "Defense") },   // 전재(대소문자만 다름)
      { domain: "www.reuters.com", broker: "Citi", l1: "1g", value_pct: 20, published: "2026-09-10" },
      { domain: "wsj.com", broker: "Citi", l1: "1g", value_pct: 20, published: "2026-09-10", quote: "entirely different words here" },
    ], 0.9).map((x) => x.domain)).toEqual(["reuters.com", "wsj.com"]);
  });

  it("B 단일(조건 미충족) → unverified, 만료+신선 혼재, 여러 묶음", () => {
    const base = { broker: "Citi", l1: "1g", value_pct: 20 };
    expect(adoptGroup("Citi", "1g", [{ ...base, domain: "reuters.com", published: "2026-09-10" }], t, ub.adoption, fx.today, 90).status).toBe("unverified");
    const mix = adoptGroup("Citi", "1g", [{ ...base, domain: "citigroup.com", published: "2026-09-10" }, { ...base, domain: "citi.com", published: "2026-01-01" }], t, ub.adoption, fx.today, 90);
    expect(mix).toMatchObject({ status: "adopted", rule: "A1", conflict: false });
    expect(mix.items.map((i) => i.item_status).sort()).toEqual(["adopted", "expired"]);
    expect(mix.items.find((i) => i.item_status === "adopted")?.item_rule).toBe("A1");
    const all = adoptAll([
      { ...base, domain: "citigroup.com", published: "2026-09-10" },
      { broker: "Morgan Stanley", l1: "1b", value_pct: 25, domain: "morganstanley.com", published: "2026-09-10" },
    ], t, ub.adoption, fx.today, 90);
    expect(all.map((g) => `${g.broker}:${g.status}`).sort()).toEqual(["Citi:adopted", "Morgan Stanley:adopted"]);
    expect(aggregateL1({}, 15)).toEqual({ median: null, pass: false, brokers: 0 });
  });
});

describe("M3 ② 원문 처리", () => {
  const long = "The quantum computing market is growing. ".repeat(10);
  it("본문 추출·유료벽·짧은 본문", () => {
    const ok = articleText(`<html><head><title>T</title></head><body><article><h1>T</h1><p>${long}</p><p>${long}</p></article></body></html>`, "https://x.com/a");
    expect(ok.ok).toBe(true);
    const pay = articleText(`<html><body><article><p>Subscribe to continue reading. ${long}</p><p>${long}</p></article></body></html>`, "https://x.com/a");
    expect(pay).toEqual({ ok: false, reason: "유료벽·로그인" });
    expect(articleText("<html><body><p>short</p></body></html>", "https://x.com/a")).toEqual({ ok: false, reason: "본문 없음(짧음)" });
    expect(articleText(undefined as unknown as string, "https://x.com").ok).toBe(false);
  });

  it("발표일 메타·날짜 결정", () => {
    const html = `<meta property="article:published_time" content="2026-09-12T08:00:00Z"><script type="application/ld+json">{"datePublished":"2026-09-11"}</script><time datetime="2026-09-15">x</time><meta name="pubdate" content="bad-date">`;
    expect(metaPublished(html)).toBe("2026-09-11");
    expect(metaPublished("<html></html>")).toBeNull();
    expect(decideDate("2026-09-20", "2026-09-11", "B", 3, true)).toEqual({ published: "2026-09-11", basis: "meta" });
    expect(decideDate("2026-09-12", "2026-09-11", "B", 3, true)).toEqual({ published: "2026-09-11", basis: "meta" });
    expect(decideDate("2026-09-01", "2026-09-11", "B", 3, true)).toEqual({ published: "2026-09-01", basis: "meta" });
    expect(decideDate(null, "2026-09-11", "B", 3, true)).toEqual({ published: "2026-09-11", basis: "meta" });
    expect(decideDate("2026-09-20", null, "A", 3, true)).toEqual({ published: "2026-09-20", basis: "list" });
    expect(decideDate("2026-09-20", null, "B", 3, true)).toBeNull();
    expect(decideDate("2026-09-20", null, "B", 3, false)).toEqual({ published: "2026-09-20", basis: "list" });
    expect(decideDate(null, null, "A", 3, true)).toBeNull();
  });
});
