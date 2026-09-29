/**
 * P2 잡 진입점 — 로직은 lib/jobs/* (Vercel 라우트와 공유). 모두 --slot 멱등.
 *   pipeline --slot <이름>     ingest_all → catalysts → axes·queues·SnowBall 제출 (07:12·19:10)
 *   ingest_all · catalysts · inbox   단독 실행 (inbox = FlyWheel Idea_Generating 투입, --dry true)
 *   industry_growth_realized   M3 종합 → industry_heat (07:00·19:00)
 *   industry_outlook_collect   M3 ② 무료 검색 수집 (일·수 04:00) [--l1 1b --max 100]
 *   poll                       보유 경고 (30분, 보통은 Vercel 라우트) [--dry true]
 *   brief --kind morning|evening [--force true]
 */
import { runJob, slotOf } from "@/lib/jobs";
import { sendBrief } from "@/lib/jobs/brief";
import { collectCatalysts } from "@/lib/jobs/catalysts";
import { industryGrowth } from "@/lib/jobs/industry-growth";
import { ingestAll } from "@/lib/jobs/ingest";
import { runInbox } from "@/lib/jobs/inbox";
import { collectOutlooks, expireOutlooks } from "@/lib/jobs/outlook";
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
  brief: async (a) => {
    const kind = a.kind === "evening" ? "evening" : "morning";
    print(await runJob(`brief_${kind}`, slotOf(a), () => sendBrief(kind, new Date(), { force: a.force === "true" })));
  },
};
