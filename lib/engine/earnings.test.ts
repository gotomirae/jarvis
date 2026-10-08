import { describe, expect, it } from "vitest";
import { loadYaml } from "@/lib/config/load";
import { turnaroundOf, type QuarterRow, type TurnaroundRules } from "./earnings";

const T = loadYaml<{ entry_core: { M1_earnings_up_price_not: { turnaround: TurnaroundRules } } }>("rules.yaml").entry_core.M1_earnings_up_price_not.turnaround;
const q = (fy: number, fq: number, x: Partial<QuarterRow> = {}): QuarterRow => ({ fiscal_year: fy, fiscal_quarter: fq, ...x });

describe("영업이익 턴어라운드 (D68)", () => {
  it("rules.yaml 값: 전년 동기 영업이익 ≤ 0 · 매출 YoY > 0", () => {
    expect(T).toEqual({ op_now_positive: true, op_year_ago_max: 0, revenue_yoy_min_pct: 0 });
  });

  it("국내: 흑자 전환 + 매출 증가 → 통과 (라벨 '흑전' 또는 4분기 전 적자)", () => {
    const rows = [q(2025, 2, { op: -30 }), q(2026, 1, { op: 5, revenue_yoy: 3 }), q(2026, 2, { op: 12, revenue_yoy: 18.456, op_status_label: "흑전" })];
    expect(turnaroundOf(rows, T)).toEqual({ pass: true, quarter: "2026Q2", basis: "op", rev_yoy: 18.46, why: null });
    // 라벨만 있고 4분기 전 행이 없어도 인정
    expect(turnaroundOf([q(2026, 2, { op: "12", revenue_yoy: "5", op_status_label: "흑전" })], T).pass).toBe(true);
    // 라벨 없이 4분기 전 영업이익 0 이하
    expect(turnaroundOf([q(2025, 2, { op: 0 }), q(2026, 2, { op: 1, revenue_yoy: 1 })], T).pass).toBe(true);
  });

  it("탈락 사유: 적자 · 흑자 지속 · 매출 감소 · 데이터 없음", () => {
    expect(turnaroundOf([], T)).toEqual({ pass: false, quarter: null, basis: null, rev_yoy: null, why: "분기 실적 없음" });
    expect(turnaroundOf([q(2026, 2, { op: -5, revenue_yoy: 10, op_status_label: "적자축소" })], T).why).toBe("최근 분기 영업 적자");
    expect(turnaroundOf([q(2025, 2, { op: 10 }), q(2026, 2, { op: 20, revenue_yoy: 10 })], T).why).toBe("흑자 전환 아님(전년 동기도 흑자)");
    expect(turnaroundOf([q(2026, 2, { op: 20, revenue_yoy: 10 })], T).why).toBe("전년 동기 영업이익 데이터 없음");
    expect(turnaroundOf([q(2025, 2, { op: -1 }), q(2026, 2, { op: 2, revenue_yoy: -3 })], T).why).toBe("매출 감소");
    expect(turnaroundOf([q(2025, 2, { op: -1 }), q(2026, 2, { op: 2, revenue_yoy: 0 })], T).why).toBe("매출 감소");
    expect(turnaroundOf([q(2025, 2, { op: -1 }), q(2026, 2, { op: 2 })], T).why).toBe("매출 증가율 데이터 없음");
    expect(turnaroundOf([q(2026, 2, { revenue_yoy: 10 })], T)).toMatchObject({ pass: false, basis: null, why: "영업이익 데이터 없음" });
  });

  it("미국: 영업이익 없으면 주당순이익, 매출 YoY 는 저장값 없으면 같은 단위 매출로 계산", () => {
    const rows = [q(2025, 3, { eps: -0.2, revenue: 100, unit: "M" }), q(2026, 3, { eps: 0.15, revenue: 125, unit: "M" })];
    expect(turnaroundOf(rows, T)).toEqual({ pass: true, quarter: "2026Q3", basis: "eps", rev_yoy: 25, why: null });
    // 단위가 다르면 계산하지 않는다
    expect(turnaroundOf([rows[0], { ...rows[1], unit: "B" }], T).why).toBe("매출 증가율 데이터 없음");
    // 4분기 전 매출이 0 이하면 계산하지 않는다
    expect(turnaroundOf([{ ...rows[0], revenue: 0 }, rows[1]], T).why).toBe("매출 증가율 데이터 없음");
    // 주당순이익 기준에서는 '흑전' 라벨을 쓰지 않는다
    expect(turnaroundOf([q(2026, 3, { eps: 1, revenue_yoy: 5, op_status_label: "흑전" })], T).why).toBe("전년 동기 영업이익 데이터 없음");
  });

  it("추정치·잘못된 분기 무시, 같은 분기 중복은 첫 행", () => {
    const rows = [q(2026, 3, { op: 50, revenue_yoy: 10, is_estimate: true }), q(2026, 5, { op: 1 }), q(2025, 2, { op: -1 }), q(2026, 2, { op: 3, revenue_yoy: 2 }), q(2026, 2, { op: -9 })];
    expect(turnaroundOf(rows, T)).toMatchObject({ pass: true, quarter: "2026Q2" });
  });
});
