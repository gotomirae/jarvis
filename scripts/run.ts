/**
 * 배치 진입점 — `npm run job -- <job> [--k v ...]` (CLAUDE.md 명령)
 * P0 잡:
 *   source_smoke       5개 소스 anon SELECT·SnowBall RPC 실측 → smoke-out/source_smoke.json + 표 출력(값 비노출)
 *   outlook_smoke      M3 ② 무료 소스 4종 스모크 (Actions 에서 실행, LLM·유료 API 없음)
 *   telegram_webhook   webhook 등록/조회 (--action set|info|delete)
 * P1 잡 (공통 옵션 --slot <이름>: 같은 슬롯이 이미 성공했으면 건너뜀, 없으면 수동 실행):
 *   holdings_sync      SnowBall 보유 → holdings_cache (07:10·16:10)
 *   entities_sync      종목 마스터 (일 03:00)
 *   taxonomy_sync      산업 라벨 매핑·pending·노션 변경 감지 (일 03:00)
 *   link_smoke         링크 규칙 스모크 (매일 03:30)
 *   auth_setup         ALLOWED_EMAIL → jarvis.allowed_users
 *   set_password       대시보드 로그인 비밀번호 설정 — 사용자가 PowerShell 에서 직접 실행(대화형)
 */
import "./env";
import { sourceSmokeJob } from "./source_smoke";
import { outlookSmokeJob } from "./outlook_smoke";
import { telegramWebhookJob } from "./telegram_webhook";
import { holdingsSyncJob } from "./holdings_sync";
import { entitiesSyncJob } from "./entities_sync";
import { taxonomySyncJob } from "./taxonomy_sync";
import { linkSmokeJob } from "./link_smoke";
import { authSetupJob } from "./auth_setup";
import { setPasswordJob } from "./set_password";

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
  holdings_sync: holdingsSyncJob,
  entities_sync: entitiesSyncJob,
  taxonomy_sync: taxonomySyncJob,
  link_smoke: linkSmokeJob,
  auth_setup: () => authSetupJob(),
  set_password: () => setPasswordJob(),
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
