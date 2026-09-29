import { describe, expect, it } from "vitest";
import {
  brokersOr, buildQuery, decodeGoogleNewsId, fillUrl, googleNewsArticleId, googleNewsBatchBody, hostOf, normalizeUrl,
  parseGdelt, parseGoogleNewsBatchResponse, parseGoogleNewsPageAttrs, parseRobots, parseRss, robotsAllows, unwrapBingLink, withinDays,
} from "./search";

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title><![CDATA[AI chip market to grow 30% &amp; more]]></title><link>https://news.google.com/rss/articles/CBMiXYZ?oc=5</link>
<pubDate>Fri, 26 Sep 2026 12:00:00 GMT</pubDate><source url="https://www.reuters.com">Reuters</source></item>
<item><title>No link</title></item>
<item><title>Bing &#39;item&#39; &#8217;s</title><link>http://www.bing.com/news/apiclick.aspx?ref=x&amp;url=https%3A%2F%2Fwww.cnbc.com%2Fa%2F1&amp;c=1</link><pubDate>not a date</pubDate><News:Source>CNBC</News:Source></item>
</channel></rss>`;

describe("outlook search — query building", () => {
  it("quotes multi-word / dotted broker names", () => {
    expect(brokersOr(["Goldman Sachs", "Citi", "J.P. Morgan"])).toBe('"Goldman Sachs" OR Citi OR "J.P. Morgan"');
    expect(buildQuery('"{segment_en}" ({brokers_or}) {missing}', { segment_en: "AI chips", brokers_or: "Citi" })).toBe('"AI chips" (Citi) ');
    expect(fillUrl("https://x/?q={q}+when:90d", 'a "b"')).toBe("https://x/?q=a%20%22b%22+when:90d");
  });
});

describe("outlook search — RSS / GDELT parsing", () => {
  it("parses RSS items, decodes entities, skips broken items", () => {
    const g = parseRss(RSS, "google_news");
    expect(g).toHaveLength(2);
    expect(g[0]).toMatchObject({ title: "AI chip market to grow 30% & more", publisher: "Reuters", publisher_url: "https://www.reuters.com", published: "2026-09-26T12:00:00.000Z", origin: "google_news" });
    expect(g[1].publisher_url).toBeNull();
    expect(g[1].title).toBe("Bing 'item' ’s");
    expect(g[1].published).toBeNull();
    expect(g[1].publisher).toBe("CNBC");
    expect(parseRss("garbage", "bing_news")).toEqual([]);
  });

  it("unwraps Bing apiclick links", () => {
    expect(unwrapBingLink("http://www.bing.com/news/apiclick.aspx?ref=x&url=https%3A%2F%2Fwww.cnbc.com%2Fa%2F1")).toBe("https://www.cnbc.com/a/1");
    expect(unwrapBingLink("http://www.bing.com/news/apiclick.aspx?url=javascript:alert(1)")).toBe("http://www.bing.com/news/apiclick.aspx?url=javascript:alert(1)");
    expect(unwrapBingLink("https://example.com/a")).toBe("https://example.com/a");
    expect(unwrapBingLink("not a url")).toBe("not a url");
  });

  it("parses GDELT artlist JSON defensively", () => {
    const items = parseGdelt({ articles: [
      { url: "https://www.fool.com/x", title: "T", seendate: "20260926T120000Z", domain: "fool.com" },
      { url: "https://a.com", title: "no date" },
      { title: "no url" },
    ] });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ link: "https://www.fool.com/x", published: "2026-09-26T12:00:00.000Z", publisher: "fool.com", origin: "gdelt" });
    expect(items[1]).toMatchObject({ published: null, publisher: null });
    expect(parseGdelt(null)).toEqual([]);
    expect(parseGdelt({ articles: "x" })).toEqual([]);
  });
});

describe("outlook search — URL helpers", () => {
  it("normalizes URLs (tracking params, www, hash, trailing slash)", () => {
    expect(normalizeUrl("https://WWW.Reuters.com/tech/a/?utm_source=x&id=3&fbclid=1#top")).toBe("https://reuters.com/tech/a?id=3");
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com/");
    expect(normalizeUrl("::bad")).toBe("::bad");
    expect(hostOf("https://www.CNBC.com/x")).toBe("cnbc.com");
    expect(hostOf("nope")).toBeNull();
  });

  it("checks recency window", () => {
    const now = new Date("2026-09-27T00:00:00Z");
    expect(withinDays("2026-07-01T00:00:00Z", 90, now)).toBe(true);
    expect(withinDays("2026-06-01T00:00:00Z", 90, now)).toBe(false);
    expect(withinDays("2026-10-30T00:00:00Z", 90, now)).toBe(false);
    expect(withinDays(null, 90, now)).toBe(false);
  });
});

describe("outlook search — Google News URL resolution", () => {
  it("decodes legacy base64 ids and returns null for new-style ids", () => {
    const legacyId = Buffer.from("\x08\x13\x22\x1bhttps://www.reuters.com/a/b\xd2\x01\x00").toString("base64url");
    expect(decodeGoogleNewsId(`https://news.google.com/rss/articles/${legacyId}?oc=5`)).toBe("https://www.reuters.com/a/b");
    expect(decodeGoogleNewsId("https://news.google.com/rss/articles/CBMiAU_yqLN0")).toBeNull();
    expect(decodeGoogleNewsId("https://example.com/x")).toBeNull();
    expect(googleNewsArticleId("https://news.google.com/articles/ABC_d-1?x")).toBe("ABC_d-1");
    expect(googleNewsArticleId("https://example.com")).toBeNull();
  });

  it("builds batchexecute body and parses page attrs / response", () => {
    const body = googleNewsBatchBody("ID1", "1700000000", "SIG");
    expect(body.startsWith("f.req=")).toBe(true);
    expect(decodeURIComponent(body)).toContain('\\"ID1\\",1700000000,\\"SIG\\"');
    expect(parseGoogleNewsPageAttrs('<c-wiz data-n-a-sg="SIG" data-n-a-ts="123">')).toEqual({ ts: "123", sig: "SIG" });
    expect(parseGoogleNewsPageAttrs("<html>")).toBeNull();
    expect(parseGoogleNewsBatchResponse(')]}\'\n[["wrb.fr","Fbv4je","[\\"garturlres\\",\\"https://fortune.com/x\\",1]"]]')).toBe("https://fortune.com/x");
    expect(parseGoogleNewsBatchResponse("nothing")).toBeNull();
  });
});

describe("outlook search — robots.txt", () => {
  const txt = `# comment
User-agent: *
Disallow: /private/
Allow: /private/public-insights/
Disallow:

User-agent: BadBot
User-agent: JARVIS-research
Disallow: /insights/secret$
Disallow: /*.pdf$
Sitemap: https://x.com/sitemap.xml
no-colon-line
Crawl-delay: 5`;

  it("collects groups and sitemaps", () => {
    const r = parseRobots(txt);
    expect(r.sitemaps).toEqual(["https://x.com/sitemap.xml"]);
    expect(r.groups).toHaveLength(2);
    expect(r.groups[1].agents).toEqual(["badbot", "jarvis-research"]);
  });

  it("applies longest-match with UA-specific group", () => {
    const star = "Mozilla/5.0";
    expect(robotsAllows(txt, star, "/private/a")).toBe(false);
    expect(robotsAllows(txt, star, "/private/public-insights/x")).toBe(true);
    expect(robotsAllows(txt, star, "/insights/a")).toBe(true);
    const ua = "JARVIS-research (+https://github.com/gotomirae/JARVIS)";
    expect(robotsAllows(txt, ua, "/private/a")).toBe(true);        // 전용 그룹이 있으면 * 그룹 무시
    expect(robotsAllows(txt, ua, "/insights/secret")).toBe(false);
    expect(robotsAllows(txt, ua, "/insights/secret-2")).toBe(true);
    expect(robotsAllows(txt, ua, "/a/report.pdf")).toBe(false);
    expect(robotsAllows("", ua, "/anything")).toBe(true);
    expect(robotsAllows("User-agent: *\nAllow: /a\nDisallow: /a", ua, "/a")).toBe(true);   // 같은 길이면 Allow 우선
    expect(robotsAllows("Disallow: /x", ua, "/x")).toBe(true);     // 그룹 밖 규칙 무시
  });
});
