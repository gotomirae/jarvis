import { describe, expect, it } from "vitest";
import { regionLine, regionMix, type PortfolioPolicy } from "./portfolio-policy";

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
