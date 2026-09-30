import { describe, expect, it } from "vitest";
import { holdingsLite, industryHeat, tokenOk, weightBucket } from "./public-api";

describe("공개 API 응답", () => {
  it("비중 구간 (금액·정확한 비중 비노출)", () => {
    expect([weightBucket(null), weightBucket(0), weightBucket(0.01), weightBucket(0.03), weightBucket(0.07), weightBucket(0.2), weightBucket(NaN)]).toEqual(["없음", "없음", "<2%", "2~5%", "5~10%", "≥10%", "없음"]);
  });

  it("holdings-lite 는 수량·평단·평가액·정확한 비중을 담지 않는다", () => {
    const out = holdingsLite([{ entity_id: "KR:000660", ticker: "000660", name: "SK하이닉스", market: "KOSPI", asset_class: "stock", weight: 0.078, qty: 10, avg_cost_krw: 1 } as never,
      { entity_id: null, ticker: "F1", name: "펀드", market: "OTHER", asset_class: "fund", weight: 0.01 }], (id) => (id ? ["1b"] : []), (c) => (c === "1b" ? "반도체" : c));
    expect(out[0]).toEqual({ entity_id: "KR:000660", ticker: "000660", name: "SK하이닉스", market: "KOSPI", asset_class: "stock", l1: ["1b"], l1_names: ["반도체"], weight_bucket: "5~10%" });
    expect(Object.keys(out[0])).not.toContain("weight");
    expect(out[1].l1).toEqual([]);
  });

  it("industry-heat: M3 근거 3종", () => {
    const h = industryHeat("2026-09-30", [
      { l1: "1b", n_score: 10, c_score: 8, sentiment: 2, m3_pass: true, m3_median_rev_yoy_q0: 30.6, m3_median_rev_yoy_q1: 25, m3_members: 103,
        m3_basis: { bases: { realized: true, us_major_broker: true, outlook: false }, realized: { sample: "KR" }, us_major_broker: { median: 18, detail: [{ broker: "BofA Securities", value: 18, published: "2026-09-15", rule: "B2" }] }, outlook: [] } },
      { l1: "2e", n_score: null, c_score: null, sentiment: null, m3_pass: null, m3_median_rev_yoy_q0: null, m3_median_rev_yoy_q1: null, m3_members: 0, m3_basis: {} as never },
    ], (c) => ({ "1b": "반도체", "2e": "여행" }[c] ?? c));
    expect(h.industries[0]).toMatchObject({ name: "반도체", high_growth: true, bases: { realized: { pass: true, members: 103, sample: "KR" }, us_major_broker: { pass: true, median: 18 }, outlook: { pass: false, items: [] } } });
    expect(h.industries[1]).toMatchObject({ high_growth: false, bases: { realized: { pass: false, sample: null }, us_major_broker: { median: null, brokers: [] }, outlook: { items: [] } } });
  });

  it("토큰 비교", () => {
    expect(tokenOk("abc", "abc")).toBe(true);
    expect(tokenOk("abd", "abc")).toBe(false);
    expect(tokenOk("ab", "abc")).toBe(false);
    expect(tokenOk(null, "abc")).toBe(false);
    expect(tokenOk("abc", undefined)).toBe(false);
  });
});
