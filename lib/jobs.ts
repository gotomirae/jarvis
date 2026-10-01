/**
 * 배치 잡 실행기 — 멱등(불변 규칙 13): 같은 (job, slot) 이 이미 성공했으면 즉시 종료한다.
 * job_runs 에 시작·종료를 남기고, source_health 로 소스별 연속 실패를 센다(2회 → 🔧, PRD §9.2).
 * DB 미설정(로컬 첫 실행 등)이면 기록 없이 그냥 실행한다.
 */
import { dbConfigured, dbInsert, dbSelect, dbUpdate } from "@/lib/db";
import { slotTimeOk } from "@/lib/time";

export type JobDetail = Record<string, unknown>;

export function slotOf(args: Record<string, string>): string {
  if (!args.slot || args.slot === "true") return `manual-${new Date().toISOString()}`;
  // 엉뚱한 시각의 수동 실행이 정시 슬롯(…-am/-pm)을 차지하면 정시 잡이 건너뛰어진다(D48) → 거부. 수동 실행은 --slot 없이.
  if (!slotTimeOk(args.slot)) throw new Error(`슬롯 ${args.slot} 은 지금 시각(KST)과 맞지 않습니다 — 수동 실행은 --slot 없이 하세요`);
  return args.slot;
}

export async function runJob(job: string, slot: string, fn: () => Promise<JobDetail>): Promise<JobDetail | null> {
  if (!dbConfigured()) return fn();
  const done = await dbSelect("job_runs", `select=id&job=eq.${encodeURIComponent(job)}&slot=eq.${encodeURIComponent(slot)}&ok=is.true&limit=1`);
  if (done.ok && done.data.length) {
    console.log(`[${job}] slot ${slot} 이미 성공 → 건너뜀`);
    return null;
  }
  const start = await dbInsert<{ id: number }>("job_runs", [{ job, slot }], { returning: true });
  const id = start.ok ? start.data[0]?.id : undefined;
  try {
    const detail = await fn();
    if (id !== undefined) await dbUpdate("job_runs", `id=eq.${id}`, { finished_at: new Date().toISOString(), ok: true, detail });
    return detail;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (id !== undefined) await dbUpdate("job_runs", `id=eq.${id}`, { finished_at: new Date().toISOString(), ok: false, detail: { error: msg.slice(0, 500) } });
    throw e;
  }
}

/** 소스 수집 결과 기록 → 연속 실패 수 반환 */
export async function recordSource(source: string, success: boolean, error?: string): Promise<number> {
  if (!dbConfigured()) return success ? 0 : 1;
  const cur = await dbSelect<{ consecutive_failures: number }>("source_health", `select=consecutive_failures&source=eq.${encodeURIComponent(source)}`);
  const prev = cur.ok && cur.data[0] ? cur.data[0].consecutive_failures : 0;
  const failures = success ? 0 : prev + 1;
  const now = new Date().toISOString();
  await dbInsert("source_health", [{
    source, consecutive_failures: failures, updated_at: now,
    ...(success ? { last_ok_at: now, last_error: null } : { last_error: (error ?? "").slice(0, 300) }),
  }], { upsertOn: "source" });
  return failures;
}
