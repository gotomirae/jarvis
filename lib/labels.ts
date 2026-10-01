/**
 * 화면용 쉬운 이름 — 약어(N·C·F·P·PRI·M3·M4·CAGR·YoY·등급 A/B·규칙 A1/B1/B2)를 풀어 쓴다. 대시보드 전 페이지가 공유.
 */
export const METRIC_NAME: Record<string, string> = {
  CAGR: "연평균 성장률", CAGR_DERIVED: "연평균 성장률(금액 전망으로 계산)", NEXT_YEAR: "내년 성장률",
};
export const TIER_NAME: Record<string, string> = { A: "증권사 자체 공개 페이지", B: "주요 경제 매체", other: "기타 매체" };
export const RULE_NAME: Record<string, string> = {
  A1: "증권사가 직접 발표", B1: "서로 다른 매체 2곳 이상이 같은 수치 보도", B2: "증권사·연평균·기간이 모두 적힌 매체 보도", manual: "직접 입력",
};
export const STATUS_NAME: Record<string, string> = { adopted: "채택(판정에 사용)", unverified: "미검증(참고만)", expired: "만료(발표 90일 경과)", excluded: "제외" };
export const METHOD_NAME: Record<string, string> = { override: "지정 매핑", special: "특수 분류", contains: "이름 포함 일치", partial: "부분 일치(확인 필요)", unmatched: "매핑 없음(기타)" };
export const BASIS_NAME: Record<string, string> = {
  override: "지정", snowball: "SnowBall 섹터", heimdallr: "Heimdallr 섹터", hermescall: "HermesCall 산업", products: "제품 설명", none: "근거 없음",
};
export const SIGNAL_NAME: Record<string, string> = {
  industry_narrative: "FlyWheel 산업 흐름", company_mention_fw: "FlyWheel 위키 언급", mentor_consensus: "Sage 멘토 합의", earnings_catalyst: "HermesCall 실적 수혜",
  earnings_quality_us: "HermesCall 실적 품질(미국)", industry_sentiment: "HermesCall 산업 분위기", accel_grade: "Heimdallr 실적 가속 등급", price_reflection: "Heimdallr 주가 반영도",
  holding_risk: "SnowBall 위험 경보", entry_check: "진입 조건 점검", breakout_watch: "실적 돌파",
};
export const FAMILY_NAME: Record<string, string> = { flywheel: "FlyWheel", sage: "Sage", hermescall: "HermesCall", heimdallr: "Heimdallr", entry: "진입 조건", snowball: "SnowBall" };
export const SPECIAL_L1: Record<string, string> = { MACRO: "거시경제", ETF: "ETF", ETC: "기타" };

export const yesNo = (b: boolean | null | undefined) => (b ? "✓" : "—");
export const direction = (d: number) => (d > 0 ? "긍정" : d < 0 ? "부정" : "중립");
