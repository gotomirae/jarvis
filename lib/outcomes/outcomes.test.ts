import { describe, expect, it } from "vitest";
import { benchmarkFor, ledgerFromQueues, ledgerFromSubmits, yahooCandidates, type QueueItem } from "./ledger";
import { closeOnOrBefore, lastCompleteDate, marketDate, measure, type Bar } from "./returns";
import { median, scorecard, type ScoreInput } from "./scorecard";

/** 평일만 이어지는 가짜 일봉 (휴장일 = 주말) */
function series(start: string, n: number, f: (i: number) => number): Bar[] {
  const out: Bar[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  for (let i = 0; out.length < n; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    out.push({ date: d.toISOString().slice(0, 10), close: f(i++) });
  }
  return out;
}

describe("returns.marketDate / lastCompleteDate", () => {
  it("KST 07:12 신호의 미국 날짜는 전날, 국내는 당일", () => {
    const at = new Date("2026-09-29T07:12:00+09:00");
    expect(marketDate(at, "KR")).toBe("2026-09-29");
    expect(marketDate(at, "US")).toBe("2026-09-28");
  });
  it("장 마감 전이면 전날까지만 확정", () => {
    expect(lastCompleteDate(new Date("2026-10-01T14:00:00+09:00"), "KR")).toBe("2026-09-30");
    expect(lastCompleteDate(new Date("2026-10-01T20:00:00+09:00"), "KR")).toBe("2026-10-01");
    // 20:00 KST = 07:00 ET 같은 날 → 미국 전날 종가까지
    expect(lastCompleteDate(new Date("2026-10-01T20:00:00+09:00"), "US")).toBe("2026-09-30");
    expect(lastCompleteDate(new Date("2026-10-01T17:00:00-04:00"), "US")).toBe("2026-10-01");
    expect(lastCompleteDate(new Date("2026-10-01T00:30:00+09:00"), "KR")).toBe("2026-09-30");
  });
});

describe("returns.measure", () => {
  const stock = series("2026-09-28", 70, (i) => 100 + i);       // 9/28(월) 100, 9/29 101 …
  const bench = series("2026-09-28", 70, (i) => 1000 + i * 5);
  const H = [5, 20, 40, 60];

  it("진입 = 신호일 다음 첫 거래일 종가, D+N 은 거래일 기준", () => {
    const m = measure(stock, bench, "2026-09-29", H, "2027-12-31");
    expect(m.entry).toEqual({ date: "2026-09-30", close: 102 });
    expect(m.outcomes.map((o) => o.horizon_days)).toEqual([5, 20, 40, 60]);
    const d5 = m.outcomes[0];
    expect(d5.horizon_date).toBe("2026-10-07");
    expect(d5.price).toBe(107);
    expect(d5.ret_pct).toBeCloseTo((107 / 102 - 1) * 100, 3);
    expect(d5.bench_ret_pct).toBeCloseTo((1035 / 1010 - 1) * 100, 3);
    expect(d5.excess_pct).toBeCloseTo(d5.ret_pct - (d5.bench_ret_pct as number), 3);
  });

  it("주말 신호 → 다음 월요일 진입", () => {
    expect(measure(stock, bench, "2026-10-03", H, "2027-12-31").entry?.date).toBe("2026-10-05");
  });

  it("확정 종가 상한 이후 봉·아직 오지 않은 기간은 쓰지 않음", () => {
    const m = measure(stock, bench, "2026-09-29", H, "2026-10-28");
    expect(m.outcomes.map((o) => o.horizon_days)).toEqual([5, 20]);
  });

  it("진입일이 아직 없으면 entry null", () => {
    expect(measure(stock, bench, "2026-09-29", H, "2026-09-29")).toEqual({ entry: null, outcomes: [] });
  });

  it("벤치마크가 없거나 날짜가 비면 초과수익 null", () => {
    const a = measure(stock, null, "2026-09-29", [5], "2027-12-31");
    expect(a.outcomes[0].bench_ret_pct).toBeNull();
    expect(a.outcomes[0].excess_pct).toBeNull();
    const late = bench.filter((b) => b.date > "2026-10-01");     // 진입일 이전 벤치 봉 없음
    expect(measure(stock, late, "2026-09-29", [5], "2027-12-31").outcomes[0].excess_pct).toBeNull();
  });

  it("벤치마크 휴장일은 직전 종가 사용", () => {
    const holed = bench.filter((b) => b.date !== "2026-10-07");
    const o = measure(stock, holed, "2026-09-29", [5], "2027-12-31").outcomes[0];
    expect(o.bench_ret_pct).toBeCloseTo((1030 / 1010 - 1) * 100, 3);
  });

  it("closeOnOrBefore", () => {
    expect(closeOnOrBefore(stock, "2026-09-27")).toBeNull();
    expect(closeOnOrBefore(stock, "2026-10-04")?.date).toBe("2026-10-02");
  });
});

describe("ledger", () => {
  const items: QueueItem[] = [
    { date: "2026-09-29", entity_id: "KR:000660", queue: "buy", reason: { p: 30 }, first_seen: "2026-09-29T07:12:00+09:00" },
    { date: "2026-09-30", entity_id: "KR:000660", queue: "buy", reason: { p: 31 }, first_seen: "2026-09-28T22:12:00.000Z" },   // 같은 구간(표기만 다름)
    { date: "2026-10-01", entity_id: "KR:000660", queue: "buy", reason: null, first_seen: "2026-10-01T07:12:00+09:00" },      // 새 구간
    { date: "2026-09-29", entity_id: "US:NVDA", queue: "holding_alert", reason: { held: true }, first_seen: "2026-09-29T07:12:00+09:00" },
    { date: "2026-09-29", entity_id: "KR:417840", queue: "radar", reason: {}, first_seen: "2026-09-29T19:10:00+09:00" },
    { date: "2026-09-29", entity_id: "XX:1", queue: "buy", reason: {}, first_seen: "2026-09-29T07:12:00+09:00" },
    { date: "2026-09-29", entity_id: "KR:005930", queue: "unknown", reason: {}, first_seen: "2026-09-29T07:12:00+09:00" },
  ];
  const yahoo = new Map([["KR:000660", "000660.KS"], ["KR:417840", "417840.KQ"]]);

  it("큐 진입 구간 1개 = 원장 1행, 첫 행의 근거 유지", () => {
    const rows = ledgerFromQueues(items, yahoo);
    expect(rows).toHaveLength(4);
    const hy = rows.filter((r) => r.entity_id === "KR:000660");
    expect(hy).toHaveLength(2);
    expect(hy[0]).toMatchObject({ event_type: "queue", tag: "buy", level: "buy", signal_date: "2026-09-29", benchmark: "KOSPI", payload: { reason: { p: 30 }, queue_date: "2026-09-29" } });
    expect(hy[0].payload.initial_state).toBe(true);
    expect(hy[1].payload.reason).toEqual({});
    expect(hy[1].payload.initial_state).toBeUndefined();
    expect(rows.find((r) => r.entity_id === "US:NVDA")).toMatchObject({ level: "sell", market: "US", benchmark: "SPX", signal_date: "2026-09-28" });
    expect(rows.find((r) => r.entity_id === "KR:417840")?.benchmark).toBe("KOSDAQ");
  });

  it("SnowBall 제출: 성공분만, 종목·신호일당 1건(연타 중복 제거)", () => {
    const rows = ledgerFromSubmits([
      { entity_id: "US:GEV", dedupe_key: "submit:US:GEV:2", sent_at: "2026-09-29T13:35:00Z", payload: { idea_id: "y", queue: "buy" } },
      { entity_id: "US:GEV", dedupe_key: "submit:US:GEV:1", sent_at: "2026-09-29T13:31:00Z", payload: { idea_id: "x", queue: "buy" } },
      { entity_id: "KR:417840", dedupe_key: "submit:KR:417840:1", sent_at: "2026-09-29T13:31:00Z", payload: null },
      { entity_id: "US:LITE", dedupe_key: "submit:US:LITE:1", sent_at: null, payload: { error: "x" } },
      { entity_id: null, dedupe_key: "k", sent_at: "2026-09-29T13:31:00Z", payload: null },
      { entity_id: "ZZ:1", dedupe_key: "k2", sent_at: "2026-09-29T13:31:00Z", payload: null },
    ], new Map());
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ event_type: "snowball_submit", tag: "buy", dedupe_key: "snowball_submit:US:GEV:2026-09-29", benchmark: "SPX", payload: { idea_id: "x", source_key: "submit:US:GEV:1" } });
    expect(rows[1]).toMatchObject({ tag: "manual", benchmark: null, payload: { idea_id: null, queue: null } });
  });

  it("benchmarkFor / yahooCandidates", () => {
    expect(benchmarkFor("KR", null)).toBeNull();
    expect(benchmarkFor("KR", "005930.KS")).toBe("KOSPI");
    expect(yahooCandidates("US:BRK.B", null)).toEqual(["BRK-B"]);
    expect(yahooCandidates("KR:005930", "005930.KS")).toEqual(["005930.KS"]);
    expect(yahooCandidates("KR:417840", null)).toEqual(["417840.KQ", "417840.KS"]);
  });
});

describe("scorecard", () => {
  it("median", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });

  it("적중 = 절대 수익률(D69): 매수는 수익률 > 0, 매도는 < 0", () => {
    const rows: ScoreInput[] = [
      { event_type: "queue", tag: "buy", level: "buy", market: "KR", horizon_days: 5, ret_pct: 3, excess_pct: 2 },
      { event_type: "queue", tag: "buy", level: "buy", market: "KR", horizon_days: 5, ret_pct: -1, excess_pct: -2 },
      { event_type: "queue", tag: "buy", level: "buy", market: "KR", horizon_days: 5, ret_pct: 5, excess_pct: 4 },
      { event_type: "queue", tag: "holding_alert", level: "sell", market: "KR", horizon_days: 5, ret_pct: -3, excess_pct: -1 },
      { event_type: "queue", tag: "holding_alert", level: "sell", market: "KR", horizon_days: 20, ret_pct: 1, excess_pct: null },
      { event_type: "queue", tag: "buy", level: "buy", market: "KR", horizon_days: 20, ret_pct: 1, excess_pct: 1 },
    ];
    const s = scorecard(rows, 3);
    expect(s.map((r) => `${r.tag}:${r.horizon_days}`)).toEqual(["buy:5", "buy:20", "holding_alert:5", "holding_alert:20"]);
    expect(s[0]).toMatchObject({ n: 3, median_ret: 3, median_excess: 2, mean_excess: 1.33, hit_rate: 0.67, enough: true });
    expect(s[1].enough).toBe(false);
    expect(s[2].hit_rate).toBe(1);
    expect(s[3]).toMatchObject({ median_excess: null, mean_excess: null, hit_rate: 0 });
  });

  it("정렬: 이벤트 → 태그 → 시장 → 기간", () => {
    const base = { level: "buy" as const, ret_pct: 0, excess_pct: 0 };
    const s = scorecard([
      { ...base, event_type: "snowball_submit", tag: "buy", market: "KR", horizon_days: 5 },
      { ...base, event_type: "queue", tag: "buy", market: "US", horizon_days: 5 },
      { ...base, event_type: "queue", tag: "buy", market: "KR", horizon_days: 5 },
    ], 30);
    expect(s.map((r) => `${r.event_type}:${r.market}`)).toEqual(["queue:KR", "queue:US", "snowball_submit:KR"]);
  });
});

describe("ledger — 🟢🟡🔵 (P3)", () => {
  it("단계별 연속 구간 1건, 특징 고정 저장", async () => {
    const { ledgerFromEntry, ledgerFromBreakouts } = await import("./ledger");
    const ev = { families: ["sage", "heimdallr"], p: 30, grade: "★", missing: ["M4"] };
    const rows = ledgerFromEntry([
      { date: "2026-10-05", entity_id: "KR:1", market: "KR", level: "yellow", tag: "PB", invalidation_price: 90, evidence: ev },
      { date: "2026-10-01", entity_id: "KR:1", market: "KR", level: "yellow", tag: "PB", invalidation_price: 90, evidence: ev },
      { date: "2026-10-20", entity_id: "KR:1", market: "KR", level: "yellow", tag: null, invalidation_price: null, evidence: null },
      { date: "2026-10-02", entity_id: "US:A", market: "US", level: "green", tag: "SW", invalidation_price: 10, evidence: {} },
      { date: "2026-10-02", entity_id: "US:B", market: "US", level: "none", tag: null, invalidation_price: null, evidence: null },
    ], (id) => (id === "KR:1" ? "1b" : null));
    expect(rows.map((r) => r.dedupe_key)).toEqual(["yellow:KR:1:2026-10-01", "green:US:A:2026-10-02", "yellow:KR:1:2026-10-20"]);
    expect(rows[0]).toMatchObject({ event_type: "yellow", tag: "PB", level: "buy", benchmark: null, payload: { features: { families: ["heimdallr", "sage"], p: 30, grade: "★", market: "KR", l1: "1b" }, missing: ["M4"] } });
    expect(rows[1]).toMatchObject({ event_type: "green", benchmark: "SPX", payload: { features: { families: [], p: null, grade: null, l1: null } } });
    expect(rows[2]).toMatchObject({ tag: "yellow", payload: { missing: [] } });
    const b = ledgerFromBreakouts([{ entity_id: "KR:2", source: "K1", d0: "2026-10-01", d0_low: 5 }, { entity_id: "US:C", source: "H1", d0: "2026-10-01", d0_low: null }, { entity_id: "X:1", source: "K1", d0: "2026-10-01", d0_low: null }]);
    expect(b.map((x) => [x.dedupe_key, x.benchmark])).toEqual([["blue:KR:2:K1:2026-10-01", null], ["blue:US:C:H1:2026-10-01", "SPX"]]);
  });
});
