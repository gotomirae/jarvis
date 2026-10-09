import { describe, expect, it } from "vitest";
import { featuresOf, type FeedbackRules } from "@/lib/engine/feedback";
import { attribute, type Sample, type StatRow } from "./attribution";
import { reviewProposals } from "./review";

const cfg: FeedbackRules = { basis: "excess", report_horizons: [10, 20], primary_horizon: 20, min_samples: 3, shrinkage_k: 30, dimensions: ["families", "sources", "p_bucket", "market", "l1"], p_buckets: [20, 30, 40], timing_score_buckets: [1, 4], review: { min_gap_pctp: 2 } };
const fKR = featuresOf({ families: ["heimdallr", "sage"], p: 35, market: "KR", l1: "1b" });

describe("attribute", () => {
  it("큐·차원·구간·기간별 집계, 특징 없는 표본은 전체에만, 매도 쪽 적중은 음수", () => {
    const samples: Sample[] = [
      { scope: "buy", level: "buy", horizon_days: 20, ret_pct: 5, excess_pct: 3, features: fKR },
      { scope: "buy", level: "buy", horizon_days: 20, ret_pct: -2, excess_pct: -1, features: fKR },
      { scope: "buy", level: "buy", horizon_days: 20, ret_pct: 1, excess_pct: null, features: null },
      { scope: "holding_alert", level: "sell", horizon_days: 20, ret_pct: -4, excess_pct: -2, features: null },
      { scope: "holding_alert", level: "sell", horizon_days: 5, ret_pct: 1, excess_pct: null, features: null },
    ];
    const s = attribute(samples, cfg);
    const all = s.find((x) => x.scope === "buy" && x.dimension === "all")!;
    expect(all).toMatchObject({ n: 3, median_excess: 1, mean_excess: 1, hit_rate: 0.5, median_ret: 1, enough: true });
    expect(s.find((x) => x.scope === "buy" && x.dimension === "sources" && x.bucket === "sage")).toMatchObject({ n: 2, enough: false });
    expect(s.find((x) => x.scope === "buy" && x.dimension === "p_bucket")?.bucket).toBe("30~40");
    expect(s.find((x) => x.scope === "holding_alert" && x.horizon_days === 20)).toMatchObject({ hit_rate: 1 });
    expect(s.find((x) => x.scope === "holding_alert" && x.horizon_days === 5)).toMatchObject({ median_excess: null, mean_excess: null, hit_rate: null });
    expect(s[0].scope).toBe("buy");
    expect(s[s.length - 1]).toMatchObject({ scope: "holding_alert", horizon_days: 20 });
    // 절대 수익률 채점(D69): 승률 = 수익률 > 0 비율 (초과수익이 없어도 채점), 매도 쪽은 수익률 < 0
    const a = attribute(samples, { ...cfg, basis: "absolute" });
    expect(a.find((x) => x.scope === "buy" && x.dimension === "all")).toMatchObject({ hit_rate: 0.67, median_excess: 1 });
    expect(a.find((x) => x.scope === "holding_alert" && x.horizon_days === 5)).toMatchObject({ hit_rate: 0 });
  });
});

describe("reviewProposals (제안만)", () => {
  const row = (scope: string, dimension: string, bucket: string, median_excess: number | null, n = 40, horizon_days = 20): StatRow =>
    ({ scope, dimension, bucket, horizon_days, n, median_excess, mean_excess: median_excess, hit_rate: 0.4, median_ret: 0, enough: n >= 3 });
  const cur = { buy_max: 40, min_signal_families: 2 };

  it("근거가 충분할 때만 임계값·정보 제안", () => {
    const stats = [
      row("buy", "all", "all", 1),
      row("buy", "p_bucket", "30~40", -2),          // 전체보다 3%p 나쁨·음수 → 상한 40 → 30
      row("buy", "families", "2", -1.5),            // 2.5%p 나쁨 → 2 → 3
      row("buy", "sources", "sage", -1.5),          // 부진
      row("buy", "sources", "heimdallr", 3.5),      // 우수
      row("buy", "l1", "1b", 0.5),                  // 차이 작음 → 없음
      row("buy", "market", "KR", -9),               // 시장 차원은 제안 대상 아님
      row("buy", "sources", "flywheel", -9, 2),     // 표본 부족 → 무시
      row("buy", "sources", "x", -9, 40, 5),        // 다른 기간 → 무시
      row("radar", "all", "all", -0.5),
      row("pullback_wait", "all", "all", 0.5),
      row("holding_alert", "all", "all", 1.2),
      row("take_profit", "all", "all", -1),
    ];
    const p = reviewProposals(stats, cur, cfg, (s) => `[${s}]`);
    expect(p.filter((x) => x.kind === "threshold")).toEqual([
      expect.objectContaining({ rule: "axes.P.buy_max", current: 40, suggested: 30 }),
      expect.objectContaining({ rule: "queues.buy.min_signal_families", current: 2, suggested: 3 }),
    ]);
    const titles = p.filter((x) => x.kind === "info").map((x) => x.title);
    expect(titles).toEqual([
      "신호원 sage: 🎯 성과 부진 — 가중·조건 재검토",
      "신호원 heimdallr: 🎯 성과 우수 — 유지·강화 검토",
      "[radar]: 시장보다 약함 — 조건 재검토",
      "[holding_alert]: 경고 뒤 오히려 시장보다 강함 — 경고 기준 재검토",
    ]);
    expect(p[0].evidence).toContain("20거래일 시장 대비 중앙값 -2.00%, 이긴 비율 40% (40건)");
  });

  it("🎯 전체 음수면 전반 재검토, 표본 부족·상한 불일치면 임계값 제안 없음", () => {
    const p = reviewProposals([row("buy", "all", "all", -3), { ...row("buy", "p_bucket", "30~40", -9), hit_rate: null }], { buy_max: 35, min_signal_families: 2 }, cfg);
    expect(p.map((x) => x.title)).toEqual(["🎯 매수 검토 전체가 시장보다 약함 — 조건 전반 재검토"]);
    expect(reviewProposals([row("buy", "all", "all", 1, 2), row("buy", "p_bucket", "30~40", -9)], cur, cfg)).toEqual([]);
    expect(reviewProposals([row("buy", "all", "all", 1), row("buy", "p_bucket", "30~40", 0.5), row("buy", "families", "2", -0.5)], cur, cfg)).toEqual([]);
    expect(reviewProposals([row("buy", "all", "all", 1), row("buy", "p_bucket", "<20", -9)], { buy_max: 20, min_signal_families: 2 }, cfg)).toEqual([]);
    expect(reviewProposals([row("radar", "all", "all", null)], cur, cfg)).toEqual([]);
    expect(reviewProposals([row("radar", "all", "all", -1)], cur, cfg)[0].title).toBe("radar: 시장보다 약함 — 조건 재검토");
  });
});
