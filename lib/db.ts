/**
 * JARVIS DB (schema jarvis) 서버·배치 전용 헬퍼 — service 키. 브라우저 번들 금지.
 * PostgREST 에 jarvis 스키마를 노출해야 한다(Settings → API → Exposed schemas).
 * 예외를 올리지 않고 Result 를 반환한다. 1,000행 제한 → dbSelectAll 은 Range 페이징(불변 규칙 11).
 */
import { env } from "@/lib/env";
import { fail, ok, safeReason, type Result } from "@/lib/ingest/types";

export function dbConfigured(): boolean {
  const e = env();
  return !!(e.NEXT_PUBLIC_SUPABASE_URL && e.SUPABASE_SERVICE_KEY);
}

function base(): { url: string; key: string } | null {
  const e = env();
  return e.NEXT_PUBLIC_SUPABASE_URL && e.SUPABASE_SERVICE_KEY ? { url: e.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, ""), key: e.SUPABASE_SERVICE_KEY } : null;
}

function headers(key: string, extra: Record<string, string> = {}) {
  return { apikey: key, Authorization: `Bearer ${key}`, "Accept-Profile": "jarvis", "Content-Profile": "jarvis", "Content-Type": "application/json", ...extra };
}

type WriteOpts = { upsertOn?: string; ignoreDuplicates?: boolean; returning?: boolean };

export async function dbInsert<T = Record<string, unknown>>(table: string, rows: Record<string, unknown>[], opts: WriteOpts = {}): Promise<Result<T[]>> {
  const b = base();
  if (!b) return fail("JARVIS DB 미설정 (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_KEY)");
  if (rows.length === 0) return ok([]);
  try {
    const q = opts.upsertOn ? `?on_conflict=${encodeURIComponent(opts.upsertOn)}` : "";
    const prefer = [opts.returning ? "return=representation" : "return=minimal"];
    if (opts.upsertOn || opts.ignoreDuplicates) prefer.push(opts.ignoreDuplicates ? "resolution=ignore-duplicates" : "resolution=merge-duplicates");
    const res = await fetch(`${b.url}/rest/v1/${table}${q}`, { method: "POST", headers: headers(b.key, { Prefer: prefer.join(",") }), body: JSON.stringify(rows) });
    if (res.status >= 300) return fail(`${table}: HTTP ${res.status} ${safeReason(await res.text())}`, res.status);
    return ok(opts.returning ? ((await res.json()) as T[]) : [], res.status);
  } catch (e) {
    return fail(`${table}: ${safeReason(e)}`);
  }
}

/** 큰 upsert 는 batch 단위로 나눠 보낸다. */
export async function dbUpsertBatched(table: string, rows: Record<string, unknown>[], upsertOn: string, batch = 500): Promise<Result<number>> {
  for (let i = 0; i < rows.length; i += batch) {
    const r = await dbInsert(table, rows.slice(i, i + batch), { upsertOn });
    if (!r.ok) return fail(`${r.reason} (batch ${i / batch})`, r.status);
  }
  return ok(rows.length);
}

export async function dbUpdate(table: string, filter: string, patch: Record<string, unknown>): Promise<Result<number>> {
  const b = base();
  if (!b) return fail("JARVIS DB 미설정");
  try {
    const res = await fetch(`${b.url}/rest/v1/${table}?${filter}`, { method: "PATCH", headers: headers(b.key, { Prefer: "return=representation" }), body: JSON.stringify(patch) });
    if (res.status >= 300) return fail(`${table}: HTTP ${res.status} ${safeReason(await res.text())}`, res.status);
    return ok(((await res.json()) as unknown[]).length, res.status);   // 실제로 바뀐 행 수
  } catch (e) {
    return fail(`${table}: ${safeReason(e)}`);
  }
}

/** 조건에 맞는 행 삭제 — 파생 스냅샷(예: 같은 날 재평가에서 빠진 큐 항목) 정리용. 지운 행 수를 돌려준다. */
export async function dbDelete(table: string, filter: string): Promise<Result<number>> {
  const b = base();
  if (!b) return fail("JARVIS DB 미설정");
  try {
    const res = await fetch(`${b.url}/rest/v1/${table}?${filter}`, { method: "DELETE", headers: headers(b.key, { Prefer: "return=representation" }) });
    if (res.status >= 300) return fail(`${table}: HTTP ${res.status} ${safeReason(await res.text())}`, res.status);
    return ok(((await res.json()) as unknown[]).length, res.status);
  } catch (e) {
    return fail(`${table}: ${safeReason(e)}`);
  }
}

export async function dbSelect<T = Record<string, unknown>>(table: string, query: string): Promise<Result<T[]>> {
  const b = base();
  if (!b) return fail("JARVIS DB 미설정");
  try {
    const res = await fetch(`${b.url}/rest/v1/${table}?${query}`, { headers: headers(b.key) });
    if (res.status !== 200) return fail(`${table}: HTTP ${res.status} ${safeReason(await res.text())}`, res.status);
    return ok((await res.json()) as T[], 200);
  } catch (e) {
    return fail(`${table}: ${safeReason(e)}`);
  }
}

/** 1,000행 제한을 넘는 조회 — Range 페이징 */
export async function dbSelectAll<T = Record<string, unknown>>(table: string, query: string, pageSize = 1000): Promise<Result<T[]>> {
  const b = base();
  if (!b) return fail("JARVIS DB 미설정");
  const out: T[] = [];
  try {
    for (let from = 0; ; from += pageSize) {
      const res = await fetch(`${b.url}/rest/v1/${table}?${query}`, { headers: headers(b.key, { Range: `${from}-${from + pageSize - 1}`, "Range-Unit": "items" }) });
      if (res.status !== 200 && res.status !== 206) return fail(`${table}: HTTP ${res.status} ${safeReason(await res.text())}`, res.status);
      const rows = (await res.json()) as T[];
      out.push(...rows);
      if (rows.length < pageSize) return ok(out, 200);
    }
  } catch (e) {
    return fail(`${table}: ${safeReason(e)}`);
  }
}
