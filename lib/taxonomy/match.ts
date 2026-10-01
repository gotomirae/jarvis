/**
 * 산업 매핑 (PRD §4.1.3) — docs/reference/taxonomy_match_reference.py 와 **같은 결과**를 낸다.
 * 스냅샷: config/taxonomy_expected.json (match.test.ts 가 전수 비교). 순수 함수 — 설정은 인자로 받는다.
 *
 * 순서: overrides(정확 일치) → 특수 라벨 → L1 별 [포함 일치(주 키워드+동의어) → 부분 일치(주 키워드만, 일반어 제외)] → 미매칭 = ETC
 */

export type TaxonomyL1Row = { code: string; name: string; l2: string[]; synonyms: string[] };
export type Override = { project: string; label: string; l1: string[] };
export type TaxonomyRules = {
  l1: TaxonomyL1Row[];
  special_labels: { code: string; aliases: string[] }[];
  matching: { normalize_strip: string[]; min_keyword_len: number; partial_min_len: number; stop_substrings: string[] };
  overrides?: Override[];
  unmatched_default?: string;
  heimdallr_sector_guard?: { sector: string; etc_if_industry_contains: string[] }[];   // lib/entities.ts sectorMisfit
  narrative_l2_scope?: L2Scope[];                                                        // lib/entities.ts l2Members
};

export type L2Scope = { l2: string; snowball_sectors?: string[]; heimdallr_sectors?: string[]; krx_industry_contains?: string[] };

export type HitType = "override" | "special" | "contains" | "partial" | "unmatched";
export type Hit = { l1: string; type: HitType; kw: string | null; common?: string };

const escapeRe = (c: string) => c.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");

export function normalize(s: string, strip: string[]): string {
  return s.replace(new RegExp(`[${strip.map(escapeRe).join("")}]+`, "g"), "").toLowerCase();
}

/** a 의 부분문자열 중 b 에 포함되는 가장 긴 것(길이 ≥ minLen). 같은 길이면 먼저 찾은 것 — 참조 구현과 동일 순회. */
export function lcs(a: string, b: string, minLen: number): string {
  const chars = Array.from(a);
  let best = "";
  for (let i = 0; i < chars.length; i++) {
    for (let j = i + minLen; j <= chars.length; j++) {
      const sub = chars.slice(i, j).join("");
      if (sub.length > best.length && b.includes(sub)) best = sub;
    }
  }
  return best;
}

/**
 * @param extraOverrides 대시보드에서 확정된 매핑(DB taxonomy_pending confirmed). yaml overrides 보다 먼저 적용한다.
 */
export function match(label: string, project: string, rules: TaxonomyRules, extraOverrides: Override[] = []): Hit[] {
  const M = rules.matching;
  const norm = (s: string) => normalize(s, M.normalize_strip);
  const stop = new Set(M.stop_substrings.map(norm));
  const n = norm(label);

  for (const o of [...extraOverrides, ...(rules.overrides ?? [])]) {
    if ((o.project === "*" || o.project === project) && norm(o.label) === n) {
      return o.l1.map((c) => ({ l1: c, type: "override" as const, kw: o.label }));
    }
  }
  for (const sp of rules.special_labels) {
    if (sp.aliases.some((a) => norm(a) === n)) return [{ l1: sp.code, type: "special", kw: label }];
  }

  const hits: Hit[] = [];
  for (const row of rules.l1) {
    const primary = [row.name, ...row.name.split("_"), ...row.l2];
    let found: Hit | null = null;
    for (const k of [...primary, ...row.synonyms]) {
      const kn = norm(k);
      if (Array.from(kn).length >= M.min_keyword_len && (n.includes(kn) || kn.includes(n))) {
        found = { l1: row.code, type: "contains", kw: k };
        break;
      }
    }
    if (!found) {
      for (const k of primary) {
        const c = lcs(n, norm(k), M.partial_min_len);
        if (Array.from(c).length >= M.partial_min_len && !stop.has(c)) {
          found = { l1: row.code, type: "partial", kw: k, common: c };
          break;
        }
      }
    }
    if (found) hits.push(found);
  }
  return hits.length ? hits : [{ l1: rules.unmatched_default ?? "ETC", type: "unmatched", kw: null }];
}

export function l1Codes(hits: Hit[]): string[] {
  return [...new Set(hits.map((h) => h.l1))];
}

/** primary_l1 = 가장 긴 일치 키워드(PRD §4.1.2). 같으면 먼저 나온 것. */
export function primaryL1(hits: Hit[]): string {
  let best = hits[0];
  for (const h of hits) if ((h.kw ?? "").length > (best.kw ?? "").length) best = h;
  return best.l1;
}

export type Classified = { hits: Hit[]; l1_codes: string[]; primary_l1: string; method: HitType; pending: boolean };

/**
 * 라벨 분류 + 확인 대기 판정 (PRD §4.1.3 ⑥): 미매칭은 항상 pending, 처음 보는 라벨의 부분 일치도 pending.
 * @param known 이미 확인된 라벨(스냅샷·확정분) — 부분 일치여도 pending 으로 올리지 않는다.
 */
export function classify(label: string, project: string, rules: TaxonomyRules, known: Set<string>, extraOverrides: Override[] = []): Classified {
  const hits = match(label, project, rules, extraOverrides);
  const method: HitType = hits.some((h) => h.type === "partial") ? "partial" : hits[0].type;
  const pending = method === "unmatched" || (method === "partial" && !known.has(label));
  return { hits, l1_codes: l1Codes(hits), primary_l1: primaryL1(hits), method, pending };
}

export const SPECIAL_CODES = ["MACRO", "ETF", "ETC"] as const;

/**
 * 종목의 L1 결정 (PRD §4.2): overrides → SnowBall sector → Heimdallr 투자 섹터 → HermesCall watchlist → 제품 설명 키워드.
 * 앞 단계가 미매칭이거나 일반 "기타" 라벨이면 다음 단계로 넘어간다. 제품 설명은 포함 일치만 인정(부분 일치 잡음 방지).
 */
export type EntityL1Inputs = { override?: string[] | null; snowballSector?: string | null; heimdallrSector?: string | null; hermesIndustries?: string[] | null; products?: string | null };
export type EntityL1 = { primary_l1: string; l1_codes: string[]; basis: "override" | "snowball" | "heimdallr" | "hermescall" | "products" | "none" };

export function resolveEntityL1(inp: EntityL1Inputs, rules: TaxonomyRules, extraOverrides: Override[] = []): EntityL1 {
  if (inp.override?.length) return { primary_l1: inp.override[0], l1_codes: [...new Set(inp.override)], basis: "override" };
  const norm = (s: string) => normalize(s, rules.matching.normalize_strip);
  const generic = norm("기타");
  const decisive = (label: string, project: string): Hit[] | null => {
    const hits = match(label, project, rules, extraOverrides);
    if (hits[0].type === "unmatched") return null;
    if (norm(label) === generic) return null;
    return hits;
  };
  const steps: [EntityL1["basis"], string, string[]][] = [
    ["snowball", "snowball", inp.snowballSector ? [inp.snowballSector] : []],
    ["heimdallr", "heimdallr_sector", inp.heimdallrSector ? [inp.heimdallrSector] : []],
    ["hermescall", "hermescall", inp.hermesIndustries ?? []],
  ];
  for (const [basis, project, labels] of steps) {
    const hits = labels.flatMap((l) => decisive(l, project) ?? []);
    if (hits.length) return { primary_l1: primaryL1(hits), l1_codes: l1Codes(hits), basis };
  }
  if (inp.products) {
    const hits = match(inp.products, "products", rules, extraOverrides).filter((h) => h.type === "contains");
    if (hits.length) return { primary_l1: primaryL1(hits), l1_codes: l1Codes(hits), basis: "products" };
  }
  const etc = rules.unmatched_default ?? "ETC";
  return { primary_l1: etc, l1_codes: [etc], basis: "none" };
}
