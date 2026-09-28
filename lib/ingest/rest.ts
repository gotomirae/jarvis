/**
 * PostgREST 최소 클라이언트 (연계 프로젝트 anon 읽기 전용).
 * - 1,000행 제한 → Range 헤더 페이징(불변 규칙 11).
 * - 예외를 올리지 않는다. 키 값은 로그·오류에 남기지 않는다.
 */
import { fail, ok, safeReason, type ProbeRow, type Result } from "./types";

export type RestTarget = { url: string; key: string };

export type SelectOpts = {
  select?: string;
  filters?: Record<string, string>;   // { check_date: "gte.2026-09-01" }
  order?: string;                     // "check_date.desc"
  limit?: number;                     // 전체 상한 (기본 무제한 → 페이징)
  pageSize?: number;                  // 기본 1000
};

type FetchLike = typeof fetch;

function headers(t: RestTarget, extra: Record<string, string> = {}): Record<string, string> {
  return { apikey: t.key, Authorization: `Bearer ${t.key}`, Accept: "application/json", ...extra };
}

function buildUrl(t: RestTarget, table: string, o: SelectOpts): string {
  const u = new URL(`${t.url.replace(/\/$/, "")}/rest/v1/${table}`);
  u.searchParams.set("select", o.select ?? "*");
  for (const [k, v] of Object.entries(o.filters ?? {})) u.searchParams.set(k, v);
  if (o.order) u.searchParams.set("order", o.order);
  return u.toString();
}

export async function selectAll<T = Record<string, unknown>>(
  t: RestTarget,
  table: string,
  o: SelectOpts = {},
  f: FetchLike = fetch,
): Promise<Result<T[]>> {
  const pageSize = o.pageSize ?? 1000;
  const cap = o.limit ?? Number.POSITIVE_INFINITY;
  const out: T[] = [];
  const url = buildUrl(t, table, o);
  try {
    for (let from = 0; out.length < cap; from += pageSize) {
      const to = Math.min(from + pageSize, cap) - 1;
      const res = await f(url, { headers: headers(t, { Range: `${from}-${to}`, "Range-Unit": "items" }) });
      if (res.status !== 200 && res.status !== 206) {
        const body = await res.text().catch(() => "");
        return fail(`${table}: HTTP ${res.status} ${safeReason(body)}`, res.status);
      }
      const rows = (await res.json()) as T[];
      out.push(...rows);
      if (rows.length < to - from + 1) break;
    }
    return ok(out, 200);
  } catch (e) {
    return fail(`${table}: ${safeReason(e)}`);
  }
}

/** RPC 는 반드시 POST (GET 이면 토큰이 URL·로그에 남는다 — SnowBall 인계). */
export async function rpc<T = unknown>(
  t: RestTarget,
  fn: string,
  body: Record<string, unknown>,
  f: FetchLike = fetch,
): Promise<Result<T>> {
  try {
    const res = await f(`${t.url.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: headers(t, { "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (res.status !== 200) return fail(`${fn}: HTTP ${res.status} ${safeReason(text)}`, res.status);
    return ok((text ? JSON.parse(text) : null) as T, 200);
  } catch (e) {
    return fail(`${fn}: ${safeReason(e)}`);
  }
}

/** anon SELECT 가능 여부 실측: limit=1 로 상태·행 수·컬럼명만 기록(값 미보관). */
export async function probeTable(source: string, t: RestTarget, table: string, f: FetchLike = fetch): Promise<ProbeRow> {
  try {
    const res = await f(buildUrl(t, table, {}) + "&limit=1", { headers: headers(t) });
    const text = await res.text();
    if (res.status !== 200) {
      let note = "";
      try { const j = JSON.parse(text); note = [j.code, j.message].filter(Boolean).join(" "); } catch { note = text.slice(0, 120); }
      return { source, table, status: res.status, readable: false, rows: 0, columns: [], note: safeReason(note) };
    }
    const rows = JSON.parse(text) as Record<string, unknown>[];
    return { source, table, status: 200, readable: true, rows: rows.length, columns: rows[0] ? Object.keys(rows[0]) : [],
      note: rows.length === 0 ? "0행 (RLS 차단 또는 빈 테이블)" : undefined };
  } catch (e) {
    return { source, table, status: null, readable: false, rows: 0, columns: [], note: safeReason(e) };
  }
}
