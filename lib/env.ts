/**
 * 환경변수 단일 진입점 (CLAUDE.md 불변 규칙 9, PRD 부록 C).
 * - process.env 는 이 파일에서만 읽는다. 모든 값은 .trim() 한다(복사·붙여넣기 공백·개행 방지).
 * - 비밀 값에 NEXT_PUBLIC_ 접두사 금지 → 발견 시 즉시 throw.
 * - P0 단계에서는 대부분 선택값이다. 필요한 곳에서 need() 로 요구한다(누락 시 이름만 담아 throw, 값은 절대 출력하지 않음).
 */
import { z } from "zod";

const opt = z.string().optional();
const optUrl = z.string().url().optional();

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: optUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: opt,
  SUPABASE_SERVICE_KEY: opt,
  JARVIS_URL: optUrl,
  ALLOWED_EMAIL: z.string().email().optional(),
  JARVIS_PUBLIC_TOKEN: opt,
  TELEGRAM_BOT_TOKEN: opt,
  TELEGRAM_CHAT_ID: opt,
  TELEGRAM_WEBHOOK_SECRET: opt,
  CRON_SECRET: opt,                     // pg_cron → /api/cron/* 호출 비밀값 (Vault jarvis_cron_secret 과 같은 값)
  GITHUB_DISPATCH_TOKEN: opt,
  GITHUB_READ_TOKEN: opt,
  GITHUB_REPO: z.string().default("gotomirae/jarvis"),
  ANTHROPIC_API_KEY: opt,
  MEMO_MODEL: z.string().default("claude-sonnet-5"),
  MONTHLY_LLM_CAP_USD: z.coerce.number().default(5),
  NOTION_API_KEY: opt,
  NOTION_IDEA_DB_ID: opt,
  NOTION_WEEKLY_PARENT_PAGE_ID: opt,
  HEIMDALLR_SUPABASE_URL: optUrl,
  HEIMDALLR_ANON_KEY: opt,
  HERMES_SUPABASE_URL: optUrl,
  HERMES_ANON_KEY: opt,
  SAGE_SUPABASE_URL: optUrl,
  SAGE_READ_KEY: opt,
  SNOWBALL_SUPABASE_URL: optUrl,
  SNOWBALL_ANON_KEY: opt,
  SNOWBALL_JARVIS_TOKEN: opt,
});

export type Env = z.infer<typeof schema>;
export type EnvKey = keyof Env;

const KEYS = Object.keys(schema.shape) as EnvKey[];

/** 순수 함수: 원시 env 레코드 → 검증된 Env. 테스트 가능하도록 process.env 와 분리. */
export function parseEnv(raw: Record<string, string | undefined>): Env {
  for (const k of Object.keys(raw)) {
    if (k.startsWith("NEXT_PUBLIC_") && /SERVICE|SECRET|PRIVATE|TOKEN/i.test(k)) {
      throw new Error(`금지된 공개 환경변수: ${k} (비밀에 NEXT_PUBLIC_ 접두사 금지)`);
    }
  }
  const trimmed: Record<string, string> = {};
  for (const k of KEYS) {
    const v = raw[k];
    if (typeof v === "string" && v.trim() !== "") trimmed[k] = v.trim();
  }
  const parsed = schema.safeParse(trimmed);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`환경변수 검증 실패:\n${issues}`);
  }
  return parsed.data;
}

let cached: Env | null = null;

/** 서버·배치 전용. 최초 호출 시 검증한다. */
export function env(): Env {
  if (!cached) cached = parseEnv(process.env);
  return cached;
}

/** 테스트용 캐시 초기화 */
export function resetEnvCache(): void {
  cached = null;
}

/** 필수 값 요구. 없으면 변수 이름만 담아 throw (값은 출력하지 않는다). */
export function need<K extends EnvKey>(key: K): NonNullable<Env[K]> {
  const v = env()[key];
  if (v === undefined || v === null || v === "") throw new Error(`환경변수 누락: ${key}`);
  return v as NonNullable<Env[K]>;
}

/** 설정 여부만 반환(값 비노출) — /status·/health 표시용 */
export function presence(keys: readonly EnvKey[] = KEYS): Record<string, boolean> {
  const e = env();
  return Object.fromEntries(keys.map((k) => [k, e[k] !== undefined && e[k] !== ""]));
}

export const ENV_KEYS = KEYS;
