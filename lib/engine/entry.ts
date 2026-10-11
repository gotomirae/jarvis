/**
 * 진입 판정 (PRD §7, 불변 규칙 4 · SC6) — 순수 함수.
 * **🟢 는 이 파일의 entryLevel 하나만 만든다.** 조건: M1 ∧ M2 ∧ M3 ∧ M4 ∧ M5 그리고 진입 게이트 통과.
 * 게이트는 🟢 를 막을 수만 있고(거부권), 조건을 대신하거나 완화할 수 없다. DB 에도 같은 CHECK 제약이 있다(D20).
 *  · 🟡 관찰 = M1 ∧ M2 그리고 M3·M4·M5 중 2개 이상(🟢 가 아닐 때). 실시간 알림 없음.
 *  · M1·M2·M5 는 원 프로젝트 값(국내 Heimdallr entry_checks, 미국 HermesCall entry_checks_us)을 그대로 쓰고(D13),
 *    필드가 없으면 false(데이터 없음)로 두고 사유를 남긴다. 미국 M1 의 "반영도 낮음"은 JARVIS pri_us_lite < 50.
 *  · 원천 계산일이 기대 거래일보다 오래됐으면(원천 지연) M1·M2·M5 모두 false — 지난 값으로 🟢 를 만들지 않는다.
 */
export type Cond = { pass: boolean; reason: string | null };
export type Conds = { m1: Cond; m2: Cond; m3: Cond; m4: Cond; m5: Cond };
export type Level = "green" | "yellow" | "none";
export type Tag = "PB" | "SW" | "CU" | "PEAD_PB";
export type GateDecision = { allowed: boolean; reasons: string[] };

const ok: Cond = { pass: true, reason: null };
const no = (reason: string): Cond => ({ pass: false, reason });

/** 단일 🟢 생성 지점. 다섯 조건이 모두 true 이고 게이트가 허용할 때만 green */
export function entryLevel(c: { m1: boolean; m2: boolean; m3: boolean; m4: boolean; m5: boolean }, gate: GateDecision): Level {
  if (c.m1 === true && c.m2 === true && c.m3 === true && c.m4 === true && c.m5 === true && gate.allowed === true) return "green";
  return c.m1 && c.m2 && [c.m3, c.m4, c.m5].filter(Boolean).length >= 2 ? "yellow" : "none";
}

/** 원천 진입 점검 행(국내·미국 공통 정규화 결과) */
export type SourceCheck = {
  check_date: string;
  m1: Cond; m2: Cond; m5: Cond;
  price_state: "PB" | "SW" | null;
  cross_today: boolean;
  low_10d: number | null; low_20d: number | null; invalidation_price: number | null;
  detail: { m1: unknown; m2: unknown; m5: unknown };
};

type Raw = Record<string, unknown> & { check_date?: string; m1_pass?: boolean | null; m2_pass?: boolean | null; m5_pass?: boolean | null; m1_detail?: Record<string, unknown> | null; m2_detail?: Record<string, unknown> | null; m5_detail?: Record<string, unknown> | null };

const flag = (v: boolean | null | undefined, name: string, failText: string): Cond => (v === true ? ok : v === false ? no(failText) : no(`데이터 없음(${name})`));
const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/** Heimdallr entry_checks / HermesCall entry_checks_us 행 → SourceCheck. 미국 M1 은 pri_us_lite 로 "반영도 낮음"을 덧붙인다 */
export function normalizeCheck(r: Raw, market: "KR" | "US", priUsLite: number | null = null, priMax = 50): SourceCheck {
  const ps = r.m1_detail?.price_state;
  let m1 = flag(r.m1_pass, "m1_pass", "실적·주가 조건 미충족");
  if (market === "US" && m1.pass) m1 = priUsLite === null ? no("데이터 없음(미국 주가 반영도)") : priUsLite < priMax ? ok : no(`주가 반영도 ${priUsLite} ≥ ${priMax}`);
  return {
    check_date: String(r.check_date ?? ""),
    m1, m2: flag(r.m2_pass, "m2_pass", "MACD 교차 직전 아님"), m5: flag(r.m5_pass, "m5_pass", "매수 수급 3일 연속 아님"),
    price_state: ps === "PB" || ps === "SW" ? ps : null,
    cross_today: r.m2_detail?.cross_today === true,
    low_10d: numOrNull(r.low_10d), low_20d: numOrNull(r.low_20d), invalidation_price: numOrNull(r.invalidation_price),
    detail: { m1: r.m1_detail ?? null, m2: r.m2_detail ?? null, m5: r.m5_detail ?? null },
  };
}

/** 원천 계산일이 기대 거래일보다 오래됐으면 M1·M2·M5 를 데이터 없음으로 */
export function freshOrStale(c: SourceCheck, expectedDate: string | null): SourceCheck {
  if (!expectedDate || c.check_date >= expectedDate) return c;
  const s = no(`원천 지연(${c.check_date} 기준, 기대 ${expectedDate})`);
  return { ...c, m1: s, m2: s, m5: s };
}

/** 태그 우선순위: 실적 돌파 후 눌림 > 캐치업 > 눌림 > 횡보 */
export function entryTag(x: { armedBreakout: boolean; catalystWatch: boolean; priceState: "PB" | "SW" | null }): Tag | null {
  return x.armedBreakout ? "PEAD_PB" : x.catalystWatch ? "CU" : x.priceState;
}

/** 무효화선 (rules.yaml entry_gate.invalidation): PB 10일 최저 · SW 20일 최저 · CU 원천 무효화선(없으면 10일 최저) · PEAD_PB 돌파일 저가 */
export function invalidationPrice(tag: Tag | null, c: Pick<SourceCheck, "low_10d" | "low_20d" | "invalidation_price">, d0Low: number | null): number | null {
  if (tag === "PEAD_PB") return d0Low ?? c.low_10d;
  if (tag === "SW") return c.low_20d ?? c.invalidation_price;
  if (tag === "CU") return c.invalidation_price ?? c.low_10d;
  return c.low_10d ?? c.invalidation_price;
}

/** 조건별 결과를 묶는다 — M3·M4 는 JARVIS 계산 결과를 그대로 받는다 */
export function conds(c: SourceCheck, m3: Cond, m4: Cond): Conds {
  return { m1: c.m1, m2: c.m2, m3, m4, m5: c.m5 };
}

export const passOf = (c: Conds) => ({ m1: c.m1.pass, m2: c.m2.pass, m3: c.m3.pass, m4: c.m4.pass, m5: c.m5.pass });

/** 빠진 조건 이름 (🟡 사유·탈락 분포) */
export function missing(c: Conds): string[] {
  return (["m1", "m2", "m3", "m4", "m5"] as const).filter((k) => !c[k].pass).map((k) => k.toUpperCase());
}
