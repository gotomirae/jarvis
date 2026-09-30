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
    // 선호 경계: "#" 로 시작하는 줄(카드) 앞에서 자른다
    expect(splitMessage(["h", "", "# a", "a1", "", "# b", "b1"].join("\n"), 16, /^#/)).toEqual(["h\n\n# a\na1", "# b\nb1"]);
    expect(splitMessage(["# a", "a1", "a2", "a3"].join("\n"), 8, /^#/)).toEqual(["# a\na1", "a2\na3"]);
  });

  it("compares secrets", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual(null, "a")).toBe(false);
    expect(safeEqual("a", undefined)).toBe(false);
  });
});
