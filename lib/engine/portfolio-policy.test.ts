import { describe, expect, it } from "vitest";
import { regionLine, regionMix, tierOf, type PortfolioPolicy } from "./portfolio-policy";

const P: PortfolioPolicy = { tier_caps: { global_top20: 0.25, us: 0.1, kr: 0.1 }, overseas_band: { low: 0.5, high: 0.6, target: 0.55 }, domestic_markets: ["KOSPI", "KOSDAQ", "KONEX"] };

describe("해외 비중 50~60% (D67)", () => {
  it("regionMix: 비중 합 기준 · 비중 없는 행 제외 · 밴드 판정", () => {
    expect(regionMix([{ market: "NASDAQ", weight: 0.3 }, { market: "NYSE", weight: 0.25 }, { market: "KOSPI", weight: 0.45 }, { market: "OTHER", weight: null }], P)).toEqual({ overseas: expect.closeTo(0.55), domestic: expect.closeTo(0.45), status: "within" });
    expect(regionMix([{ market: "NASDAQ", weight: 0.7 }, { market: "KOSDAQ", weight: 0.3 }], P)?.status).toBe("over");
    expect(regionMix([{ market: "NASDAQ", weight: 0.2 }, { market: "KOSDAQ", weight: 0.3 }], P)?.status).toBe("under");
    expect(regionMix([], P)).toBeNull();
  });
  it("regionLine", () => {
    expect(regionLine(regionMix([{ market: "NASDAQ", weight: 0.55 }, { market: "KOSPI", weight: 0.45 }], P), P)).toBe("🌏 해외 55.0% · 국내 45.0% (목표 해외 50~60%) ✓ 범위 안");
    expect(regionLine(regionMix([{ market: "NASDAQ", weight: 0.7 }, { market: "KOSPI", weight: 0.3 }], P), P)).toBe("🌏 해외 70.0% · 국내 30.0% (목표 해외 50~60%) ▲ 10.0%p 초과 → 국내 비중 확대 검토");
    expect(regionLine(regionMix([{ market: "NASDAQ", weight: 0.4 }, { market: "KOSPI", weight: 0.6 }], P), P)).toBe("🌏 해외 40.0% · 국내 60.0% (목표 해외 50~60%) ▼ 10.0%p 미달 → 해외 비중 확대 검토");
    expect(regionLine(null, P)).toBe("🌏 해외 비중 자료 없음 (목표 해외 50~60%)");
  });
});

describe("종목 등급 상한 (D-71 표시, D69)", () => {
  it("글로벌 20위가 국적보다 먼저 · 국내 · 그 외 해외", () => {
    const Q = { ...P, global_top20_tickers: ["NVDA", "005930", "BRK.B"] };
    expect(tierOf({ ticker: "005930", market: "KOSPI" }, Q)).toEqual({ tier: "global_top20", cap: 0.25 });
    expect(tierOf({ ticker: "nvda", market: "NASDAQ" }, Q)).toEqual({ tier: "global_top20", cap: 0.25 });
    expect(tierOf({ ticker: "BRK-B", market: "NYSE" }, Q).tier).toBe("global_top20");
    expect(tierOf({ ticker: "000660.KS", market: "KOSPI" }, Q)).toEqual({ tier: "kr", cap: 0.1 });
    expect(tierOf({ ticker: "IONQ", market: "NYSE" }, P)).toEqual({ tier: "us", cap: 0.1 });
  });
});
