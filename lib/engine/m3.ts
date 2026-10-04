/**
 * M3 산업 고성장 종합 (PRD §7.3, D16): ① 실제 실적 · ② 미국 메이저 증권사 전망(adopted 만) · ③ yaml 성장 전망 중 하나 이상.
 * rules.yaml `required_bases` 에 적힌 근거는 반드시 충족해야 한다. 복수 L1 종목은 어느 L1 이든 통과면 통과, 충족 근거를 모두 표시.
 */
import { brokerKo } from "@/lib/labels";
import type { RealizedResult } from "./industry-growth";

export type OutlookEntry = { source_type: string; segment?: string; cagr_3y_pct?: number; value_pct?: number; source?: string; broker?: string; url?: string; as_of?: string; published_date?: string };
export type BrokerAgg = { median: number | null; pass: boolean; brokers: number; detail: { broker: string; value: number; published: string; rule: string }[] };
export type M3Rules = { pass_if_any: string[]; required_bases: string[]; outlook: { cagr_3y_min_pct: number; max_age_months: number } };

export type M3L1 = {
  l1: string; pass: boolean;
  bases: { realized: boolean; us_major_broker: boolean; outlook: boolean };
  realized: RealizedResult | null; broker: BrokerAgg | null;
  outlook: { segment: string; cagr: number; source: string; as_of: string; url?: string }[];
};

/** ③ yaml 전망: research/company/government, 출처·기준월 필수, 12개월 이내, CAGR ≥ 기준 */
export function outlookPass(entries: OutlookEntry[], r: M3Rules["outlook"], today: Date): M3L1["outlook"] {
  const out: M3L1["outlook"] = [];
  for (const e of entries) {
    if (e.source_type === "broker" || e.cagr_3y_pct === undefined || !e.source || !e.as_of) continue;
    const m = e.as_of.match(/^(\d{4})-(\d{2})/);
    if (!m) continue;
    const months = (today.getUTCFullYear() - Number(m[1])) * 12 + (today.getUTCMonth() + 1 - Number(m[2]));
    if (months > r.max_age_months || e.cagr_3y_pct < r.cagr_3y_min_pct) continue;
    out.push({ segment: e.segment ?? "", cagr: e.cagr_3y_pct, source: e.source, as_of: e.as_of, url: e.url });
  }
  return out;
}

export function m3ForL1(l1: string, realized: RealizedResult | null, broker: BrokerAgg | null, outlook: M3L1["outlook"], r: M3Rules): M3L1 {
  const bases = { realized: realized?.pass === true, us_major_broker: broker?.pass === true, outlook: outlook.length > 0 };
  const anyOk = r.pass_if_any.some((b) => bases[b as keyof typeof bases]);
  const requiredOk = r.required_bases.every((b) => bases[b as keyof typeof bases]);
  return { l1, pass: anyOk && requiredOk, bases, realized, broker, outlook };
}

/** 종목 M3: 소속 L1 중 하나라도 통과 */
export function m3ForEntity(l1Codes: string[], byL1: Record<string, M3L1>): { pass: boolean; passed: string[]; basis: string[] } {
  const passed = l1Codes.filter((c) => byL1[c]?.pass);
  const basis = new Set<string>();
  for (const c of passed) for (const [k, v] of Object.entries(byL1[c].bases)) if (v) basis.add(k);
  return { pass: passed.length > 0, passed, basis: [...basis].sort() };
}

/** 표시용 한 줄: "①실적 반도체 +24%·+21% (표본 38) · ②Morgan Stanley 30% (9/12)" */
export function m3Line(m: M3L1, l1Name: string): string {
  const parts: string[] = [];
  if (m.bases.realized && m.realized) parts.push(`①실적 ${l1Name} 매출 전년 대비 중앙값 ${fmt(m.realized.median_rev_yoy_q0)}·${fmt(m.realized.median_rev_yoy_q1)} (표본 ${m.realized.members})`);
  if (m.bases.us_major_broker && m.broker) parts.push(`②${m.broker.detail.map((d) => `${brokerKo(d.broker)} ${d.value}% (${d.published.slice(5).replace("-", "/")})`).join(", ")}`);
  if (m.bases.outlook) parts.push(`③${m.outlook.map((o) => `${o.source} ${o.cagr}%`).join(", ")}`);
  return parts.join(" · ") || "성장 근거 없음";
}

const fmt = (x: number | null) => (x === null ? "-" : `${x > 0 ? "+" : ""}${Math.round(x * 10) / 10}%`);
