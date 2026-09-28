import { describe, expect, it } from "vitest";
import expected from "@/config/taxonomy_expected.json";
import { loadYaml } from "@/lib/config/load";
import { classify, l1Codes, lcs, match, normalize, primaryL1, resolveEntityL1, type Hit, type TaxonomyRules } from "./match";

const rules = loadYaml<TaxonomyRules>("taxonomy.yaml");
const snap = expected as Record<string, Record<string, Hit[]>>;

describe("taxonomy match — 참조 구현 스냅샷 (부록 A)", () => {
  for (const [project, labels] of Object.entries(snap)) {
    it(`${project}: ${Object.keys(labels).length}개 라벨 전부 일치`, () => {
      for (const [label, hits] of Object.entries(labels)) expect(match(label, project, rules), `${project}/${label}`).toEqual(hits);
    });
  }

  it("오탐 회귀: 인바운드↔파운드리, 의료기기↔미용기기, AI인프라반도체↔전력인프라", () => {
    expect(l1Codes(match("인바운드", "*", rules))).toEqual(["2e"]);
    expect(l1Codes(match("의료기기", "*", rules))).toEqual(["2c"]);
    expect(l1Codes(match("미용기기", "*", rules))).toEqual(["1e"]);
    expect(l1Codes(match("AI인프라반도체", "*", rules))).toEqual(["1a", "1b"]);
  });

  it("미매칭 0건: 5개 프로젝트 현재 라벨", () => {
    for (const [project, labels] of Object.entries(snap)) {
      for (const label of Object.keys(labels)) expect(match(label, project, rules)[0].type, `${project}/${label}`).not.toBe("unmatched");
    }
  });
});

describe("taxonomy match — 규칙 단위", () => {
  it("normalize strips separators and lowercases", () => {
    expect(normalize("AI · 반도체_장비/부품-1.0", rules.matching.normalize_strip)).toBe("ai반도체장비부품10");
  });

  it("lcs picks the first longest common substring", () => {
    expect(lcs("인바운드", "파운드리", 2)).toBe("운드");
    expect(lcs("abcxyz", "xyzabc", 2)).toBe("abc");
    expect(lcs("ab", "cd", 2)).toBe("");
  });

  it("unmatched → ETC, special labels, project-scoped and extra overrides", () => {
    expect(match("테스트산업2", "hermescall", rules)).toEqual([{ l1: "ETC", type: "unmatched", kw: null }]);
    expect(match("ETN", "*", rules)).toEqual([{ l1: "ETF", type: "special", kw: "ETN" }]);
    expect(match("매크로", "*", rules)).toEqual([{ l1: "MACRO", type: "special", kw: "매크로" }]);
    expect(match("테스트산업2", "hermescall", rules, [{ project: "hermescall", label: "테스트산업2", l1: ["2b"] }])[0]).toEqual({ l1: "2b", type: "override", kw: "테스트산업2" });
    expect(match("테스트산업2", "sage", rules, [{ project: "hermescall", label: "테스트산업2", l1: ["2b"] }])[0].type).toBe("unmatched");
    const noDefault = { ...rules, unmatched_default: undefined, overrides: undefined };
    expect(match("zzz", "*", noDefault)[0].l1).toBe("ETC");
  });

  it("partial match on primary keywords, ignoring stop substrings", () => {
    const hits = match("우주항공방산업", "*", rules);
    expect(hits[0]).toMatchObject({ l1: "1g", type: "contains" });
    const p = match("반도산업", "*", rules);
    expect(p).toContainEqual({ l1: "1b", type: "partial", kw: "반도체", common: "반도" });
    expect(match("기기산업", "*", rules)[0].type).toBe("unmatched");   // '기기'·'산업' 은 일반어
  });

  it("primaryL1 = longest keyword", () => {
    expect(primaryL1([{ l1: "1l", type: "contains", kw: "자동차" }, { l1: "2a", type: "contains", kw: "로봇" }])).toBe("1l");
    expect(primaryL1([{ l1: "ETC", type: "unmatched", kw: null }, { l1: "2a", type: "contains", kw: "로봇" }])).toBe("2a");
  });

  it("classify: unmatched and unseen partial go to pending", () => {
    expect(classify("테스트산업2", "hermescall", rules, new Set()).pending).toBe(true);
    expect(classify("반도산업", "x", rules, new Set()).pending).toBe(true);
    expect(classify("반도산업", "x", rules, new Set(["반도산업"])).pending).toBe(false);
    const c = classify("자동차·로봇", "sage", rules, new Set());
    expect(c).toMatchObject({ method: "contains", pending: false, l1_codes: ["1l", "2a"], primary_l1: "1l" });
  });
});

describe("resolveEntityL1 (PRD §4.2 순서)", () => {
  it("override > snowball > heimdallr > hermescall > products > none", () => {
    expect(resolveEntityL1({ override: ["2f", "2f"], snowballSector: "반도체 IDM" }, rules)).toEqual({ primary_l1: "2f", l1_codes: ["2f"], basis: "override" });
    expect(resolveEntityL1({ snowballSector: "반도체 IDM", heimdallrSector: "금융" }, rules)).toMatchObject({ primary_l1: "1b", basis: "snowball" });
    expect(resolveEntityL1({ snowballSector: "기타", heimdallrSector: "금융" }, rules)).toMatchObject({ primary_l1: "2f", basis: "heimdallr" });
    expect(resolveEntityL1({ snowballSector: "알수없음", heimdallrSector: null, hermesIndustries: ["로봇휴머노이드", "AI인프라반도체"] }, rules))
      .toMatchObject({ l1_codes: ["2a", "1a", "1b"], basis: "hermescall" });
    expect(resolveEntityL1({ products: "스낵 등 식품류" }, rules)).toMatchObject({ primary_l1: "2d", basis: "products" });
    expect(resolveEntityL1({ products: "반도산업" }, rules)).toEqual({ primary_l1: "ETC", l1_codes: ["ETC"], basis: "none" });
    expect(resolveEntityL1({}, { ...rules, unmatched_default: undefined })).toEqual({ primary_l1: "ETC", l1_codes: ["ETC"], basis: "none" });
  });

  it("사용자 지정 기타(화학·소재)는 ETC 로 확정된다", () => {
    expect(resolveEntityL1({ heimdallrSector: "화학·소재" }, rules)).toMatchObject({ primary_l1: "ETC", basis: "heimdallr" });
  });
});
