/**
 * /status · /health 용 상태 수집 (서버 전용). 값은 노출하지 않고 설정 여부·최근 실행만.
 */
import { dbConfigured, dbSelect } from "@/lib/db";
import { presence, type EnvKey } from "@/lib/env";
import type { StatusCtx } from "@/lib/telegram/commands";
import { kstString } from "@/lib/time";

const STATUS_KEYS: EnvKey[] = [
  "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_KEY", "JARVIS_URL", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",
  "TELEGRAM_WEBHOOK_SECRET", "SNOWBALL_JARVIS_TOKEN", "HEIMDALLR_ANON_KEY", "HERMES_ANON_KEY", "SAGE_READ_KEY", "NOTION_API_KEY",
];

export async function collectStatus(): Promise<StatusCtx> {
  const base: StatusCtx = { nowKst: kstString(), env: presence(STATUS_KEYS), db: { ok: false, note: "미설정" }, jobs: [], sources: [] };
  if (!dbConfigured()) return base;
  const jobs = await dbSelect<{ job: string; started_at: string; ok: boolean | null }>("job_runs", "select=job,started_at,ok&order=started_at.desc&limit=5");
  const src = await dbSelect<{ source: string; last_ok_at: string | null; consecutive_failures: number }>("source_health", "select=source,last_ok_at,consecutive_failures&order=source");
  const pause = await dbSelect<{ value: { paused?: boolean } }>("bot_state", "select=value&key=eq.holding_alert_pause");
  return {
    ...base,
    alertsPaused: pause.ok ? pause.data[0]?.value?.paused === true : undefined,
    db: jobs.ok ? { ok: true } : { ok: false, note: jobs.reason.slice(0, 80) },
    jobs: jobs.ok ? jobs.data.map((j) => ({ job: j.job, at: kstString(new Date(j.started_at)), ok: j.ok })) : [],
    sources: src.ok ? src.data.map((s) => ({ ...s, last_ok_at: s.last_ok_at ? kstString(new Date(s.last_ok_at)) : null })) : [],
  };
}
