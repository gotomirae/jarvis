/**
 * P2 잡 진입점 — 로직은 lib/jobs/* (Vercel 라우트와 공유). 모두 --slot 멱등.
 *   pipeline --slot <이름>     ingest_all → catalysts → axes·queues·SnowBall 제출 (07:12·19:10)
 *   ingest_all · catalysts · inbox   단독 실행 (inbox = FlyWheel Idea_Generating 투입, --dry true)
 *   industry_growth_realized   M3 종합 → industry_heat (07:00·19:00)
 *   industry_outlook_collect   M3 ② 무료 검색 수집 (일·수 04:00) [--l1 1b --max 100]
 *   poll                       보유 경고 (30분, 보통은 Vercel 라우트) [--dry true]
 *   brief --kind morning|evening [--force true]
 *   outcomes_update            신호 원장 동기화(소급 포함) → 진입가·D+5·20·40·60 성과 → 특징별 성과 perf_stats (20:00, D47·D49)
 *   calibration_review         분기 신호 성적표 + 보정 제안(자동 적용 없음) — 분기 첫 토 10:30 [--force true] [--dry true]
 */
import { runJob, slotOf } from "@/lib/jobs";
import { briefDate, briefSlotOk } from "@/lib/time";
import { sendBrief } from "@/lib/jobs/brief";
import { collectCatalysts } from "@/lib/jobs/catalysts";
import { industryGrowth } from "@/lib/jobs/industry-growth";
import { ingestAll } from "@/lib/jobs/ingest";
import { runInbox } from "@/lib/jobs/inbox";
import { collectOutlooks, expireOutlooks } from "@/lib/jobs/outlook";
import { calibrationReview } from "@/lib/jobs/calibration";
import { updateOutcomes } from "@/lib/jobs/outcomes";
import { runPipeline } from "@/lib/jobs/pipeline";
import { poll } from "@/lib/jobs/poll";
import { systemAlerts } from "@/lib/jobs/system";

const print = (x: unknown) => console.log(JSON.stringify(x, null, 1));

export const P2_JOBS: Record<string, (args: Record<string, string>) => Promise<void>> = {
  ingest_all: async (a) => print(await runJob("ingest_all", slotOf(a), () => ingestAll())),
  catalysts: async (a) => print(await runJob("catalysts", slotOf(a), () => collectCatalysts())),
  pipeline: async (a) => {
    const slot = slotOf(a);
    print(await runJob("ingest_all", slot, () => ingestAll()));
    print(await runJob("catalysts", slot, () => collectCatalysts()));
    print(await runJob("pipeline", slot, async () => runPipeline(new Date(), { submit: a.submit !== "false" }) as unknown as Record<string, unknown>));
    print(await runJob("inbox", slot, () => runInbox()));
    print({ system_alerts: await systemAlerts() });
  },
  inbox: async (a) => print(await runJob("inbox", slotOf(a), () => runInbox(new Date(), { dryRun: a.dry === "true" }))),
  industry_growth_realized: async (a) => print(await runJob("industry_growth_realized", slotOf(a), async () => {
    const r = await industryGrowth();
    return { date: r.date, pass: r.l1.filter((x) => x.pass).map((x) => x.l1) };
  })),
  industry_outlook_collect: async (a) => print(await runJob("industry_outlook_collect", slotOf(a), async () => {
    const expired = await expireOutlooks();
    const r = await collectOutlooks(new Date(), { l1: a.l1, maxArticles: a.max ? Number(a.max) : undefined });
    return { ...r, expired, system_alerts: await systemAlerts() };
  })),
  poll: async (a) => print(await runJob("poll", slotOf(a), () => poll(new Date(), { dryRun: a.dry === "true" }))),
  outcomes_update: async (a) => print(await runJob("outcomes_update", slotOf(a), async () => updateOutcomes() as unknown as Record<string, unknown>)),
  calibration_review: async (a) => print(await runJob("calibration_review", slotOf(a), () => calibrationReview(new Date(), { force: a.force === "true", dryRun: a.dry === "true" }))),
  brief: async (a) => {
    const kind = a.kind === "evening" ? "evening" : "morning";
    const now = new Date();
    // 몇 시간 늦게 시작된 예비 실행이 다음 날 슬롯을 차지하지 않게 — 슬롯 날짜 ≠ 브리핑 날짜면 기록 없이 건너뜀 (D48)
    if (a.slot && a.slot !== "true" && !briefSlotOk(kind, a.slot, now)) return print({ skipped: `슬롯 ${a.slot} ≠ 브리핑 날짜 ${briefDate(kind, now)} — 지연된 예비 실행으로 보고 건너뜀` });
    print(await runJob(`brief_${kind}`, slotOf(a), () => sendBrief(kind, now, { force: a.force === "true" })));
  },
};
