import { describe, expect, it } from "vitest";
import { brokerKo, direction, METRIC_NAME, RULE_NAME, TIER_NAME, yesNo } from "./labels";

describe("labels", () => {
  it("증권사 한글 이름", () => {
    expect(brokerKo("BofA Securities")).toBe("뱅크오브아메리카");
    expect(brokerKo("Nomura")).toBe("Nomura");
  });
  it("쉬운 이름", () => {
    expect(METRIC_NAME.CAGR).toBe("연평균 성장률");
    expect(TIER_NAME.A).toBe("증권사 자체 공개 페이지");
    expect(RULE_NAME.B1).toContain("2곳");
    expect([yesNo(true), yesNo(false), yesNo(null)]).toEqual(["✓", "—", "—"]);
    expect([direction(1), direction(-1), direction(0)]).toEqual(["긍정", "부정", "중립"]);
  });
});
