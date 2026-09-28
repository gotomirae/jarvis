import { describe, expect, it } from "vitest";
import { kstDate, kstString } from "./time";

describe("time", () => {
  it("formats KST", () => {
    const d = new Date("2026-09-27T16:30:00Z");
    expect(kstString(d)).toBe("2026-09-28 01:30");
    expect(kstDate(d)).toBe("2026-09-28");
    expect(kstString()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(kstDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
