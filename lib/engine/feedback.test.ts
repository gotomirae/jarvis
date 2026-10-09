import { describe, expect, it } from "vitest";
import { bucketsOf, featuresOf, metricOf, pBucket, perfLine, perfPrior, type FeedbackRules, type PerfStat } from "./feedback";
import { rankBuy } from "./idea";

const cfg: FeedbackRules = { basis: "excess", report_horizons: [10, 20], primary_horizon: 20, min_samples: 30, shrinkage_k: 30, dimensions: ["families", "sources", "p_bucket", "grade", "market", "l1"], p_buckets: [40, 20, 30], timing_score_buckets: [1, 4], review: { min_gap_pctp: 2 } };
const f = featuresOf({ families: ["sage", "heimdallr"], p: 25, grade: "★", market: "KR", l1: "1b" });
const st = (dimension: string, bucket: string, n: number, median_excess: number | null, extra: Partial<PerfStat> = {}): PerfStat => ({ scope: "buy", dimension, bucket, horizon_days: 20, n, median_excess, hit_rate: 0.6, ...extra });

describe("feedback 구간", () => {
  it("featuresOf: 계열 정렬·결측 기본값", () => {
    expect(f.families).toEqual(["heimdallr", "sage"]);
    expect(featuresOf({ p: null, market: "US" })).toEqual({ families: [], p: null, grade: null, market: "US", l1: null });
  });
  it("pBucket", () => {
    expect(pBucket(null, cfg.p_buckets)).toBe("없음");
    expect(pBucket(10, cfg.p_buckets)).toBe("<20");
    expect(pBucket(25, cfg.p_buckets)).toBe("20~30");
    expect(pBucket(35, cfg.p_buckets)).toBe("30~40");
    expect(pBucket(40, cfg.p_buckets)).toBe("≥40");
  });
  it("bucketsOf: 전체 + 차원별, 신호원은 여러 구간", () => {
    expect(bucketsOf(f, cfg)).toEqual([
      { dimension: "all", bucket: "all" }, { dimension: "families", bucket: "2" }, { dimension: "sources", bucket: "heimdallr" }, { dimension: "sources", bucket: "sage" },
      { dimension: "p_bucket", bucket: "20~30" }, { dimension: "grade", bucket: "★" }, { dimension: "market", bucket: "KR" }, { dimension: "l1", bucket: "1b" },
    ]);
    const g = featuresOf({ families: ["a", "b", "c", "d"], p: null, market: "US" });
    expect(bucketsOf(g, cfg).filter((b) => ["families", "grade", "l1"].includes(b.dimension)).map((b) => b.bucket)).toEqual(["4+", "없음", "없음"]);
  });
});

describe("타이밍 차원 (D54) — 타이밍이 있는 특징(브리핑 후보)에만", () => {
  const tc = { ...cfg, dimensions: ["market", "timing_verdict", "timing_score", "timing_check"] as FeedbackRules["dimensions"] };
  it("단계·점수 구간·항목별", () => {
    const g = featuresOf({ p: 20, market: "KR", timing: { score: 5, verdict: "high", checks: { p: "pass", rsi: "fail" } } });
    expect(g.timing).toEqual({ score: 5, verdict: "high", checks: { p: "pass", rsi: "fail" } });
    expect(bucketsOf(g, tc)).toEqual([
      { dimension: "all", bucket: "all" }, { dimension: "market", bucket: "KR" }, { dimension: "timing_verdict", bucket: "high" },
      { dimension: "timing_score", bucket: "≥4" }, { dimension: "timing_check", bucket: "p:pass" }, { dimension: "timing_check", bucket: "rsi:fail" },
    ]);
    expect(bucketsOf(featuresOf({ p: 20, market: "KR" }), tc)).toEqual([{ dimension: "all", bucket: "all" }, { dimension: "market", bucket: "KR" }]);
  });
  it("주가 위치 경로 · 시장 국면 (D69)", () => {
    const pc = { ...cfg, dimensions: ["setup_path", "market_phase"] as FeedbackRules["dimensions"] };
    const g = featuresOf({ p: 20, market: "KR", phase: "up", timing: { score: 5, verdict: "high", checks: {}, path: "base" } });
    expect(g.phase).toBe("up");
    expect(bucketsOf(g, pc)).toEqual([{ dimension: "all", bucket: "all" }, { dimension: "setup_path", bucket: "base" }, { dimension: "market_phase", bucket: "up" }]);
    expect(bucketsOf(featuresOf({ p: 20, market: "KR", timing: { score: 1, verdict: "mid", checks: {} } }), pc)).toEqual([{ dimension: "all", bucket: "all" }, { dimension: "setup_path", bucket: "none" }]);
    expect(metricOf({ median_excess: 1, median_ret: 3 }, "absolute")).toBe(3);
    expect(metricOf({ median_excess: 1 }, "absolute")).toBeNull();
    expect(metricOf({ median_excess: 1, median_ret: 3 }, "excess")).toBe(1);
  });
  it("절대 수익률 카드 줄", () => {
    const ab = { ...cfg, basis: "absolute" as const };
    const stats = [st("all", "all", 60, 1, { median_ret: 4 }), st("market", "KR", 40, 1, { median_ret: 6 })];
    expect(perfLine(perfPrior(f, stats, "buy", ab), ab)).toBe("비슷한 신호의 기대 수익률 +3.4% — 순위 반영 (근거: 시장 KR +6.0%(40건)) · 같은 큐 20거래일 뒤 수익률 +4.0% · 승률 60% (60건)");
  });
});

describe("perfPrior · perfLine · rankBuy 반영", () => {
  it("데이터 없음 → score·overall null, 카드 줄 없음", () => {
    const p = perfPrior(f, [], "buy", cfg);
    expect(p).toEqual({ score: null, basis: [], overall: null });
    expect(perfLine(p, cfg)).toBeNull();
    expect(perfLine({ score: null, basis: [], overall: st("all", "all", 0, null) }, cfg)).toBeNull();
  });
  it("표본 부족 구간만 → score null, 반영하지 않는다고 표시", () => {
    const p = perfPrior(f, [st("all", "all", 12, 1.5), st("market", "KR", 12, 1.5)], "buy", cfg);
    expect(p.score).toBeNull();
    expect(perfLine(p, cfg)).toBe("같은 큐 20거래일 뒤 시장 대비 +1.5% · 승률 60% (12건) — 표본 30건 전이라 순위에는 아직 반영하지 않음");
    expect(perfLine({ ...p, overall: { ...p.overall!, median_excess: null, hit_rate: null } }, cfg)).toContain("시장 대비 - (12건)");
  });
  it("충분한 구간만 축소 평균 — 다른 큐·기간·결측 중앙값은 무시", () => {
    const stats = [
      st("all", "all", 60, 1), st("market", "KR", 30, 4), st("families", "2", 90, -1),
      st("l1", "1b", 100, null), st("grade", "★", 10, 9),
      st("market", "KR", 500, 50, { scope: "radar" }), st("market", "KR", 500, 50, { horizon_days: 5 }),
    ];
    const p = perfPrior(f, stats, "buy", cfg);
    // KR: 30/60×4 = 2 · 계열2: 90/120×(−1) = −0.75 → 평균 0.625
    expect(p.score).toBe(0.63);
    expect(p.basis.map((b) => b.dimension)).toEqual(["families", "market"]);
    expect(perfLine(p, cfg, (d, b) => (d === "market" ? "국내" : b))).toBe("비슷한 신호의 기대 초과수익 +0.6% — 순위 반영 (근거: 합의한 신호 계열 수 2 -1.0%(90건), 시장 국내 +4.0%(30건)) · 같은 큐 20거래일 뒤 시장 대비 +1.0% · 승률 60% (60건)");
    expect(perfLine({ ...p, basis: [{ dimension: "x", bucket: "y", n: 1, median_excess: 0 }] }, cfg)).toContain("x y 0.0%(1건)");
  });
  it("rankBuy: 성과가 있으면 첫 기준, 없는 후보는 뒤", () => {
    const base = { families: 2, p: 30, industryGrowth: null, nextEvent: null };
    const xs = [{ entity_id: "a", ...base, families: 4 }, { entity_id: "b", ...base, perf: 1 }, { entity_id: "c", ...base, perf: 3 }, { entity_id: "d", ...base, perf: null }];
    expect(rankBuy(xs).map((x) => x.entity_id)).toEqual(["c", "b", "a", "d"]);
  });
});
