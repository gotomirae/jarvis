/**
 * M3 ② 결정적 추출 (PRD §7.3 ③, D19) — **LLM·유료 API 없음**. 정규식·사전만으로 원문 문장에서 증권사 산업 성장률을 뽑는다.
 * quote = 원문 문장 그대로(생성·요약 없음) → 수치 환각이 구조적으로 없다. 규칙·사전은 config/industry_growth.yaml 에서만 온다.
 *
 * 한 문장이 후보가 되려면 모두 만족: 증권사(같은 문장 또는 앞 문장 + 지시어) · 산업(시장 명사 + L1 키워드) · 성장 수치 · 기간.
 * 제외: 목표주가·주가·EPS·지수·GDP 등 · 기업이 주어인 수치 · 과거 시제만 있는 문장.
 */

export type GrowthPatterns = {
  industry_nouns_en: string[]; industry_nouns_ko: string[];
  growth_regex_en: string[]; growth_regex_ko: string[];
  derived_cagr_regex_en: string; year_range_regex: string;
  anaphora_starts: string[];
  exclude_terms_en: string[]; exclude_terms_ko: string[];
  past_tense_only_en: string[]; past_tense_only_ko: string[];
  value_range_pct: [number, number];
  future_markers_en: string[]; future_markers_ko: string[];
  cagr_words: string[]; next_year_words: string[];
  non_major_brokers: string[]; abbreviations: string[];
};

export type ExtractCtx = {
  patterns: GrowthPatterns;
  brokers: { name: string; aliases: string[] }[];
  l1Keywords: Record<string, string[]>;       // L1 → 키워드(segments_en/ko + taxonomy 이름·L2·동의어)
  companies: string[];                        // 엔티티 마스터 기업명(증권사 이름은 호출부가 뺀다)
  year: number;                               // 올해 (기간 판정)
  horizonMaxYearsAhead: number;               // rules.yaml us_major_broker.horizon_end_max_years_ahead
};

export type Metric = "CAGR" | "CAGR_DERIVED" | "NEXT_YEAR";
export type Extracted = {
  ok: true; broker: string; l1: string; metric: Metric; value_pct: number; horizon_end: number | null; horizon: string;
  quote: string; has_cagr_word: boolean; has_year_range: boolean; broker_via: "same" | "anaphora"; l1_keyword: string;
};
export type Rejected = { ok: false; reason: RejectReason; quote: string };
export type RejectReason =
  | "exclude_term" | "company_subject" | "past_tense_only" | "non_us_major_broker" | "no_broker" | "no_l1_match" | "ambiguous_l1"
  | "no_industry_noun" | "no_growth" | "value_out_of_range" | "no_horizon" | "horizon_too_far";

/** Python 인라인 (?i) → JS 플래그 */
export function pyRegex(src: string, extraFlags = ""): RegExp {
  const ci = src.startsWith("(?i)");
  return new RegExp(ci ? src.slice(4) : src, (ci ? "i" : "") + extraFlags);
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isHangul = (s: string) => /[가-힣]/.test(s);
const isAcronym = (s: string) => /^[A-Z0-9][A-Z0-9-]*$/.test(s) && s.length <= 4;

/** 키워드 포함 여부: 한글은 부분 문자열, 영문은 단어 경계 + 복수형 허용, 약어(AI·IT·HBM)는 대소문자 구분 */
export function keywordIndex(text: string, kw: string): number {
  if (!kw.trim()) return -1;
  if (isHangul(kw)) return text.indexOf(kw);
  const body = kw.trim().split(/\s+/).map((w) => (isAcronym(w) ? esc(w) : esc(w.replace(/s$/i, "")) + "s?")).join("\\s+");
  const re = new RegExp(`(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])`, isAcronym(kw.trim()) ? "" : "i");
  const m = re.exec(text);
  return m ? m.index : -1;
}

function containsAny(text: string, words: string[]): string | null {
  for (const w of words) if (keywordIndex(text, w) >= 0) return w;
  return null;
}

export function findBroker(text: string, brokers: ExtractCtx["brokers"]): string | null {
  let best: { name: string; len: number } | null = null;
  for (const b of brokers) for (const a of [b.name, ...b.aliases]) {
    if (keywordIndex(text, a) >= 0 && (!best || a.length > best.len)) best = { name: b.name, len: a.length };
  }
  return best?.name ?? null;
}

/** 가장 긴 L1 키워드. 같은 길이로 서로 다른 L1 이 걸리면 모호(null, ambiguous) */
export function matchL1(text: string, l1Keywords: ExtractCtx["l1Keywords"]): { l1: string; keyword: string } | "ambiguous" | null {
  let best: { l1: string; keyword: string } | null = null;
  let tie = false;
  for (const [l1, kws] of Object.entries(l1Keywords)) for (const kw of kws) {
    if (keywordIndex(text, kw) < 0) continue;
    if (!best || kw.length > best.keyword.length) { best = { l1, keyword: kw }; tie = false; }
    else if (kw.length === best.keyword.length && l1 !== best.l1) tie = true;
  }
  return tie ? "ambiguous" : best;
}

/** "20-25%"·"20~25%"·"20 to 25%" → "20%" (하한 정책) */
export function lowerBoundRanges(text: string): string {
  return text.replace(/(\d{1,3}(?:\.\d+)?)\s?%?\s?(?:-|–|~|to)\s?(\d{1,3}(?:\.\d+)?)\s?%/g, "$1%");
}

export function derivedCagr(a: number, ua: string, y1: number, b: number, ub: string, y2: number): number | null {
  const unit = (u: string) => (/^t/i.test(u) ? 1000 : 1);
  const start = a * unit(ua), end = b * unit(ub);
  if (y2 <= y1 || start <= 0 || end <= 0) return null;
  return Math.round((Math.pow(end / start, 1 / (y2 - y1)) - 1) * 1000) / 10;
}

export function yearsIn(text: string, yearRangeRegex: string): number[] {
  const re = pyRegex(yearRangeRegex, "g");
  const ys: number[] = [];
  for (const m of text.matchAll(re)) for (const g of m.slice(1)) if (g) ys.push(Number(g));
  return ys;
}

export function extractSentence(text: string, prev: string | null, ctx: ExtractCtx): Extracted | Rejected {
  const P = ctx.patterns;
  const quote = text.trim();
  const rej = (reason: RejectReason): Rejected => ({ ok: false, reason, quote });

  if (containsAny(quote, P.exclude_terms_en) || P.exclude_terms_ko.some((w) => quote.includes(w))) return rej("exclude_term");

  // 성장 수치 위치 (기업 주어 판정용) — 하한 정책 적용 후 탐색
  const t = lowerBoundRanges(quote);
  const derivedM = pyRegex(P.derived_cagr_regex_en).exec(t);
  let value: number | null = null;
  let valueAt = -1;
  for (const src of [...P.growth_regex_en, ...P.growth_regex_ko]) {
    const m = pyRegex(src).exec(t);
    if (m) { value = Number(m[1]); valueAt = m.index; break; }
  }
  const at = derivedM ? derivedM.index : valueAt;

  if (at >= 0 && ctx.companies.some((c) => { const i = keywordIndex(t, c); return i >= 0 && i < at; })) return rej("company_subject");

  const future = containsAny(quote, P.future_markers_en) || P.future_markers_ko.some((w) => quote.includes(w));
  const past = containsAny(quote, P.past_tense_only_en) || P.past_tense_only_ko.some((w) => quote.includes(w));
  if (past && !future) return rej("past_tense_only");

  let broker = findBroker(quote, ctx.brokers);
  let via: Extracted["broker_via"] = "same";
  if (!broker && prev && P.anaphora_starts.some((a) => quote.startsWith(a))) {
    broker = findBroker(prev, ctx.brokers);
    via = "anaphora";
  }
  if (!broker) return rej(P.non_major_brokers.some((b) => keywordIndex(quote, b) >= 0) ? "non_us_major_broker" : "no_broker");

  const l1 = matchL1(quote, ctx.l1Keywords);
  if (l1 === "ambiguous") return rej("ambiguous_l1");
  if (!l1) return rej("no_l1_match");
  if (!containsAny(quote, P.industry_nouns_en) && !P.industry_nouns_ko.some((w) => quote.includes(w))) return rej("no_industry_noun");

  const years = yearsIn(t, P.year_range_regex);
  const hasYearRange = years.length > 0;
  const hasCagrWord = P.cagr_words.some((w) => (isHangul(w) ? quote.includes(w) : keywordIndex(quote, w) >= 0));
  const nextYear = P.next_year_words.some((w) => (isHangul(w) ? quote.includes(w) : keywordIndex(quote, w) >= 0));

  let metric: Metric;
  let horizonEnd: number | null = null;
  if (derivedM) {
    value = derivedCagr(Number(derivedM[1]), derivedM[2], Number(derivedM[3]), Number(derivedM[4]), derivedM[5], Number(derivedM[6]));
    metric = "CAGR_DERIVED";
    horizonEnd = Number(derivedM[6]);
  } else if (value === null) {
    return rej("no_growth");
  } else if (hasCagrWord) {
    metric = "CAGR";
    horizonEnd = hasYearRange ? Math.max(...years) : null;
  } else if (nextYear || years.includes(ctx.year + 1)) {
    metric = "NEXT_YEAR";
  } else {
    return rej("no_horizon");
  }
  const [lo, hi] = P.value_range_pct;
  if (value === null || value < lo || value > hi) return rej("value_out_of_range");
  if (metric !== "NEXT_YEAR") {
    if (horizonEnd === null || horizonEnd < ctx.year) return rej("no_horizon");
    if (horizonEnd > ctx.year + ctx.horizonMaxYearsAhead) return rej("horizon_too_far");
  }
  const start = metric === "CAGR_DERIVED" ? Number(derivedM![3]) : years.length > 1 ? Math.min(...years) : null;
  const horizon = metric === "NEXT_YEAR" ? String(ctx.year + 1) : start && start < (horizonEnd as number) ? `${start}-${horizonEnd}` : `~${horizonEnd}`;
  return { ok: true, broker, l1: l1.l1, metric, value_pct: value, horizon_end: horizonEnd, horizon, quote, has_cagr_word: hasCagrWord || metric === "CAGR_DERIVED", has_year_range: hasYearRange, broker_via: via, l1_keyword: l1.keyword };
}

/** 본문 → 문장 (약어 마침표 보호) */
export function splitSentences(body: string, abbreviations: string[]): string[] {
  let t = body.replace(/\s+/g, " ");
  const marks = abbreviations.map((a, i) => [a, `\u0000${i}\u0000`] as const);
  for (const [a, m] of marks) t = t.split(a).join(m);
  const parts = t.split(/(?<=[.!?。])\s+(?=["“'(\[A-Z0-9가-힣])/);
  return parts.map((p) => { let s = p; for (const [a, m] of marks) s = s.split(m).join(a); return s.trim(); }).filter((s) => s.length > 0);
}

/** 문서 전체: 문장마다 앞 문장을 넘겨 추출. 후보만 반환 */
export function extractArticle(body: string, ctx: ExtractCtx): Extracted[] {
  const ss = splitSentences(body, ctx.patterns.abbreviations);
  const out: Extracted[] = [];
  for (let i = 0; i < ss.length; i++) {
    const r = extractSentence(ss[i], i > 0 ? ss[i - 1] : null, ctx);
    if (r.ok) out.push(r);
  }
  return out;
}
