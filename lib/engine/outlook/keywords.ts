/**
 * M3 ② 문장 기준 L1 판정용 키워드 (PRD §7.3 ④). taxonomy.yaml(L1 이름·L2·동의어) + industry_growth.yaml segments_en/ko.
 * 영문 기사에서 "AI chips"(1b)가 "AI"(1a)보다 길어 우선하도록 최장 일치로 쓴다(extract.matchL1).
 */
export function l1KeywordMap(
  tx: { l1: { code: string; name: string; l2: string[]; synonyms: string[] }[] },
  segmentsEn: Record<string, string[]>,
  segmentsKo: Record<string, string[]>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const r of tx.l1) {
    const kws = [r.name, ...r.name.split("_"), ...r.l2, ...r.synonyms, ...(segmentsEn[r.code] ?? []), ...(segmentsKo[r.code] ?? [])];
    out[r.code] = [...new Set(kws.map((k) => k.trim()).filter((k) => k.length >= 2))];
  }
  return out;
}
