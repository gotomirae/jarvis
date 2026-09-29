/**
 * M3 ② 자동 채택 (PRD §7.3 ⑤~⑦, D19) — 사람 확인 없음. `status=adopted` 만 판정에 쓴다(불변 규칙 5).
 *  A1: 등급 A(그 증권사 자체 도메인) 단독
 *  B1: 등급 B 서로 다른 매체 2곳 이상, 같은 증권사·L1·값 ±2%p (신디케이션 = 같은 문장은 1곳)
 *  B2: 등급 B 단일 매체라도 증권사 이름 + CAGR 표현 + 연도 범위가 모두 명시
 *  충돌: 같은 증권사·L1 채택값이 5%p 이상 다르면 최신값 + conflict
 *  만료: 발표 90일 초과 → expired. 등급 밖·deny 도메인 → dropped(저장 안 함)
 * 임계값은 rules.yaml M3.us_major_broker.adoption, 도메인은 industry_growth.yaml domain_tiers.
 */
import { median } from "@/lib/engine/industry-growth";

export type DomainTiers = { A: Record<string, string[]>; B: string[]; deny: string[] };
export type AdoptionRules = {
  B1_tier_b_min_independent_sources: number; B1_value_tolerance_pctp: number; B1_syndication_similarity: number;
  conflict_threshold_pctp: number;
};

export type Candidate = {
  url?: string; domain: string; broker: string; l1: string; value_pct: number; published: string;   // YYYY-MM-DD
  quote?: string; quote_id?: string; has_cagr_word?: boolean; has_year_range?: boolean;
};
export type Tier = "A" | "B" | "other";
export type GroupStatus = "adopted" | "unverified" | "expired" | "dropped";
export type GroupResult = {
  broker: string; l1: string; status: GroupStatus; rule: "A1" | "B1" | "B2" | null;
  value_used: number | null; published: string | null; conflict: boolean;
  items: (Candidate & { tier: Tier; item_status: GroupStatus; item_rule: "A1" | "B1" | "B2" | null; corroborating: string[] })[];
  corroborating: string[];
};

export function hostMatches(domain: string, suffix: string): boolean {
  const d = domain.toLowerCase().replace(/^www\./, "");
  return d === suffix || d.endsWith(`.${suffix}`);
}

export function tierOf(domain: string, broker: string, t: DomainTiers): Tier | "deny" {
  if (t.deny.some((s) => hostMatches(domain, s))) return "deny";
  if ((t.A[broker] ?? []).some((s) => hostMatches(domain, s))) return "A";
  if (t.B.some((s) => hostMatches(domain, s))) return "B";
  return "other";
}

/** 단어 집합 자카드 유사도 (신디케이션 판정) */
export function similarity(a: string, b: string): number {
  const w = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9가-힣%. ]/g, " ").split(/\s+/).filter(Boolean));
  const A = w(a), B = w(b);
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

const ageDays = (published: string, today: string) => (new Date(today).getTime() - new Date(published).getTime()) / 86400_000;

/** B 등급 항목에서 서로 독립인 매체 수 (같은 도메인·같은 문장(신디케이션)은 1곳) */
export function independentSources(items: Candidate[], simMin: number): Candidate[] {
  const picked: Candidate[] = [];
  for (const x of items) {
    const dup = picked.some((p) => hostMatches(p.domain, x.domain) || hostMatches(x.domain, p.domain)
      || (p.quote_id !== undefined && p.quote_id === x.quote_id)
      || (p.quote !== undefined && x.quote !== undefined && similarity(p.quote, x.quote) >= simMin));
    if (!dup) picked.push(x);
  }
  return picked;
}

export function adoptGroup(broker: string, l1: string, items: Candidate[], tiers: DomainTiers, r: AdoptionRules, today: string, maxAgeDays: number): GroupResult {
  const tagged = items.map((x) => ({ ...x, tier: tierOf(x.domain, broker, tiers) }));
  const kept = tagged.filter((x): x is typeof x & { tier: Tier } => x.tier === "A" || x.tier === "B");
  const base: Omit<GroupResult, "status" | "rule" | "value_used" | "published" | "conflict" | "corroborating"> = { broker, l1, items: [] };
  if (!kept.length) return { ...base, status: "dropped", rule: null, value_used: null, published: null, conflict: false, corroborating: [] };

  const fresh = kept.filter((x) => ageDays(x.published, today) <= maxAgeDays);
  const expiredItems = kept.filter((x) => ageDays(x.published, today) > maxAgeDays).map((x) => ({ ...x, item_status: "expired" as GroupStatus, item_rule: null, corroborating: [] as string[] }));
  if (!fresh.length) return { ...base, items: expiredItems, status: "expired", rule: null, value_used: null, published: null, conflict: false, corroborating: [] };

  // 각 항목이 스스로 채택 근거가 되는가
  const adoptedItems: { x: (typeof fresh)[number]; rule: "A1" | "B1" | "B2"; corr: string[] }[] = [];
  for (const x of fresh) {
    if (x.tier === "A") { adoptedItems.push({ x, rule: "A1", corr: [] }); continue; }
    const near = fresh.filter((y) => y.tier === "B" && Math.abs(y.value_pct - x.value_pct) <= r.B1_value_tolerance_pctp);
    const indep = independentSources(near, r.B1_syndication_similarity);
    if (indep.length >= r.B1_tier_b_min_independent_sources) {
      adoptedItems.push({ x, rule: "B1", corr: indep.filter((y) => y !== x).map((y) => y.url ?? y.domain) });
    } else if (x.has_cagr_word && x.has_year_range) {
      adoptedItems.push({ x, rule: "B2", corr: [] });
    }
  }
  const itemsOut = [
    ...fresh.map((x) => {
      const a = adoptedItems.find((y) => y.x === x);
      return { ...x, item_status: (a ? "adopted" : "unverified") as GroupStatus, item_rule: a?.rule ?? null, corroborating: a?.corr ?? [] };
    }),
    ...expiredItems,
  ];
  if (!adoptedItems.length) return { ...base, items: itemsOut, status: "unverified", rule: null, value_used: null, published: null, conflict: false, corroborating: [] };

  adoptedItems.sort((a, b) => b.x.published.localeCompare(a.x.published));
  const latest = adoptedItems[0];
  const values = adoptedItems.map((a) => a.x.value_pct);
  const conflict = Math.max(...values) - Math.min(...values) >= r.conflict_threshold_pctp;
  return { ...base, items: itemsOut, status: "adopted", rule: latest.rule, value_used: latest.x.value_pct, published: latest.x.published, conflict, corroborating: latest.corr };
}

/** 후보 → (증권사, L1) 묶음별 채택 */
export function adoptAll(cands: Candidate[], tiers: DomainTiers, r: AdoptionRules, today: string, maxAgeDays: number): GroupResult[] {
  const groups = new Map<string, Candidate[]>();
  for (const c of cands) (groups.get(`${c.broker}|${c.l1}`) ?? groups.set(`${c.broker}|${c.l1}`, []).get(`${c.broker}|${c.l1}`)!).push(c);
  return [...groups.entries()].map(([k, xs]) => { const [b, l] = k.split("|"); return adoptGroup(b, l, xs, tiers, r, today, maxAgeDays); });
}

/** ⑥ 집계: L1 별 증권사마다 최신 adopted 값 1개 → 중앙값 ≥ 기준이면 통과 */
export function aggregateL1(adoptedByBroker: Record<string, number>, minPct: number): { median: number | null; pass: boolean; brokers: number } {
  const m = median(Object.values(adoptedByBroker));
  return { median: m, pass: m !== null && m >= minPct, brokers: Object.keys(adoptedByBroker).length };
}
