import { describe, expect, it } from "vitest";
import { parseLinkedRow } from "./flywheel";
import { naverDaily, naverInvestorTrend, parseNaverDaily, parseNaverTrend } from "./market";
import { notionId } from "./notion";
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

describe("market.naverDaily (국내 공식 종가)", () => {
  const xml = `<chartdata><item data="20261001|266500|276000|264500|274500|13686117" />
<item data="20260930|274500|276000|267500|269500|16477580" /><item data="20260929|1|1|1|0|1" /></chartdata>`;
  it("XML → 날짜 오름차순 종가, 0 종가 제외", () => {
    expect(parseNaverDaily(xml)).toEqual([{ date: "2026-09-30", close: 269500 }, { date: "2026-10-01", close: 274500 }]);
    expect(parseNaverDaily("<x/>")).toEqual([]);
  });
  it("HTTP 오류·빈 응답·예외는 Result 실패", async () => {
    const f = (status: number, body: string) => (async () => new Response(body, { status })) as unknown as typeof fetch;
    expect((await naverDaily("005930", 2, f(200, xml))).ok).toBe(true);
    expect(await naverDaily("005930", 2, f(500, ""))).toMatchObject({ ok: false, status: 500 });
    expect(await naverDaily("005930", 2, f(200, "<x/>"))).toMatchObject({ ok: false });
    expect(await naverDaily("005930", 2, (async () => { throw new Error("boom"); }) as unknown as typeof fetch)).toMatchObject({ ok: false });
  });
});

describe("market.naverInvestorTrend (지수 투자자 동향, 억원)", () => {
  it("파싱", () => {
    expect(parseNaverTrend({ bizdate: "20261002", personalValue: "-17,897", foreignValue: "-1,080", institutionalValue: "+4,155" })).toEqual({ date: "2026-10-02", personal: -17897, foreign: -1080, institutional: 4155 });
    expect(parseNaverTrend({ bizdate: "x" })).toBeNull();
    expect(parseNaverTrend(null)).toBeNull();
    expect(parseNaverTrend({ bizdate: "20261002", personalValue: "-1" })).toBeNull();
  });
  it("Result", async () => {
    const f = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    expect((await naverInvestorTrend("KOSPI", "2026-10-02", f(200, { bizdate: "20261002", personalValue: "1", foreignValue: "2", institutionalValue: "3" }))).ok).toBe(true);
    expect(await naverInvestorTrend("KOSPI", "2026-10-02", f(404, {}))).toMatchObject({ ok: false, status: 404 });
    expect(await naverInvestorTrend("KOSDAQ", "2026-10-02", f(200, {}))).toMatchObject({ ok: false });
    expect(await naverInvestorTrend("KOSDAQ", "2026-10-02", (async () => { throw new Error("x"); }) as unknown as typeof fetch)).toMatchObject({ ok: false });
  });
});

describe("notion.notionId", () => {
  it("주소·하이픈 ID·없음", () => {
    expect(notionId("https://www.notion.so/5-JARVIS-3a99c770aa6180e98874f0a264ef61b1?pvs=4")).toBe("3a99c770aa6180e98874f0a264ef61b1");
    expect(notionId("3a99c770-aa61-80e9-8874-f0a264ef61b1")).toBe("3a99c770aa6180e98874f0a264ef61b1");
    expect(notionId("nothing")).toBeNull();
    expect(notionId(undefined)).toBeNull();
  });
});
