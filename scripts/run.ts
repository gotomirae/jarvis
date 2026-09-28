/**
 * 배치 진입점 — `npm run job -- <job> [--k v ...]` (CLAUDE.md 명령)
 * P0 잡:
 *   source_smoke       5개 소스 anon SELECT·SnowBall RPC 실측 → smoke-out/source_smoke.json + 표 출력(값 비노출)
 *   outlook_smoke      M3 ② 무료 소스 4종 스모크 (Actions 에서 실행, LLM·유료 API 없음)
 *   telegram_webhook   webhook 등록/조회 (--action set|info|delete)
 * 이후 Phase 에서 ingest_all · holdings_sync · … 를 추가한다.
 */
import "./env";
import { sourceSmokeJob } from "./source_smoke";
import { outlookSmokeJob } from "./outlook_smoke";
import { telegramWebhookJob } from "./telegram_webhook";

export function parseArgs(argv: string[]): { job: string; args: Record<string, string> } {
  const [job, ...rest] = argv;
  const args: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith("--")) {
      const k = rest[i].slice(2);
      const v = rest[i + 1] && !rest[i + 1].startsWith("--") ? rest[++i] : "true";
      args[k] = v;
    }
  }
  return { job, args };
}

const JOBS: Record<string, (args: Record<string, string>) => Promise<void>> = {
  source_smoke: sourceSmokeJob,
  outlook_smoke: outlookSmokeJob,
  telegram_webhook: telegramWebhookJob,
};

async function main() {
  const { job, args } = parseArgs(process.argv.slice(2));
  const fn = JOBS[job];
  if (!fn) {
    console.error(`알 수 없는 잡: ${job ?? "(없음)"}\n사용 가능: ${Object.keys(JOBS).join(", ")}`);
    process.exit(2);
  }
  await fn(args);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
