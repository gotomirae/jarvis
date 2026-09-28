import { describe, expect, it } from "vitest";
import { diffIsEmpty, diffNotionL1, notionId, parseCategoryTitle } from "./notion";

const A = "36a9c770aa6180908b74cf2f84e066f8";
const B = "36a9c770aa6180369ec3e56654952895";
const G = "3e89c770aa618002896bdc15b843fda7";

describe("노션 2_1 카테고리 변경 감지 (ID 기준)", () => {
  it("parses titles and ids", () => {
    expect(parseCategoryTitle(" 1L. 자율주행차 ")).toEqual({ code: "1l", name: "자율주행차" });
    expect(parseCategoryTitle("메모")).toBeNull();
    expect(notionId("https://www.notion.so/36a9c770aa6180908b74cf2f84e066f8")).toBe(A);
    expect(notionId("36a9c770-aa61-8090-8b74-cf2f84e066f8")).toBe(A);
    expect(notionId("https://app.notion.com/p/36A9C770AA6180908B74CF2F84E066F8?pvs=204")).toBe(A);
    expect(notionId("nope")).toBeNull();
  });

  it("API 제목이 데이터 소스 이름이어도 ID 가 같으면 변경 아님 (title_notes 만)", () => {
    const yaml = [{ code: "1a", name: "AI" }, { code: "2b", name: "IT" }];
    const urls = { "1a": `https://www.notion.so/${A}`, "2b": `https://www.notion.so/${B}` };
    const d = diffNotionL1([
      { id: "36a9c770-aa61-8090-8b74-cf2f84e066f8", title: "1a. AI", type: "child_database" },
      { id: "36a9c770-aa61-8036-9ec3-e56654952895", title: "1j. IT", type: "child_database" },
    ], yaml, urls);
    expect(d).toEqual({ added: [], removed: [], title_notes: [{ code: "2b", yaml: "IT", api_title: "1j. IT" }] });
    expect(diffIsEmpty(d)).toBe(true);
  });

  it("새 하위 항목·사라진 L1 감지, 빈 제목·ID 없는 L1 무시", () => {
    const yaml = [{ code: "1a", name: "AI" }, { code: "2g", name: "건설" }, { code: "9z", name: "URL없음" }];
    const urls = { "1a": A, "2g": G };
    const d = diffNotionL1([
      { id: A, title: "1a. AI", type: "child_database" },
      { id: "11111111111111111111111111111111", title: "3d. 우주", type: "child_page" },
      { id: "22222222222222222222222222222222", title: "참고 링크", type: "child_page" },
      { id: "bad-id", title: "  ", type: "child_page" },
    ], yaml, urls);
    expect(d.added).toEqual([
      { id: "11111111111111111111111111111111", title: "3d. 우주", code: "3d" },
      { id: "22222222222222222222222222222222", title: "참고 링크", code: null },
    ]);
    expect(d.removed).toEqual([{ code: "2g", name: "건설" }]);
    expect(diffIsEmpty(d)).toBe(false);
  });
});
