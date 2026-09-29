import { describe, expect, it } from "vitest";
import {
  dashboardButtons, evaluateLink, fillTemplate, flywheelL2PageId, htmlTitle, linkLine, inlineLinks, naverCacheFresh, naverUsAccept, rows, stockKeyboard, stockLinks, stockUrl,
  type LinkCtx, type LinkEntity,
} from "./links";
import { linksConfig, taxonomyConfig } from "./config/load";
import { resolveNaverUs } from "./ingest/naver";

const ctx: LinkCtx = { links: linksConfig(), taxonomy: taxonomyConfig(), jarvisUrl: "https://jarvis.example.app/" };
const hynix: LinkEntity = { id: "KR:000660", market: "KR", symbol: "000660", name: "SK하이닉스", primary_l1: "1b", snowball_asset_id: "a-1", hermes_analysis_id: 129 };
const nvda: LinkEntity = { id: "US:NVDA", market: "US", symbol: "NVDA", name: "NVIDIA", primary_l1: "1a", naver_us_code: "NVDA.O" };

describe("links — 템플릿·대시보드", () => {
  it("fillTemplate substitutes {x} and ${X}, null when any value missing", () => {
    expect(fillTemplate("${JARVIS_URL}/stock/{entity_id}", { JARVIS_URL: "https://j.app", entity_id: "KR:000660" })).toBe("https://j.app/stock/KR:000660");
    expect(fillTemplate("${JARVIS_URL}/", { JARVIS_URL: null })).toBeNull();
    expect(fillTemplate("https://h/{code}", { code: "" })).toBeNull();
    expect(fillTemplate("{x}", { x: "not-a-url" })).toBeNull();
    expect(fillTemplate("https://a.b//c", {})).toBe("https://a.b/c");
  });

  it("dashboard buttons follow links.yaml and omit JARVIS without JARVIS_URL", () => {
    const cfg = linksConfig().dashboards;
    const without = dashboardButtons(cfg, undefined);
    expect(without.map((b) => b.text)).not.toContain(cfg.jarvis.label);
    expect(without).toHaveLength(Object.keys(cfg).length - 1);
    const withUrl = dashboardButtons(cfg, "https://jarvis.example.app/");
    expect(withUrl[0]).toEqual({ text: cfg.jarvis.label, url: "https://jarvis.example.app/" });
    expect(withUrl).toHaveLength(6);
  });

  it("rows chunks by 3", () => {
    expect(rows([1, 2, 3, 4, 5, 6, 7])).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    expect(rows([1, 2], 1)).toEqual([[1], [2]]);
  });
});

describe("links — 종목 링크 세트 (PRD §9.4)", () => {
  it("국내: 8개 전부, SnowBall 자산·HermesCall 분석 있음", () => {
    const m = Object.fromEntries(stockLinks(hynix, ctx).map((x) => [x.key, x.button.url]));
    expect(m).toEqual({
      jarvis: "https://jarvis.example.app/stock/KR%3A000660",
      heimdallr: "https://heimdallr-call.vercel.app/stock/000660",
      hermescall: "https://hermes-call-psi.vercel.app/analysis/129",
      snowball: "https://snowball-heritage.vercel.app/ironman/asset/a-1",
      sage: "https://sage-gotomiraes-projects.vercel.app/?q=SK%ED%95%98%EC%9D%B4%EB%8B%89%EC%8A%A4&date=30d",
      flywheel: "https://www.notion.so/b239c770aa6182eeb66a014414648adc",
      naver: "https://m.stock.naver.com/domestic/stock/000660/total",
      stockeasy: "https://stockeasy.intellio.kr/stock-analysis/stock-info/000660",
    });
  });

  it("미국: Heimdallr·StockEasy 없음, 네이버는 해석된 코드", () => {
    const keys = stockLinks(nvda, ctx).map((x) => x.key);
    expect(keys).toEqual(["jarvis", "hermescall", "snowball", "sage", "flywheel", "naver"]);
    expect(stockUrl("naver", nvda, ctx)).toBe("https://m.stock.naver.com/worldstock/stock/NVDA.O/total");
  });

  it("SnowBall 자산 없음·HermesCall 분석 없음 → 폴백", () => {
    expect(stockUrl("snowball", nvda, ctx)).toBe("https://snowball-heritage.vercel.app/ironman/ideas");
    expect(stockUrl("hermescall", nvda, ctx)).toBe("https://hermes-call-psi.vercel.app/screener");
    expect(stockUrl("hermescall", { ...hynix, hermes_analysis_id: "" }, ctx)).toBe("https://hermes-call-psi.vercel.app/screener");
  });

  it("네이버 미국 코드 해석 실패 → 네이버 검색", () => {
    expect(stockUrl("naver", { ...nvda, symbol: "BRK.B", naver_us_code: null }, ctx)).toBe("https://search.naver.com/search.naver?query=BRK.B");
  });

  it("FlyWheel: L2 페이지 → L1 카테고리 페이지 → 2_1 루트", () => {
    expect(stockUrl("flywheel", { ...hynix, primary_l1: "1l" }, ctx)).toBe("https://www.notion.so/3e89c770aa6180b3aa29c86ce5483968");
    expect(stockUrl("flywheel", { ...hynix, primary_l1: "ETC" }, ctx)).toBe("https://www.notion.so/36a9c770aa61809c95e5c1117f9779b5");
    expect(stockUrl("flywheel", { ...hynix, primary_l1: null }, ctx)).toBe("https://www.notion.so/36a9c770aa61809c95e5c1117f9779b5");
    expect(flywheelL2PageId("1e", ctx.taxonomy)).toBe("21c9c770aa61832ead1b01f5d07b1ab3");
    expect(flywheelL2PageId("1e", { ...ctx.taxonomy, notion: { ...ctx.taxonomy.notion, l2_page_ids: { "미용기기": "5e49-c770" } } })).toBe("5e49c770");
    expect(flywheelL2PageId("zz", ctx.taxonomy)).toBeNull();
  });

  it("만들 수 없는 링크는 생략: JARVIS_URL 없음, 이름 없음, 모르는 규칙, 시장 불일치, 템플릿 없음", () => {
    const noJarvis = { ...ctx, jarvisUrl: null };
    expect(stockUrl("jarvis", hynix, noJarvis)).toBeNull();
    expect(stockLinks(hynix, noJarvis).map((x) => x.key)).not.toContain("jarvis");
    expect(stockUrl("sage", { ...hynix, name: "" }, ctx)).toBeNull();
    expect(stockUrl("nope", hynix, ctx)).toBeNull();
    expect(stockUrl("stockeasy", nvda, ctx)).toBeNull();
    const bare = { ...ctx, links: { ...ctx.links, stock: { naver: { label: "N", markets: ["KR", "US"] as ("KR" | "US")[] }, x: { label: "X", markets: ["KR"] as ("KR" | "US")[] } } } };
    expect(stockUrl("naver", hynix, bare)).toBeNull();
    expect(stockUrl("naver", nvda, bare)).toBeNull();
    expect(stockUrl("x", hynix, bare)).toBeNull();
  });

  it("키보드 배치는 layout 을 따르고 빈 행을 뺀다", () => {
    expect(stockKeyboard(hynix, ctx).map((r) => r.length)).toEqual([3, 3, 2]);
    expect(stockKeyboard(nvda, { ...ctx, jarvisUrl: null }).map((r) => r.map((b) => b.text))).toEqual([["⚡ HermesCall"], ["❄️ SnowBall", "🧙 Sage", "🔄 FlyWheel"], ["🟢 네이버증권"]]);
    const onlyKr = { ...ctx, links: { ...ctx.links, layout: { stock_card_rows: [["stockeasy"], ["naver"]] } } };
    expect(stockKeyboard(nvda, onlyKr)).toHaveLength(1);
  });

  it("여러 종목 메시지 텍스트 링크 (HTML escape)", () => {
    expect(inlineLinks({ ...hynix, name: "A&B<주>" }, ctx)).toBe(
      'A&amp;B&lt;주&gt; · <a href="https://m.stock.naver.com/domestic/stock/000660/total">네이버</a> · <a href="https://stockeasy.intellio.kr/stock-analysis/stock-info/000660">StockEasy</a> · <a href="https://heimdallr-call.vercel.app/stock/000660">Heimdallr</a> · <a href="https://jarvis.example.app/stock/KR%3A000660">JARVIS</a>');
    expect(inlineLinks(nvda, { ...ctx, jarvisUrl: undefined })).toBe('NVIDIA · <a href="https://m.stock.naver.com/worldstock/stock/NVDA.O/total">네이버</a>');
    expect(linkLine(nvda, { ...ctx, jarvisUrl: undefined })).toBe('🔗 <a href="https://m.stock.naver.com/worldstock/stock/NVDA.O/total">네이버</a> · <a href="https://hermes-call-psi.vercel.app/screener">HermesCall</a>');
    expect(linkLine(hynix, ctx)).toContain("🔗 <a href=\"https://m.stock.naver.com/domestic/stock/000660/total\">네이버</a> · ");
    const none = { ...ctx, links: { ...ctx.links, stock: {} } };
    expect(linkLine(nvda, none)).toBe("");
  });
});

describe("links — 스모크 판정", () => {
  const s = { login_redirect_ok: ["stockeasy", "sage", "snowball", "jarvis"], title_patterns: ["404", "찾을 수 없"], body_patterns: ["StockConflict"], min_body_bytes: 20 };
  const page = (title: string, extra = "") => `<html><head><title>${title}</title></head><body>${"x".repeat(50)}${extra}</body></html>`;
  it("200 정상 — 번들 속 404 문구는 무시하고 제목만 본다", () => {
    expect(evaluateLink("kr.heimdallr", 200, page("Heimdallr Call", "This page could not be found 페이지를 찾을 수 없습니다"), s)).toEqual({ ok: true, note: "200" });
    expect(htmlTitle("<TITLE lang=ko> 스탁이지 </TITLE>")).toBe("스탁이지");
    expect(htmlTitle("no title")).toBe("");
  });
  it("빈 화면(제목)·오류 본문·짧은 본문 실패", () => {
    expect(evaluateLink("kr.heimdallr", 200, page("404: This page could not be found."), s).ok).toBe(false);
    expect(evaluateLink("naver:us_resolve_api", 200, '{"code":"StockConflict"}' + "x".repeat(30), s)).toEqual({ ok: false, note: "오류 본문: StockConflict" });
    expect(evaluateLink("kr.heimdallr", 200, "short", s)).toEqual({ ok: false, note: "본문 5B" });
  });
  it("로그인 규칙은 3xx·401 정상, 그 외 3xx·4xx·무응답 실패", () => {
    expect(evaluateLink("dashboard.sage", 302, "", s)).toEqual({ ok: true, note: "302 로그인 이동(정상)" });
    expect(evaluateLink("kr.jarvis", 307, "", s).ok).toBe(true);
    expect(evaluateLink("fallback.snowball", 401, "", s).ok).toBe(true);
    expect(evaluateLink("kr.heimdallr", 308, "", s)).toEqual({ ok: false, note: "308 예상 밖 리다이렉트" });
    expect(evaluateLink("naver:us_resolve_api", 404, "", s)).toEqual({ ok: false, note: "HTTP 404" });
    expect(evaluateLink("kr.heimdallr", 401, "", s).ok).toBe(false);
    expect(evaluateLink("kr.heimdallr", null, "", s)).toEqual({ ok: false, note: "응답 없음" });
  });
});

describe("links — 네이버 미국 코드", () => {
  it("캐시 신선도·채택 조건", () => {
    const now = new Date("2026-09-28T00:00:00Z");
    expect(naverCacheFresh("2026-09-20T00:00:00Z", now, 30)).toBe(true);
    expect(naverCacheFresh("2026-08-01T00:00:00Z", now, 30)).toBe(false);
    expect(naverCacheFresh(null, now, 30)).toBe(false);
    expect(naverUsAccept(200, '{"reutersCode":"NVDA.O"}')).toBe(true);
    expect(naverUsAccept(409, '{"code":"StockConflict"}')).toBe(false);
    expect(naverUsAccept(200, '{"code":"StockConflict"}')).toBe(false);
    expect(naverUsAccept(200, "")).toBe(false);
  });

  it("어댑터: .O → .K → 접미사 없음, reutersCode 우선, 실패 시 null", async () => {
    const cfg = { us_resolve_api: "https://api/{symbol}{suffix}/basic", us_suffixes: [".O", ".K", ""] };
    const table: Record<string, [number, string]> = {
      "https://api/TSM.O/basic": [409, '{"code":"StockConflict"}'],
      "https://api/TSM.K/basic": [409, '{"code":"StockConflict"}'],
      "https://api/TSM/basic": [200, '{"reutersCode":"TSM"}'],
      "https://api/DELL.O/basic": [409, "StockConflict"],
      "https://api/DELL.K/basic": [200, "not json but ok body"],
    };
    const f = (async (url: string) => {
      if (url.includes("BOOM")) throw new Error("net");
      const [s, b] = table[url] ?? [409, '{"code":"StockConflict"}'];
      return new Response(b, { status: s });
    }) as unknown as typeof fetch;
    expect(await resolveNaverUs("TSM", cfg, f)).toBe("TSM");
    expect(await resolveNaverUs("DELL", cfg, f)).toBe("DELL.K");
    expect(await resolveNaverUs("ZZZZ", cfg, f)).toBeNull();
    expect(await resolveNaverUs("BOOM", cfg, f)).toBeNull();
  });
});
