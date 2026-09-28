/**
 * M3 ② 무료 공개 검색 — 순수 함수 (PRD §5.6 · §7.3 D19). 네트워크 호출은 scripts/ 가 한다.
 * LLM·유료 API·키 없음. 쿼리 템플릿·소스 URL·증권사 목록은 config/industry_growth.yaml 에서만 온다.
 */

export type SearchItem = {
  title: string;
  link: string;
  published: string | null;   // ISO
  publisher: string | null;
  origin: "google_news" | "bing_news" | "gdelt";
};

const decodeEntities = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&")
    .trim();

const tag = (block: string, name: string): string | null => {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeEntities(m[1]) : null;
};

function toIso(s: string | null): string | null {
  if (!s) return null;
  // GDELT seendate: 20260927T120000Z
  const g = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  const d = g ? new Date(Date.UTC(+g[1], +g[2] - 1, +g[3], +g[4], +g[5], +g[6])) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** broker 목록 → 쿼리용 OR 묶음: "Goldman Sachs" OR "Morgan Stanley" OR Citi */
export function brokersOr(names: string[]): string {
  return names.map((n) => (/\s|\./.test(n) ? `"${n}"` : n)).join(" OR ");
}

export function buildQuery(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
}

export function fillUrl(urlTemplate: string, q: string): string {
  return urlTemplate.replace("{q}", encodeURIComponent(q));
}

/** RSS 2.0 (Google News·Bing News) → 항목. 형식이 깨져도 throw 하지 않고 가능한 항목만 반환한다. */
export function parseRss(xml: string, origin: "google_news" | "bing_news"): SearchItem[] {
  const out: SearchItem[] = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const b = m[1];
    const title = tag(b, "title");
    const link = tag(b, "link");
    if (!title || !link) continue;
    const publisher = tag(b, "source") ?? tag(b, "News:Source");
    out.push({ title, link, published: toIso(tag(b, "pubDate")), publisher, origin });
  }
  return out;
}

/** Bing News RSS 링크는 bing.com/news/apiclick.aspx?...&url=<원문> 형태 → 원문 URL 해제 */
export function unwrapBingLink(link: string): string {
  try {
    const u = new URL(link);
    if (u.hostname.endsWith("bing.com")) {
      const inner = u.searchParams.get("url");
      if (inner && /^https?:\/\//.test(inner)) return inner;
    }
  } catch { /* 원문 그대로 */ }
  return link;
}

/** GDELT DOC 2.0 artlist JSON → 항목 */
export function parseGdelt(json: unknown): SearchItem[] {
  const arts = (json as { articles?: unknown[] } | null)?.articles;
  if (!Array.isArray(arts)) return [];
  const out: SearchItem[] = [];
  for (const a of arts as Record<string, unknown>[]) {
    if (typeof a.url !== "string" || typeof a.title !== "string") continue;
    out.push({ title: a.title, link: a.url, published: toIso(typeof a.seendate === "string" ? a.seendate : null),
      publisher: typeof a.domain === "string" ? a.domain : null, origin: "gdelt" });
  }
  return out;
}

const TRACKING = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ocid$|cmpid$|guccounter$|taid$|smid$)/i;

/** URL 정규화: 추적 파라미터·해시 제거, 호스트 소문자, www. 제거, 끝 슬래시 제거 (결과 병합 키) */
export function normalizeUrl(link: string): string {
  try {
    const u = new URL(link);
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString();
  } catch {
    return link;
  }
}

export function hostOf(link: string): string | null {
  try { return new URL(link).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
}

/** 발표일이 recencyDays 이내인지 (발표일 없음 = 판단 불가 → false) */
export function withinDays(published: string | null, recencyDays: number, now: Date): boolean {
  if (!published) return false;
  const t = new Date(published).getTime();
  return now.getTime() - t <= recencyDays * 86400_000 && t <= now.getTime() + 86400_000;
}

/**
 * Google News RSS 링크(news.google.com/rss/articles/<id>) — 구형 id 는 base64 안에 원문 URL 이 들어 있다.
 * 신형(AU_yqL…)은 들어 있지 않으므로 null → 호출부가 batchexecute 해제 또는 다른 소스 대조로 넘어간다.
 */
export function decodeGoogleNewsId(link: string): string | null {
  const m = link.match(/news\.google\.com\/(?:rss\/)?articles\/([A-Za-z0-9_-]+)/);
  if (!m) return null;
  const bin = Buffer.from(m[1], "base64url").toString("latin1");   // 잘못된 문자는 무시된다(throw 없음)
  const u = bin.match(/https?:\/\/[\x21-\x7e]+/);
  if (!u) return null;
  return u[0].replace(/[\x00-\x20\xd2].*$/, "");
}

/** Google News 기사 id (batchexecute 해제용) */
export function googleNewsArticleId(link: string): string | null {
  return link.match(/news\.google\.com\/(?:rss\/)?articles\/([A-Za-z0-9_-]+)/)?.[1] ?? null;
}

/** batchexecute 요청 본문 (서명·타임스탬프는 기사 페이지의 data-n-a-sg / data-n-a-ts) */
export function googleNewsBatchBody(id: string, ts: string, sig: string): string {
  const inner = JSON.stringify(["garturlreq", [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], id, Number(ts), sig]);
  return "f.req=" + encodeURIComponent(JSON.stringify([[["Fbv4je", inner, null, "generic"]]]));
}

export function parseGoogleNewsPageAttrs(html: string): { ts: string; sig: string } | null {
  const sig = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
  return sig && ts ? { ts, sig } : null;
}

export function parseGoogleNewsBatchResponse(text: string): string | null {
  const m = text.match(/\[\\"garturlres\\",\\"(https?:[^\\"]+)\\"/);
  return m ? m[1] : null;
}

// ───────────────────────── robots.txt ─────────────────────────
type RobotsGroup = { agents: string[]; rules: { allow: boolean; path: string }[] };

export function parseRobots(txt: string): { groups: RobotsGroup[]; sitemaps: string[] } {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let cur: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (key === "sitemap") { sitemaps.push(val); continue; }
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (cur && (key === "allow" || key === "disallow")) cur.rules.push({ allow: key === "allow", path: val });
  }
  return { groups, sitemaps };
}

/** 최장 일치 규칙 우선(Google 규칙). 해당 UA 그룹이 없으면 '*' 그룹. 빈 disallow = 허용. */
export function robotsAllows(txt: string, userAgent: string, path: string): boolean {
  const { groups } = parseRobots(txt);
  const ua = userAgent.toLowerCase();
  const token = ua.split(/[\s/(]/)[0];
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && token.startsWith(a)));
  const group = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  let best: { allow: boolean; len: number } = { allow: true, len: -1 };
  for (const g of group) {
    for (const r of g.rules) {
      if (r.path === "") continue;
      const re = new RegExp("^" + r.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
      if (re.test(path) && (r.path.length > best.len || (r.path.length === best.len && r.allow))) best = { allow: r.allow, len: r.path.length };
    }
  }
  return best.allow;
}
