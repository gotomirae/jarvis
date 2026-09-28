/**
 * 링크 빌더 — config/links.yaml 단일 출처 (PRD §9.4, D14, 불변 규칙 7). 텔레그램·대시보드가 같은 함수를 쓴다.
 * 순수 함수: 설정·JARVIS_URL·taxonomy 를 인자로 받는다. 만들 수 없는 링크는 null → 버튼 생략(빈 화면 금지).
 * 네이버 미국 코드(NVDA.O) 해석은 네트워크가 필요하므로 lib/ingest/naver.ts 어댑터가 하고, 결과는 entities.naver_us_code 로 들어온다.
 */
export type Button = { text: string; url: string };
export type DashboardsConfig = Record<string, { label: string; url: string }>;
export type Market = "KR" | "US";

export type StockRule = {
  label: string;
  url?: string;
  fallback?: string;
  markets: Market[];
  kr?: string;
  us?: string;
  us_fallback?: string;
};

export type LinksCfg = {
  dashboards: DashboardsConfig;
  stock: Record<string, StockRule & Record<string, unknown>>;
  layout: { stock_card_rows: string[][] };
};

export type TaxonomyLinkCfg = {
  l1: { code: string; l2: string[] }[];
  notion: { l1_urls: Record<string, string>; l2_page_ids: Record<string, string> };
};

export type LinkEntity = {
  id: string;                          // KR:000660 / US:NVDA
  market: Market;
  symbol: string;                      // 국내 6자리 코드 / 미국 티커
  name: string;
  primary_l1?: string | null;
  snowball_asset_id?: string | null;
  hermes_analysis_id?: string | number | null;
  naver_us_code?: string | null;       // NVDA.O — 해석 실패·미해석이면 null → 네이버 검색 폴백
};

export type LinkCtx = { links: LinksCfg; taxonomy: TaxonomyLinkCfg; jarvisUrl?: string | null };

/** {x}·${X} 자리표시자를 치환한다. 하나라도 값이 없거나 비면 null. */
export function fillTemplate(template: string, vars: Record<string, string | null | undefined>): string | null {
  let missing = false;
  const out = template.replace(/\$?\{(\w+)\}/g, (_, k: string) => {
    const v = vars[k];
    if (v === undefined || v === null || v === "") { missing = true; return ""; }
    return v;
  });
  if (missing) return null;
  return /^https?:\/\/[^/\s]+/.test(out) ? out.replace(/([^:])\/\/+/g, "$1/") : null;
}

const trimSlash = (u: string | null | undefined) => (u ? u.replace(/\/$/, "") : null);

/** 대시보드 홈 버튼 (links.yaml dashboards 순서). JARVIS_URL 미설정이면 JARVIS 버튼만 생략. */
export function dashboardButtons(cfg: DashboardsConfig, jarvisUrl: string | null | undefined): Button[] {
  const vars = { JARVIS_URL: trimSlash(jarvisUrl) };
  const out: Button[] = [];
  for (const d of Object.values(cfg)) {
    const url = fillTemplate(d.url, vars);
    if (url) out.push({ text: d.label, url });
  }
  return out;
}

/** 한 행 최대 n개로 나눈다 (텔레그램 인라인 키보드) */
export function rows<T>(items: T[], perRow = 3): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += perRow) out.push(items.slice(i, i + perRow));
  return out;
}

/** 종목 primary L1 의 FlyWheel [산업] L2 페이지 id(대시 없음). L2 가 없으면 null. */
export function flywheelL2PageId(primaryL1: string | null | undefined, tx: TaxonomyLinkCfg): string | null {
  const row = tx.l1.find((r) => r.code === primaryL1);
  for (const l2 of row?.l2 ?? []) {
    const id = tx.notion.l2_page_ids[l2];
    if (id) return id.replace(/-/g, "");
  }
  return null;
}

function vars(e: LinkEntity, ctx: LinkCtx): Record<string, string | null> {
  return {
    JARVIS_URL: trimSlash(ctx.jarvisUrl),
    entity_id: encodeURIComponent(e.id),
    code: e.market === "KR" ? e.symbol : null,
    symbol: e.market === "US" ? encodeURIComponent(e.symbol) : null,
    name_urlenc: e.name ? encodeURIComponent(e.name) : null,
    snowball_asset_id: e.snowball_asset_id ? encodeURIComponent(e.snowball_asset_id) : null,
    hermes_analysis_id: e.hermes_analysis_id !== null && e.hermes_analysis_id !== undefined && e.hermes_analysis_id !== "" ? String(e.hermes_analysis_id) : null,
    naver_us: e.naver_us_code ? encodeURIComponent(e.naver_us_code) : null,
    flywheel_l2_page_id_nodash: flywheelL2PageId(e.primary_l1, ctx.taxonomy),
  };
}

/** 규칙 하나의 URL. 기본 → (FlyWheel: L1 카테고리 페이지) → fallback 순. 만들 수 없으면 null. */
export function stockUrl(key: string, e: LinkEntity, ctx: LinkCtx): string | null {
  const rule = ctx.links.stock[key];
  if (!rule || !rule.markets.includes(e.market)) return null;
  const v = vars(e, ctx);
  if (key === "naver") {
    if (e.market === "KR") return rule.kr ? fillTemplate(rule.kr, v) : null;
    return (rule.us ? fillTemplate(rule.us, v) : null) ?? (rule.us_fallback ? fillTemplate(rule.us_fallback, v) : null);
  }
  const primary = rule.url ? fillTemplate(rule.url, v) : null;
  if (primary) return primary;
  if (key === "flywheel" && e.primary_l1 && ctx.taxonomy.notion.l1_urls[e.primary_l1]) return ctx.taxonomy.notion.l1_urls[e.primary_l1];
  return rule.fallback ? fillTemplate(rule.fallback, v) : null;
}

/** 종목 링크 세트 — links.yaml 순서의 {key, button} 목록(만들 수 없는 링크 제외). */
export function stockLinks(e: LinkEntity, ctx: LinkCtx): { key: string; button: Button }[] {
  const out: { key: string; button: Button }[] = [];
  for (const [key, rule] of Object.entries(ctx.links.stock)) {
    const url = stockUrl(key, e, ctx);
    if (url) out.push({ key, button: { text: rule.label, url } });
  }
  return out;
}

/** 인라인 키보드 — layout.stock_card_rows 배치, 빈 버튼·빈 행 생략 (액션 행은 P2 콜백 버튼) */
export function stockKeyboard(e: LinkEntity, ctx: LinkCtx): Button[][] {
  const byKey = new Map(stockLinks(e, ctx).map((x) => [x.key, x.button]));
  return ctx.links.layout.stock_card_rows
    .map((row) => row.map((k) => byKey.get(k)).filter((b): b is Button => !!b))
    .filter((row) => row.length > 0);
}

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 여러 종목 메시지용 텍스트 링크: `SK하이닉스 · <a>네이버</a> · <a>StockEasy</a> · <a>Heimdallr</a> · <a>JARVIS</a>` */
export const INLINE_KEYS: [string, string][] = [["naver", "네이버"], ["stockeasy", "StockEasy"], ["heimdallr", "Heimdallr"], ["jarvis", "JARVIS"]];

export function inlineLinks(e: LinkEntity, ctx: LinkCtx): string {
  const parts = [escHtml(e.name)];
  for (const [key, text] of INLINE_KEYS) {
    const url = stockUrl(key, e, ctx);
    if (url) parts.push(`<a href="${escHtml(url)}">${text}</a>`);
  }
  return parts.join(" · ");
}

/** 링크 스모크 판정 (PRD §9.4): 4xx·5xx·빈 화면 패턴 = 실패. 로그인 필요 규칙은 3xx·401 을 정상으로 본다(T13). */
export type SmokeCfg = { login_redirect_ok: string[]; title_patterns: string[]; body_patterns: string[]; min_body_bytes: number };

export function htmlTitle(body: string): string {
  return body.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1].trim() ?? "";
}

export function evaluateLink(rule: string, status: number | null, body: string, cfg: SmokeCfg): { ok: boolean; note: string } {
  const base = rule.split(":")[0].replace(/^(dashboard|kr|us|fallback)\./, "");
  const loginOk = cfg.login_redirect_ok.includes(base);
  if (status === null) return { ok: false, note: "응답 없음" };
  if (status >= 300 && status < 400) return loginOk ? { ok: true, note: `${status} 로그인 이동(정상)` } : { ok: false, note: `${status} 예상 밖 리다이렉트` };
  if (status === 401 && loginOk) return { ok: true, note: "401 로그인 필요(정상)" };
  if (status >= 400) return { ok: false, note: `HTTP ${status}` };
  const title = htmlTitle(body);
  const hitT = cfg.title_patterns.find((p) => title.includes(p));
  if (hitT) return { ok: false, note: `빈 화면(제목): ${title.slice(0, 40)}` };
  const hitB = cfg.body_patterns.find((p) => body.includes(p));
  if (hitB) return { ok: false, note: `오류 본문: ${hitB}` };
  if (Buffer.byteLength(body, "utf8") < cfg.min_body_bytes) return { ok: false, note: `본문 ${Buffer.byteLength(body, "utf8")}B` };
  return { ok: true, note: `${status}` };
}

/** 네이버 미국 코드 캐시가 유효한가 (links.yaml layout.naver_us_code_cache_days) */
export function naverCacheFresh(checkedAt: string | null | undefined, now: Date, days: number): boolean {
  if (!checkedAt) return false;
  return now.getTime() - new Date(checkedAt).getTime() < days * 86400_000;
}

/** 네이버 해외 종목 API 응답이 채택 조건(200 + StockConflict 없음)을 만족하는가 */
export function naverUsAccept(status: number, body: string): boolean {
  return status === 200 && !body.includes("StockConflict") && body.trim().length > 2;
}
