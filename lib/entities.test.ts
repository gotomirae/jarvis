import { describe, expect, it } from "vitest";
import { loadYaml } from "@/lib/config/load";
import type { TaxonomyRules } from "@/lib/taxonomy/match";
import { buildEntities, cleanUsName, entityId, krCode, marketOf, sanitizePosition, sectorMisfit, usSymbol } from "./entities";

const rules = loadYaml<TaxonomyRules>("taxonomy.yaml");
const now = new Date("2026-09-28T00:00:00Z");

describe("entities — 식별자 정규화", () => {
  it("market mapping", () => {
    expect(marketOf("KOSDAQ")).toBe("KR");
    expect(marketOf("nyse")).toBe("US");
    expect(marketOf("OTHER")).toBeNull();
    expect(marketOf(null)).toBeNull();
  });

  it("KR code / US symbol", () => {
    expect(krCode("000660.KS")).toBe("000660");
    expect(krCode("0080g0")).toBe("0080G0");
    expect(krCode("KR7005930003")).toBeNull();
    expect(krCode("ABCDEF")).toBeNull();
    expect(krCode(undefined)).toBeNull();
    expect(usSymbol("brk.b")).toBe("BRK.B");
    expect(usSymbol("1234")).toBeNull();
    expect(usSymbol(null)).toBeNull();
    expect(entityId("US", "NVDA")).toBe("US:NVDA");
  });

  it("미국 종목명 정리", () => {
    expect(cleanUsName("Lumentum Holdings Inc. - Common Stock")).toBe("Lumentum Holdings");
    expect(cleanUsName("GE Vernova Inc. Common Stock")).toBe("GE Vernova");
    expect(cleanUsName("Taiwan Semiconductor Manufacturing Company Ltd. - American Depositary Shares")).toBe("Taiwan Semiconductor Manufacturing Company");
    expect(cleanUsName("Meta Platforms")).toBe("Meta Platforms");
    expect(cleanUsName("Inc.")).toBe("Inc.");
  });

  it("holdings_cache 는 수량·평단·평가액을 버린다", () => {
    const s = sanitizePosition({ asset_id: "a", ticker: "000660", market: "KOSPI", qty: 10, avg_cost_krw: 1, market_value: 2, weight: 0.05, heat_score: 60 });
    expect(s).toEqual({ asset_id: "a", ticker: "000660", market: "KOSPI", weight: 0.05, heat_score: 60, entity_id: "KR:000660" });
    expect(sanitizePosition({ ticker: "NVDA", market: "NASDAQ" }).entity_id).toBe("US:NVDA");
    expect(sanitizePosition({ ticker: "KR5xxxx", market: "OTHER" }).entity_id).toBeNull();
  });
});

describe("entities — buildEntities", () => {
  const rows = buildEntities({
    krx: [
      { code: "000660", name: "SK하이닉스", sector: "반도체 IDM", products: "DRAM" },
      { code: "271560", name: "오리온", sector: "음식료" },
      { code: "010060", name: "OCI홀딩스", sector: "화학·소재" },
      { code: "BADCODE", name: "x" },
      { code: "123456", name: "제품만", sector: null, products: "스낵 등 식품류" },
      { code: "007690", name: "국도화학", sector: "유통·소비재", industry: "기초 화학물질 제조업", products: "에폭시수지" },
      { code: "004170", name: "신세계", sector: "유통·소비재", industry: "종합 소매업" },
      { code: "003550", name: "보유 화학", sector: "유통·소비재", industry: "기초 화학물질 제조업" },
    ],
    hermesWatch: [
      { symbol: "NVDA", name: "NVIDIA", market: "US", industries: ["AI인프라반도체"], active: true },
      { symbol: "000660.KS", name: "SK Hynix", market: "KR", industries: ["AI인프라반도체"] },
      { symbol: "7203.T", name: "Toyota", market: "JP", industries: [] },
      { symbol: "OLD", name: "Old", market: "US", industries: [], active: false },
      { symbol: "TSM", market: "US" },
    ],
    snowball: [
      { asset_id: "a-1", ticker: "000660", name: "SK하이닉스", market: "KOSPI", sector: "반도체 IDM", asset_class: "stock" },
      { asset_id: "a-2", ticker: "NVDA", name: "엔비디아", market: "NASDAQ", sector: "AI 팹리스", asset_class: "stock" },
      { asset_id: "a-3", ticker: "0080G0", name: "어떤 ETF", market: "KOSPI", sector: "S&P500", asset_class: "etf" },
      { asset_id: "a-4", ticker: "KR5000", name: "펀드", market: "OTHER", sector: "기타", asset_class: "fund" },
      { asset_id: "a-5", ticker: "AAPL", name: "Apple", market: "NASDAQ", sector: null, asset_class: null },
      { asset_id: "a-6", ticker: "003550", name: "보유 화학", market: "KOSPI", sector: "반도체 소재", asset_class: "stock" },
    ],
    hermesRefs: [
      { analysis_id: 5, symbol: "NVDA", market: "US" },
      { analysis_id: 9, symbol: "NVDA", market: "US" },
      { analysis_id: 7, symbol: "NVDA", market: "US" },
      { analysis_id: 3, symbol: "000660.KS", market: "KR" },
      { analysis_id: 1, symbol: "7203.T", market: "JP" },
    ],
    existing: [{ id: "US:NVDA", naver_us_code: "NVDA.O", naver_us_checked_at: "2026-09-20T00:00:00Z" }],
  }, rules, [], now);
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));

  it("KR/US 만, 잘못된 코드·JP·비활성·펀드 제외", () => {
    expect(Object.keys(by).sort()).toEqual(["KR:000660", "KR:003550", "KR:004170", "KR:007690", "KR:0080G0", "KR:010060", "KR:123456", "KR:271560", "US:AAPL", "US:NVDA", "US:TSM"]);
  });

  it("SnowBall 이름·자산·섹터 우선, 별칭 보존", () => {
    expect(by["US:NVDA"]).toMatchObject({ name: "엔비디아", aliases: ["NVIDIA"], snowball_asset_id: "a-2", primary_l1: "1a", l1_codes: ["1a", "1b"], l1_basis: "snowball" });
    expect(by["KR:000660"]).toMatchObject({ name: "SK하이닉스", aliases: ["SK Hynix"], snowball_asset_id: "a-1", primary_l1: "1b", l1_basis: "snowball" });
  });

  it("HermesCall 최신 분석 id, 네이버 코드 캐시 유지", () => {
    expect(by["US:NVDA"]).toMatchObject({ hermes_analysis_id: "9", naver_us_code: "NVDA.O", naver_us_checked_at: "2026-09-20T00:00:00Z" });
    expect(by["KR:000660"].hermes_analysis_id).toBe("3");
    expect(by["US:TSM"]).toMatchObject({ name: "TSM", hermes_analysis_id: null, naver_us_code: null, primary_l1: "ETC", l1_basis: "none" });
  });

  it("L1: Heimdallr 섹터·사용자 지정 기타·제품 설명·ETF", () => {
    expect(by["KR:271560"]).toMatchObject({ primary_l1: "2d", l1_basis: "heimdallr" });
    expect(by["KR:010060"]).toMatchObject({ primary_l1: "ETC", l1_basis: "heimdallr" });
    expect(by["KR:123456"]).toMatchObject({ primary_l1: "2d", l1_basis: "products" });
    expect(by["KR:0080G0"]).toMatchObject({ primary_l1: "ETF", asset_class: "etf", l1_basis: "override" });
    // Heimdallr '유통·소비재' 오분류 교정: 화학 제조업 → 기타, 소매업은 소비재 유지, SnowBall 섹터가 있으면 SnowBall 우선
    expect(by["KR:007690"]).toMatchObject({ primary_l1: "ETC", l1_codes: ["ETC"], l1_basis: "override" });
    expect(by["KR:004170"]).toMatchObject({ primary_l1: "2d", l1_basis: "heimdallr" });
    expect(by["KR:003550"]).toMatchObject({ primary_l1: "1b", l1_basis: "snowball" });
    expect(by["US:AAPL"]).toMatchObject({ asset_class: "stock", updated_at: "2026-09-28T00:00:00.000Z" });
  });

  it("오분류 판정", () => {
    const g = rules.heimdallr_sector_guard;
    expect(sectorMisfit("유통·소비재", "전기 통신업", g)).toBe(true);
    expect(sectorMisfit("유통·소비재", "봉제의복 제조업", g)).toBe(false);
    expect(sectorMisfit("유통·소비재", null, g)).toBe(false);
    expect(sectorMisfit("화학·소재", "기초 화학물질 제조업", g)).toBe(false);
    expect(sectorMisfit("유통·소비재", "기초 화학물질 제조업")).toBe(false);
  });

  it("기본 now", () => {
    expect(buildEntities({ krx: [], hermesWatch: [], snowball: [], hermesRefs: [], existing: [] }, rules)).toEqual([]);
  });
});
