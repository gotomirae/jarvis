/**
 * 행동 큐 (PRD §6.4) — 위에서부터 판정, 한 종목은 가장 높은 큐 1개. 임계값은 rules.yaml `queues`·`axes.P`.
 * 🟢 진입 신호는 여기서 만들지 않는다(불변 규칙 4 — lib/engine/entry.ts 단일 함수, P3).
 */
import type { Axes } from "./axes";

export type Queue = "holding_alert" | "take_profit" | "buy" | "radar" | "pullback_wait";

export type QueueRules = {
  order: Queue[];
  take_profit: { heat_min: number; pri_min: number };
  buy: { min_signal_families: number };
  radar: { next_earnings_within_days: number };
  pullback_wait: { pri_alert_below: number };
};
export type PRules = { buy_max: number; pullback_min: number; take_profit_min: number };

export type QueueInput = {
  axes: Axes;
  heat: number | null;
  holdingAlert: boolean;
  daysToEarnings: number | null;
};

export type QueueResult = { queue: Queue; reason: Record<string, unknown> } | null;

export function assignQueue(inp: QueueInput, q: QueueRules, p: PRules): QueueResult {
  const a = inp.axes;
  const checks: Record<Queue, () => Record<string, unknown> | null> = {
    holding_alert: () => (a.h && inp.holdingAlert ? { held: true } : null),
    take_profit: () =>
      a.h && (inp.heat ?? -1) >= q.take_profit.heat_min && a.p !== null && a.p >= Math.max(q.take_profit.pri_min, p.take_profit_min)
        ? { heat: inp.heat, p: a.p } : null,
    buy: () =>
      a.f && a.p !== null && a.p < p.buy_max && (a.n || a.c) && a.families.length >= q.buy.min_signal_families
        ? { p: a.p, families: a.families, n: a.n, c: a.c } : null,
    radar: () =>
      a.n && a.c && !a.f && inp.daysToEarnings !== null && inp.daysToEarnings >= 0 && inp.daysToEarnings <= q.radar.next_earnings_within_days
        ? { days_to_earnings: inp.daysToEarnings, families: a.families } : null,
    pullback_wait: () =>
      a.f && a.p !== null && a.p >= p.pullback_min && (a.n || a.c) ? { p: a.p, alert_below: q.pullback_wait.pri_alert_below } : null,
  };
  for (const name of q.order) {
    const r = checks[name]();
    if (r) return { queue: name, reason: r };
  }
  return null;
}

export const QUEUE_LABEL: Record<Queue, string> = {
  holding_alert: "⚠️ 보유 경고", take_profit: "💰 익절 검토", buy: "🎯 매수 검토", radar: "🔭 선행 레이더", pullback_wait: "⏳ 눌림 대기",
};
