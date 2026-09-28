import { describe, expect, it } from "vitest";
import { parseLinkedRow } from "./flywheel";
import { probeTable, rpc, selectAll } from "./rest";
import { safeReason } from "./types";

type Call = { url: string; init?: RequestInit };

function fakeFetch(responses: { status: number; body: unknown }[], calls: Call[] = []): typeof fetch {
  let i = 0;
  return (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = responses[Math.min(i++, responses.length - 1)];
    const text = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    return new Response(text, { status: r.status });
  }) as unknown as typeof fetch;
}

const T = { url: "https://p.supabase.co/", key: "anon" };

describe("rest.selectAll", () => {
  it("pages with Range headers until a short page", async () => {
    const calls: Call[] = [];
    const f = fakeFetch([{ status: 206, body: [{ a: 1 }, { a: 2 }] }, { status: 200, body: [{ a: 3 }] }], calls);
    const r = await selectAll(T, "screen_results", { select: "a", filters: { code: "eq.000660" }, order: "a.asc", pageSize: 2 }, f);
    expect(r).toEqual({ ok: true, data: [{ a: 1 }, { a: 2 }, { a: 3 }], status: 200 });
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe("https://p.supabase.co/rest/v1/screen_results?select=a&code=eq.000660&order=a.asc");
    expect((calls[1].init?.headers as Record<string, string>).Range).toBe("2-3");
  });

  it("respects limit and returns {ok:false} on HTTP errors and exceptions", async () => {
    const r = await selectAll(T, "t", { limit: 1 }, fakeFetch([{ status: 200, body: [{ a: 1 }] }]));
    expect(r.ok && r.data).toEqual([{ a: 1 }]);
    const bad = await selectAll(T, "t", {}, fakeFetch([{ status: 401, body: "denied" }]));
    expect(bad).toMatchObject({ ok: false, status: 401 });
    const boom = await selectAll(T, "t", {}, (async () => { throw new Error("net down"); }) as unknown as typeof fetch);
    expect(boom).toMatchObject({ ok: false, reason: "t: net down" });
  });
});

describe("rest.rpc", () => {
  it("always POSTs with token in body, never in URL", async () => {
    const calls: Call[] = [];
    const r = await rpc(T, "jarvis_export_positions", { p_token: "secret" }, fakeFetch([{ status: 200, body: [1, 2] }], calls));
    expect(r).toEqual({ ok: true, data: [1, 2], status: 200 });
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].url).not.toContain("secret");
    expect(String(calls[0].init?.body)).toContain("secret");
    expect(await rpc(T, "f", {}, fakeFetch([{ status: 200, body: "" }]))).toEqual({ ok: true, data: null, status: 200 });
    expect(await rpc(T, "f", {}, fakeFetch([{ status: 400, body: "jarvis: invalid token" }]))).toMatchObject({ ok: false, status: 400 });
    expect(await rpc(T, "f", {}, (async () => { throw new Error("x"); }) as unknown as typeof fetch)).toMatchObject({ ok: false });
  });
});

describe("rest.probeTable", () => {
  it("reports readable, empty, missing and network failure", async () => {
    expect(await probeTable("s", T, "t", fakeFetch([{ status: 200, body: [{ a: 1, b: 2 }] }]))).toMatchObject({ readable: true, rows: 1, columns: ["a", "b"] });
    expect(await probeTable("s", T, "t", fakeFetch([{ status: 200, body: [] }]))).toMatchObject({ readable: true, rows: 0, note: expect.stringContaining("RLS") });
    expect(await probeTable("s", T, "t", fakeFetch([{ status: 404, body: { code: "PGRST205", message: "missing" } }]))).toMatchObject({ readable: false, status: 404, note: "PGRST205 missing" });
    expect(await probeTable("s", T, "t", fakeFetch([{ status: 500, body: "oops" }]))).toMatchObject({ readable: false, note: "oops" });
    expect(await probeTable("s", T, "t", (async () => { throw new Error("dns"); }) as unknown as typeof fetch)).toMatchObject({ status: null, note: "dns" });
  });
});

describe("safeReason", () => {
  it("redacts token-like strings", () => {
    const fake = `${"a".repeat(36)}.${"b".repeat(20)}.${"c".repeat(40)}`;
    expect(safeReason(new Error(`bad key ${fake}`))).toBe("bad key <redacted>");
    expect(safeReason("plain")).toBe("plain");
  });
});

describe("flywheel.parseLinkedRow (P0 실측 형식)", () => {
  const page = (date: string, strength: string | null) => ({
    id: "a1b2-c3", created_time: "2026-09-26T07:13:00.000Z",
    properties: { 날짜: { type: "rich_text", rich_text: [{ plain_text: date }] }, 신호강도: { type: "select", select: strength ? { name: strength } : null } },
  });

  it("reads 연계종합 rows with 신호강도 1~5", () => {
    expect(parseLinkedRow("AI", page("2026-09-26\n연계종합", "5"))).toEqual({
      l2: "AI", page_id: "a1b2-c3", date: "2026-09-26", strength: 5, created_time: "2026-09-26T07:13:00.000Z", url: "https://www.notion.so/a1b2c3" });
  });

  it("ignores 당일종합, tolerates missing/invalid strength and date", () => {
    expect(parseLinkedRow("AI", page("2026-09-26\n당일종합", null))).toBeNull();
    expect(parseLinkedRow("AI", page("2026-09-26\n연계종합", null))?.strength).toBeNull();
    expect(parseLinkedRow("AI", page("2026-09-26\n연계종합", "7"))?.strength).toBeNull();
    expect(parseLinkedRow("AI", page("어제\n연계종합", "3"))?.date).toBe("2026-09-26");
    expect(parseLinkedRow("AI", { id: "x", created_time: "2026-09-26T00:00:00Z", properties: {} })).toBeNull();
  });
});
