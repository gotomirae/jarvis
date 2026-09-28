/**
 * JARVIS DB (schema jarvis) 서버·배치 전용 쓰기 헬퍼 — service 키. 브라우저 번들 금지.
 * PostgREST 에 jarvis 스키마를 노출해야 한다(Settings → API → Exposed schemas).
 * 예외를 올리지 않고 Result 를 반환한다.
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

export async function dbInsert(table: string, rows: Record<string, unknown>[], opts: { upsertOn?: string } = {}): Promise<Result<number>> {
  const b = base();
  if (!b) return fail("JARVIS DB 미설정 (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_KEY)");
  if (rows.length === 0) return ok(0);
  try {
    const q = opts.upsertOn ? `?on_conflict=${encodeURIComponent(opts.upsertOn)}` : "";
    const res = await fetch(`${b.url}/rest/v1/${table}${q}`, {
      method: "POST",
      headers: headers(b.key, { Prefer: `return=minimal${opts.upsertOn ? ",resolution=merge-duplicates" : ""}` }),
      body: JSON.stringify(rows),
    });
    if (res.status >= 300) return fail(`${table}: HTTP ${res.status} ${safeReason(await res.text())}`, res.status);
    return ok(rows.length, res.status);
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
