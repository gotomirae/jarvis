/**
 * calibration_review (PRD §12 보정 · §14 분기 첫 토 10:30, D49) — 신호 성적표 + 보정 제안을 기록하고 텔레그램으로 알린다.
 * **rules.yaml 을 바꾸지 않는다.** 제안은 calibration_reviews(status=open)에 남고, 사용자가 승인하면
 * Claude Code 세션에서 rules.yaml 변경 + docs/DECISIONS.md 기록 후 status 를 applied/rejected 로 바꾼다.
 * 매주 토요일 호출되지만 분기 첫 토요일에만 실행한다(--force 로 수동 실행).
 */
import { dbInsert, dbSelect, dbSelectAll } from "@/lib/db";
import { QUEUE_LABEL, type Queue } from "@/lib/engine/queues";
import { env } from "@/lib/env";
import type { StatRow } from "@/lib/outcomes/attribution";
import { reviewProposals } from "@/lib/outcomes/review";
import { sendMessage } from "@/lib/telegram/send";
import { calibrationText } from "@/lib/telegram/templates";
import { isFirstSaturdayOfQuarter, kstDate } from "@/lib/time";
import { rules } from "./context";

export async function calibrationReview(now = new Date(), opts: { force?: boolean; dryRun?: boolean } = {}): Promise<Record<string, unknown>> {
  if (!opts.force && !isFirstSaturdayOfQuarter(now)) return { skipped: "분기 첫 토요일 아님" };
  const R = rules();
  const F = R.feedback;
  const last = await dbSelect<{ as_of: string }>("perf_stats", "select=as_of&order=as_of.desc&limit=1");
  const asOf = last.ok ? last.data[0]?.as_of ?? null : null;
  const st = asOf ? await dbSelectAll<StatRow>("perf_stats", `select=scope,dimension,bucket,horizon_days,n,median_excess,mean_excess,hit_rate,median_ret,enough&as_of=eq.${asOf}`) : null;
  const stats = st?.ok ? st.data.map((s) => ({ ...s, median_excess: s.median_excess === null ? null : Number(s.median_excess), hit_rate: s.hit_rate === null ? null : Number(s.hit_rate) })) : [];
  const label = (q: string) => ({ green: "🟢 진입 신호", yellow: "🟡 관찰", blue: "🔵 실적 돌파" } as Record<string, string>)[q] ?? QUEUE_LABEL[q as Queue] ?? q;
  const proposals = reviewProposals(stats, { buy_max: R.axes.P.buy_max, min_signal_families: R.queues.buy.min_signal_families }, F, label);
  const queues = stats.filter((s) => s.dimension === "all" && s.horizon_days === F.primary_horizon)
    .map((s) => ({ label: label(s.scope), n: s.n, median_excess: F.basis === "absolute" ? (s.median_ret === null ? null : Number(s.median_ret)) : s.median_excess, hit_rate: s.hit_rate, ranking_active: s.scope === "buy" && s.n >= F.min_samples }));
  const k = new Date(now.getTime() + 9 * 3600_000);
  const period = `${k.getUTCFullYear()}년 ${Math.floor(k.getUTCMonth() / 3) + 1}분기`;
  const base = env().JARVIS_URL?.replace(/\/$/, "");
  const text = calibrationText(period, F.primary_horizon, queues, proposals, base ? `${base}/scorecard` : undefined);
  if (opts.dryRun) return { period, as_of: asOf, proposals, text };

  const chat = env().TELEGRAM_CHAT_ID;
  const sent = chat ? await sendMessage(chat, text) : { ok: false as const, reason: "TELEGRAM_CHAT_ID 미설정" };
  const w = await dbInsert("calibration_reviews", [{
    period, review_date: kstDate(now), stats_as_of: asOf, proposals, summary: { queues },
    status: proposals.length ? "open" : "no_change", telegram_sent_at: sent.ok ? new Date().toISOString() : null,
  }]);
  if (!w.ok) throw new Error(w.reason);
  return { period, as_of: asOf, proposals: proposals.length, sent: sent.ok };
}
