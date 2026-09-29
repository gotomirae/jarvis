/**
 * 무료 공개 뉴스·웹 수집 어댑터 (PRD §5.6, D19) — 키 없음. robots.txt 준수 · 도메인당 간격 · User-Agent 명시.
 * 예외를 올리지 않는다(불변 규칙 6). 본문은 호출부가 판정에만 쓰고 저장하지 않는다.
 */
import { decodeGoogleNewsId, googleNewsArticleId, googleNewsBatchBody, hostOf, parseGoogleNewsBatchResponse, parseGoogleNewsPageAttrs, robotsAllows } from "@/lib/engine/outlook/search";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 작업 목록을 n 개 워커로 처리 (순서 무관) */
export async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, n) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

export class Fetcher {
  private last = new Map<string, number>();
  private chain = new Map<string, Promise<void>>();     // 도메인별 직렬화 — 동시 실행해도 같은 도메인은 간격을 지킨다
  private robots = new Map<string, string | null>();
  constructor(private ua: string, private perDomainMs: number, private timeoutMs = 20_000) {}

  /** 같은 호스트 요청을 줄 세워 perDomainMs 간격을 보장 */
  private async slot(host: string): Promise<void> {
    const prev = this.chain.get(host) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    this.chain.set(host, prev.then(() => mine));
    await prev;
    const wait = this.perDomainMs - (Date.now() - (this.last.get(host) ?? 0));
    if (wait > 0) await sleep(wait);
    this.last.set(host, Date.now());
    setTimeout(release, 0);
  }

  async get(url: string, init: RequestInit = {}, opts: { skipRobots?: boolean; browserUa?: boolean } = {}): Promise<{ status: number | null; text: string; finalUrl: string }> {
    const host = hostOf(url) ?? "";
    if (!opts.skipRobots && !(await this.allowed(url))) return { status: null, text: "robots.txt 차단", finalUrl: url };
    await this.slot(host);
    try {
      const res = await fetch(url, { redirect: "follow", ...init, headers: { "User-Agent": opts.browserUa ? `Mozilla/5.0 (compatible; ${this.ua})` : this.ua, Accept: "*/*", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(this.timeoutMs) });
      return { status: res.status, text: await res.text(), finalUrl: res.url || url };
    } catch (e) {
      return { status: null, text: e instanceof Error ? e.message : String(e), finalUrl: url };
    }
  }

  async allowed(url: string): Promise<boolean> {
    let u: URL;
    try { u = new URL(url); } catch { return false; }
    if (!this.robots.has(u.origin)) {
      try {
        const r = await fetch(`${u.origin}/robots.txt`, { headers: { "User-Agent": this.ua }, signal: AbortSignal.timeout(10_000) });
        this.robots.set(u.origin, r.status === 200 ? await r.text() : "");
      } catch { this.robots.set(u.origin, ""); }
    }
    return robotsAllows(this.robots.get(u.origin) ?? "", this.ua, u.pathname);
  }

  /** Google News RSS 링크 → 원문 URL (구형 base64 → batchexecute). 실패 시 null */
  async resolveGoogle(link: string): Promise<string | null> {
    const direct = decodeGoogleNewsId(link);
    if (direct) return direct;
    const id = googleNewsArticleId(link);
    if (!id) return null;
    const page = await this.get(`https://news.google.com/rss/articles/${id}`, {}, { skipRobots: true, browserUa: true });
    const attrs = parseGoogleNewsPageAttrs(page.text);
    if (!attrs) return page.finalUrl && hostOf(page.finalUrl) !== "news.google.com" ? page.finalUrl : null;
    const res = await this.get("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" }, body: googleNewsBatchBody(id, attrs.ts, attrs.sig),
    }, { skipRobots: true, browserUa: true });
    return parseGoogleNewsBatchResponse(res.text);
  }
}
