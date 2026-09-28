import { afterEach, describe, expect, it } from "vitest";
import { env, need, parseEnv, presence, resetEnvCache } from "./env";

describe("env", () => {
  afterEach(() => resetEnvCache());

  it("trims values and drops blanks", () => {
    const e = parseEnv({ TELEGRAM_CHAT_ID: "  123 \n", NOTION_API_KEY: "   ", HERMES_SUPABASE_URL: " https://x.supabase.co " });
    expect(e.TELEGRAM_CHAT_ID).toBe("123");
    expect(e.NOTION_API_KEY).toBeUndefined();
    expect(e.HERMES_SUPABASE_URL).toBe("https://x.supabase.co");
    expect(e.MEMO_MODEL).toBe("claude-sonnet-5");
    expect(e.MONTHLY_LLM_CAP_USD).toBe(5);
  });

  it("rejects secrets with NEXT_PUBLIC_ prefix", () => {
    expect(() => parseEnv({ NEXT_PUBLIC_SUPABASE_SERVICE_KEY: "x" })).toThrow(/금지된 공개 환경변수/);
    expect(() => parseEnv({ NEXT_PUBLIC_TELEGRAM_TOKEN: "x" })).toThrow(/NEXT_PUBLIC_TELEGRAM_TOKEN/);
  });

  it("reports invalid values by name only", () => {
    expect(() => parseEnv({ JARVIS_URL: "not a url" })).toThrow(/JARVIS_URL/);
  });

  it("need() throws with the variable name and presence() hides values", () => {
    process.env.TELEGRAM_CHAT_ID = "42";
    delete process.env.SAGE_READ_KEY;
    resetEnvCache();
    expect(need("TELEGRAM_CHAT_ID")).toBe("42");
    expect(() => need("SAGE_READ_KEY")).toThrow("환경변수 누락: SAGE_READ_KEY");
    expect(presence(["TELEGRAM_CHAT_ID", "SAGE_READ_KEY"])).toEqual({ TELEGRAM_CHAT_ID: true, SAGE_READ_KEY: false });
    expect(Object.keys(presence()).length).toBeGreaterThan(20);
    expect(env()).toBe(env());
    delete process.env.TELEGRAM_CHAT_ID;
  });
});
