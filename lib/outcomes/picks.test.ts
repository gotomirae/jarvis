import { describe, expect, it } from "vitest";
import { featuresOf } from "@/lib/engine/feedback";
import { ledgerFromPicks, type PickNote } from "./ledger";
import { picksOf, recHistory, recLine, retPct } from "./rec-history";

const f = featuresOf({ p: 20, market: "KR", timing: { score: 5, verdict: "high", checks: { p: "pass" } } });
const idOf = (c: string) => (c === "005930" ? "KR:005930" : c === "AAPL" ? "US:AAPL" : null);

describe("ledgerFromPicks — 브리핑 후보 전체를 사후 검증 원장으로 (D54)", () => {
  const notes: PickNote[] = [
    { kind: "brief_evening", sent_at: "2026-10-06T10:20:00Z", payload: { candidates: [{ id: "KR:2", picked: true, rank: 2, features: f }, { id: "KR:2", picked: false, rank: null }] } },
    { kind: "brief_morning", sent_at: "2026-10-05T22:30:00Z", payload: { candidates: [{ id: "KR:2", picked: false, rank: null, features: f }, { id: "US:A", picked: true, rank: 1, features: f }, { id: "X:3", picked: true, rank: 3 }] } },
    { kind: "brief_evening", sent_at: "2026-10-05T10:20:00Z", payload: { candidates: [{ id: "KR:1", picked: true, rank: 1, features: f }, { id: "KR:1", picked: true, rank: 1 }] } },
    { kind: "brief_morning", sent_at: "2026-10-01T22:30:00Z", payload: { ideas: ["005930", "AAPL", "ZZZ"] } },
    { kind: "brief_morning", sent_at: null, payload: { ideas: ["005930"] } },
    { kind: "brief_morning", sent_at: "2026-10-02T22:30:00Z", payload: null },
  ];
  const rows = ledgerFromPicks(notes, idOf);
  it("종목·시장 날짜당 1건, 추천(top)·미추천(candidate) 모두", () => {
    expect(rows.map((r) => [r.dedupe_key, r.tag])).toEqual([
      ["pick:KR:005930:2026-10-02", "top"], ["pick:US:AAPL:2026-10-01", "top"],
      ["pick:KR:1:2026-10-05", "top"], ["pick:KR:2:2026-10-06", "top"], ["pick:US:A:2026-10-05", "top"],
    ]);
  });
  it("아침 미추천 → 저녁 추천이면 top 으로 합침, 특징·시점은 처음 기록 유지", () => {
    const r = rows.find((x) => x.entity_id === "KR:2")!;
    expect(r).toMatchObject({ event_type: "pick", market: "KR", level: "buy", benchmark: null, signal_date: "2026-10-06" });
    expect(r.payload).toMatchObject({ picked: true, rank: 2, brief: "brief_evening", signal_at: "2026-10-05T22:30:00.000Z", features: f, features_source: "brief" });
  });
  it("옛 브리핑(코드만)은 특징 없이, 미국은 S&P 500 기준", () => {
    expect(rows[0].payload).toMatchObject({ picked: true, rank: 1, features: null, features_source: null });
    expect(rows[1]).toMatchObject({ market: "US", benchmark: "SPX" });
  });
  it("미추천 후보만 있으면 candidate", () => {
    expect(ledgerFromPicks([{ kind: "brief_morning", sent_at: "2026-10-05T22:30:00Z", payload: { candidates: [{ id: "KR:9", picked: false, rank: null }] } }], idOf)[0].tag).toBe("candidate");
  });
});

describe("추천 이력 — 몇 번째 추천 · 첫 추천 이후 수익률 (D55)", () => {
  const notes = [
    { sent_at: "2026-10-01T10:20:00Z", payload: { picks: [{ id: "KR:1", price: 12500, price_date: "2026-10-01" }] } },
    { sent_at: "2026-09-28T10:20:00Z", payload: { ideas: ["005930"] } },
    { sent_at: "2026-09-27T10:20:00Z", payload: { picks: [{ id: "KR:1", price: 12000, price_date: "2026-09-26" }] } },
    { sent_at: "2026-10-02T10:20:00Z", payload: { picks: [{ id: "KR:1", price: null }, { id: "US:A" }] } },
    { sent_at: null, payload: { picks: [{ id: "KR:1", price: 1 }] } },
  ];
  it("picksOf: picks 우선, 없으면 옛 코드, payload 없음", () => {
    expect(picksOf(notes[1], idOf)).toEqual([{ id: "KR:005930" }]);
    expect(picksOf({ sent_at: "x", payload: null }, idOf)).toEqual([]);
    expect(picksOf({ sent_at: "x", payload: { ideas: ["ZZZ"] } }, idOf)).toEqual([]);
  });
  it("recHistory: 시간순 횟수·첫 기준가·최근 기준가(가격 없는 회차는 건너뜀)", () => {
    const h = recHistory(notes, idOf);
    expect(h.get("KR:1")).toEqual({ count: 3, first_at: "2026-09-27T10:20:00Z", first_price: 12000, first_price_date: "2026-09-26", last_at: "2026-10-02T10:20:00Z", last_price: 12500, last_price_date: "2026-10-01" });
    expect(h.get("KR:005930")).toMatchObject({ count: 1, first_price: null });
    expect(h.get("US:A")).toMatchObject({ count: 1, first_price: null, last_price: null });
  });
  it("recLine", () => {
    const base = { first_at: "2026-09-27T10:20:00Z", first_price: 12000, cur_price: 13200, cur_date: "2026-10-02", currency: "KRW" as const };
    expect(recLine({ ...base, nth: 3 })).toBe("🔁 3번째 추천 · 첫 추천 09/27 12,000원 → 13,200원 (10/02 종가) +10.0% 📈");
    expect(recLine({ ...base, nth: 2, cur_price: 10800 })).toBe("🔁 2번째 추천 · 첫 추천 09/27 12,000원 → 10,800원 (10/02 종가) -10.0% 📉");
    expect(recLine({ ...base, nth: 2, cur_price: 12000, cur_date: null })).toBe("🔁 2번째 추천 · 첫 추천 09/27 12,000원 → 12,000원 0.0% ➖");
    expect(recLine({ ...base, nth: 2, first_price: null })).toBe("🔁 2번째 추천 · 첫 추천 09/27 · 현재 13,200원 (10/02 종가)");
    expect(recLine({ ...base, nth: 2, first_price: null, cur_price: null })).toBe("🔁 2번째 추천 · 첫 추천 09/27");
    expect(recLine({ ...base, nth: 1, currency: "USD", cur_price: 101.5 })).toBe("🆕 첫 추천 · 기준가 $101.50 (10/02 종가)");
    expect(recLine({ ...base, nth: 1, cur_price: null })).toBe("🆕 첫 추천");
    expect(recLine({ ...base, nth: 4, first_at: null })).toBe("🆕 첫 추천 · 기준가 13,200원 (10/02 종가)");
  });
  it("retPct", () => {
    expect(retPct(100, 110)).toBeCloseTo(10);
    expect(retPct(null, 110)).toBeNull();
    expect(retPct(100, undefined)).toBeNull();
  });
});
