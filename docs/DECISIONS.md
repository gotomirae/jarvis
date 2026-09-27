# JARVIS 결정 기록

| ID | 날짜 | 결정 | 근거 |
|---|---|---|---|
| D1 | 2026-09-27 | 포트폴리오 원장 = SnowBall Heritage(member ironman). 구글 시트·FlyWheel positions.json 폐기 | 사용자 지정. 이중 장부 불일치 실측 |
| D2 | 2026-09-27 | 산업 정본 = 노션 2_1 카테고리 18개(L1, `1l 자율주행차` 추가) + [산업] 페이지(L2) | 사용자 지정 |
| D3 | 2026-09-27 | 매핑 = 키워드 일부 겹침 + 오탐 가드. 에너지→전력인프라, 자동차→자율주행차, 그 외 미매칭→기타 | 사용자 지정 + 실측 오탐 |
| D4 | 2026-09-27 | Pull + 계약(SnowBall 토큰 RPC, anon SELECT 우선) | 회귀 위험 최소화 |
| D5 | 미정(P0) | JARVIS DB: 신규 Supabase 우선, 불가 시 SnowBall DB `jarvis` 스키마 | Supabase 4개 사용 중 |
| D6 | 2026-09-27 | 판정 결정론, LLM은 주간 메모 서술만 + grounding gate | Heimdallr canary 품질 0/4 |
| D7 | 2026-09-27 | pg_cron → workflow_dispatch 정시 실행 | GitHub schedule 수 시간 지연 실측 |
| D8 | 2026-09-27 | 저장소 public | 공유 Actions 무료 분 보호 |
| D9 | 2026-09-27 | @Tonny_JARVIS_bot webhook + JARVIS 대시보드 | 사용자 지정 |
| D10 | 2026-09-27 | 원 프로젝트 기술적 알림은 병행 2주 후 텔레그램만 중단 | 중복 제거 |
| D11 | 2026-09-27 | 스택 SnowBall과 동일 | 일관성 |
| D12 | 2026-09-27 | 🟢 진입 = M1∧M2∧M3∧M4∧M5 필수. K1·H1 돌파는 🔵 관찰(진입 아님), 이후 M1~M5 통과 시 PEAD_PB 🟢 | 사용자 지정. 돌파일엔 조정·MACD 직전이 구조적으로 불성립 |
| D13 | 2026-09-27 | M1·M2·M5는 원 프로젝트 계산(국내 Heimdallr, 미국 HermesCall), M3·M4·게이트는 JARVIS | 데이터 보유 위치 |
| D14 | 2026-09-27 | 링크 규칙 단일 출처 `config/links.yaml`, 텔레그램·대시보드 공유, 불가 링크는 생략 | Heimdallr links.py 교훈 |
| D15 | 2026-09-27 | 미국 M5는 투자자별 수급 미공개로 "매집일 대용"(종가↑ & 거래량 ≥ 20일 평균, 2일 연속) | 데이터 제약, 메시지에 명시·성과 분리 집계 |
| D16 | 2026-09-27 | M3 = ① 실제 실적 ② 미국 메이저 증권사 산업 성장률 전망 ③ industry_growth.yaml 전망 중 하나 이상(각 ≥ 15%). 필수 근거 지정은 rules.yaml `required_bases` | 사용자 지정 |
| D17 | 2026-09-27 | M3 ②는 증권사 로그인 자료가 아닌 웹 검색 공개 자료, 발표 90일 이내, 미국 메이저 6곳만. (수집·채택 방식은 D19로 대체) | 사용자 지정 |
| D18 | 2026-09-27 | SnowBall 연결은 docs/snowball/0019_jarvis_contract.sql(로컬 PG16 검증) + docs/SNOWBALL_SETUP_GUIDE.md로 진행, JARVIS P0 선행 | 장부 단일화 전제 |
| D19 | 2026-09-27 | M3 ② 무료·완전 자동: 무키 공개 소스(Google News RSS·Bing News RSS·GDELT·증권사 공개 인사이트 페이지) → 정규식 추출(LLM·유료 API 금지, quote=원문 문장) → 출처 등급 A(증권사 도메인 단독)/B(주요 매체 2곳 교차 또는 CAGR·기간 명시) 자동 채택 → 증권사별 최신값 중앙값 ≥ 15%. 사람 확인 없음. 월 LLM 상한 $5 | 사용자 지정(유료 콘솔 미사용·무탭). 숫자 환각 0, 재현율 손실은 ①·③ 보완 |
