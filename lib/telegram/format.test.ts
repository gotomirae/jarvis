import { describe, expect, it } from "vitest";
import { esc, NOT_A_BUY_SIGNAL, safeEqual, splitMessage } from "./format";

describe("telegram format", () => {
  it("escapes HTML", () => {
    expect(esc("<b>A&B</b>")).toBe("&lt;b&gt;A&amp;B&lt;/b&gt;");
    expect(esc(null)).toBe("");
    expect(NOT_A_BUY_SIGNAL).toContain("매수 확정 신호가 아닙니다");
  });

  it("splits long messages at line boundaries", () => {
    expect(splitMessage("short")).toEqual(["short"]);
    expect(splitMessage(["aaaa", "bbbb", "cccc"].join("\n"), 9)).toEqual(["aaaa\nbbbb", "cccc"]);
    expect(splitMessage("x".repeat(10) + "\ny", 4)).toEqual(["xxxx", "xxxx", "xx\ny"]);
    expect(splitMessage("ab\n" + "c".repeat(5), 4)).toEqual(["ab", "cccc", "c"]);
  });

  it("compares secrets", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual(null, "a")).toBe(false);
    expect(safeEqual("a", undefined)).toBe(false);
  });
});
