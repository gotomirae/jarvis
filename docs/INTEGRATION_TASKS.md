# 연계 프로젝트 변경 작업서 (JARVIS PRD v1.3 대응)

> 각 절은 **해당 프로젝트 저장소의 Claude Code(Heimdallr는 Codex) 세션에 그대로 붙여 넣는** 작업 지시다.
> 공통 원칙: 핵심 로직은 바꾸지 않는다. 연결에 필요한 최소 계약만 추가한다. 각 프로젝트의 기존 규약(CLAUDE.md·AGENTS.md·traps)을 우선한다.
> 산업명 기준: 노션 `2_1. 산업 & 종목` 18개 카테고리. JARVIS `config/taxonomy.yaml`과 PRD 부록 A를 따른다.
> 순서: **A(SnowBall) → E(Sage) → C(HermesCall) → B(Heimdallr) → D(FlyWheel)**. A는 JARVIS P0의 선행 조건이다. B·C는 JARVIS P3(🟢 진입 신호)의 선행 조건이다.

---

## A. SnowBall Heritage (Claude Code) — P0 선행 필수

> **실행 방법은 `docs/SNOWBALL_SETUP_GUIDE.md`를 따른다**(작업 트리 정리 → Claude Code 프롬프트 → 토큰 생성 → SQL Editor 실행 → 검증 → 배포 → JARVIS 환경변수).
> 마이그레이션은 검증된 초안 `docs/snowball/0019_jarvis_contract.sql`을 기준으로 한다. 아래는 그 내용 요약이다.

**목적**: JARVIS가 service_role 키 없이 아이언맨 포트폴리오·트리거를 읽고, 발굴 후보를 아이디어 draft로 넣게 한다.

1. `types/index.ts`에 JARVIS 계약 타입을 추가한다(타입부터 수정).
2. 마이그레이션 `supabase/migrations/0019_jarvis_contract.sql`
   - Vault 시크릿 `jarvis_token`을 추가한다(값은 사용자가 SQL Editor에서 입력).
   - 모든 함수는 `SECURITY DEFINER`, `set search_path = public`로 둔다. 첫 줄에서 `p_token`을 Vault 값과 비교해 불일치 시 예외를 낸다. owner는 member_key=`ironman`의 owner_id로 고정한다.
   - 읽기 함수
     - `jarvis_export_positions(p_token)`: `v_positions` 기반. 필드는 asset_id, ticker/code, market, name, sector, industry_l1(5번), qty, avg_cost, market_value, weight, allowed_weight(최신 factor_log), heat_score, heat_breakdown, 최신 thesis(version, body, conviction, invalidation_1~3), 대기 트리거 수, 최근 decision.
     - `jarvis_export_watchlist(p_token)`
     - `jarvis_export_triggers(p_token, p_horizon_days int)`: asset_id·ticker·direction·category·magnitude·expected_window·expected_date·status·one_line·source_url. waiting/imminent만 반환한다. **JARVIS M4에서 사용.**
     - `jarvis_export_macro(p_token)`
     - `jarvis_export_risk_alerts(p_token, p_since)`
     - `jarvis_export_performance(p_token, p_from, p_to)`
   - 쓰기 함수 `jarvis_submit_idea(p_token, p_payload jsonb) returns uuid`
     - 자산이 없으면 `assets`(watch_only=true, member ironman)를 만들고 `assets_master`로 검증한다.
     - `investment_ideas`에 insert(scope=`asset`, status=`draft`, payload는 PRD 4.3 스키마 + `source:'jarvis'`, `jarvis_signals`, `jarvis_entry`(M1~M5 근거), `jarvis_url`).
     - 같은 asset의 jarvis draft가 7일 내 있으면 새 version으로 갱신한다(diff 규칙 유지).
   - anon 역할에는 이 함수들의 EXECUTE만 허용한다. 테이블 권한은 변경하지 않는다.
3. `/[member]/ideas` 카드에 `source==='jarvis'` 배지, JARVIS 링크, M1~M5 요약을 표시한다.
4. **매수 강제 규칙(불변 규칙 1)은 절대 완화하지 않는다.**
5. `lib/utils/sectors.ts` 28개 이름은 유지한다. 노션 L1 매핑 함수 `sectorToIndustryL1()`을 추가한다.
   - 에너지 → 전력인프라
   - 자동차 → 자율주행차
   - 소재·기타 → 기타
   - 나머지는 PRD 부록 A.3
   - 섹터 비중 화면에 L1 보기 토글을 추가한다(선택).
6. 테스트: 토큰 불일치 거부, 다른 owner 비노출, idea 중복 갱신, triggers horizon 필터.
7. `docs/DECISIONS.md`에 "D-xx JARVIS 계약"을 기록한다.

---

## B. Heimdallr Call (Codex) — P3 선행

**목적**: 국내 종목의 **필수 조건 M1·M2·M5**를 매일 계산해 `entry_checks`로 제공하고, 🔵 K1 실적 돌파를 기록하며, 한국 기술적 판정을 Heimdallr 한 곳으로 모은다.
**먼저 읽을 것**: `docs/PRD.md` §4·§8.6, `docs/traps.md`, `AGENTS.md`. 모든 임계값은 `src/config/constants.py`에 둔다(JARVIS `rules.yaml > entry_core`와 같은 값).

1. **신규 테이블 `entry_checks`** (anon SELECT 허용)
   ```
   code, check_date(KR 거래일), 
   m1_pass, m1_detail jsonb  -- rev_yoy[t,t-1], op_yoy[t,t-1], op>0, ttm_rev_growth, ttm_op_growth,
                             -- annual_consensus_ok(null=데이터없음), base_effect_warning,
                             -- drawdown_from_post_earnings_high, drawdown_from_52w_high,
                             -- range_20d_pct, ret_20d_pct, pri, price_state('PB'|'SW'|null)
   m2_pass, m2_detail jsonb  -- macd, signal, hist[-3..0], gap_pct_of_close, projected_bars, cross_today
   m5_pass, m5_detail jsonb  -- foreign_net[-3..0], inst_net[-3..0], path('foreign'|'institution'|'combined'), streak_days
   invalidation_price, low_10d, low_20d, computed_at
   PRIMARY KEY (code, check_date)
   ```
2. **계산 순서(비용 최소화)**: 유니버스 전체에 DB만으로 M1 재무 조건을 거른다 → 통과 종목만 KIS 수급(M5) → 통과 종목만 일봉 MACD(M2)와 가격 조건. 전 종목 일봉 호출을 피한다. 결과는 통과·탈락 모두 저장한다(탈락 사유 분석용). 일봉이 필요 없는 탈락은 m2_detail을 null로 둔다.
3. **M1 정의**(PRD §7.3, 모두 충족)
   - 최근 2개 분기 연속 매출 YoY > 0 & 영업이익 YoY > 0, 최근 분기 영업이익 흑자
   - 매출 YoY(t) > YoY(t−1) & 영업이익 YoY(t) > YoY(t−1)
   - TTM 매출·영업이익 > 4분기 전 TTM
   - 네이버 연간 컨센서스가 있으면 올해(E) 매출·영업이익 > 전년 확정
   - `base_effect_warning=false`
   - (발표 후 고점 대비 ≤ −10% **또는** 52주 고점 대비 ≤ −15%) → PB, **또는** (20일 종가 범위 ≤ 12% & |20일 수익률| ≤ 5%) → SW
   - PRI < 50
4. **M2 정의**
   - MACD(12,26,9) < Signal, 히스토그램 2일 연속 개선
   - (Signal − MACD)/종가 ≤ 0.30% **또는** 추정 교차 ≤ 3봉
   - 당일 교차는 cross_today=true로 허용. 교차 후 2일 이상 지났으면 탈락
5. **M5 정의**: KIS 투자자별 매매로 판정한다. 외국인 2일 연속 순매수 **또는** 기관 2일 연속 순매수 **또는** 외국인+기관 합산 2일 연속 순매수. path와 streak_days를 기록한다.
6. **🔵 K1 실적 돌파**
   - 대상: 잠정실적 공시로 ★·○, base_effect_warning=false
   - D0(공시 후 첫 정규장) 조건: (시가 ≥ 전일종가×1.03 **또는** 종가수익률 ≥ +5%) & 거래량 ≥ 20일 평균×2.5 & 종가위치 ≥ 0.7
   - 기록: `notifications.kind='earnings_breakout'`(payload: d0, d0_low, 근거). 진입 신호 아님.
   - 일봉 시가·고가·저가가 없으면 추가한다(KIS 일봉 또는 네이버 차트).
7. **실행 시점**: 기존 `daily_digest.yml`(17:37/18:17/19:07)에서 일일 요약 **앞**에 `entry_checks`를 계산한다. 멱등이며 같은 check_date는 upsert.
8. **텔레그램**: 상수 `TECHNICAL_TELEGRAM_ENABLED`(기본 True)를 추가한다. JARVIS 병행 2주 후 사용자가 False로 바꾸면 `technical_setup`·`earnings_breakout`은 **DB 기록만** 하고 발송하지 않는다. ⚡ 실적 알림·일일 요약은 유지한다.
9. **Kairos**: `SUPPORTED_INDUSTRIES`를 노션 L1 18개로 교체한다(자율주행차 포함). 기존 이름은 별칭으로 남긴다(PRD 부록 A.4).
10. **투자 섹터**: `sector_map.py` 33개 이름은 유지하고, JARVIS `/api/public/taxonomy`로 L1을 매핑해 `krx_universe.industry_l1`(또는 뷰)을 제공한다.
11. **anon SELECT 확인**: `screen_results`, `price_snapshots`, `quarterly_fundamentals`, `consensus_snapshots`, `notifications`(kind·payload), `analyses`(★○ 트리거·시나리오), `outcome_tracking`, `krx_universe`, `index_snapshots`, `entry_checks`. 개인 원문이 있는 테이블은 읽기 전용 뷰로 제공한다.
12. **회귀**: 전체 안전 회귀를 통과한다. M1·M2·M5 경계값 테스트, 과거 2시즌 replay로 M1~M5(M3·M4 제외) 통과 표본 수를 `docs/decisions/`에 기록한다.

---

## C. HermesCall (Claude Code) — P1(산업명) · P3(진입 조건)

1. **산업명 교체(P1)**: `config/watchlist.json` industries를 노션 L1로 바꾼다. DB 동기화, 딥분석 프롬프트 산업 목록, 대시보드 필터도 함께 바꾼다.
   - `AI인프라반도체` → `["AI","반도체"]`
   - `Beauty미용기기` → `화장품_미용기기`
   - `라면` → `소비재`
   - `로봇휴머노이드` → `Robot`
   - `바이오제약` → `바이오`
   - `방산`·`우주항공` → `우주항공방산`
   - `배터리` → `2차 전지`
   - `의료기기` → `헬스케어`
   - `인바운드` → `여행`
   - 나머지는 동일

   과거 `beneficiaries.industry`는 마이그레이션으로 치환하고 원본은 백업 컬럼에 둔다.
2. **시세 확장**: `price_history.DailyBar`에 open/high/low/volume을 추가한다(네이버 차트·야후 v8 응답에 포함). close만 쓰는 호출부는 호환을 유지한다.
3. **신규 테이블 `entry_checks_us`** (anon SELECT)
   ```
   symbol, check_date(US 거래일),
   m1_pass, m1_detail  -- rev_yoy[t,t-1], op_yoy[t,t-1](op 없으면 eps_yoy 대체 표시), op>0,
                       -- ttm_rev_growth, ttm_op_growth(8개 분기 합산), rev_2y_stack 개선,
                       -- drawdown_from_post_earnings_high, drawdown_from_52w_high, range_20d, ret_20d,
                       -- price_state('PB'|'SW'|null)   ※ pri_us_lite는 JARVIS 계산
   m2_pass, m2_detail  -- MACD 정의는 Heimdallr와 동일
   m5_pass, m5_detail  -- 매집일 대용: 종가 상승 & 거래량 ≥ 20일 평균, 2일 연속 (label '수급 대용(미국)')
   invalidation_price, low_10d, low_20d, computed_at
   PRIMARY KEY (symbol, check_date)
   ```
   - 대상: watchlist 미국 종목 + 최근 90일 딥분석의 미국 수혜주
   - 새 워크플로를 **06:40 KST**(미국 정규장 마감 후)에 둔다. 이미 성공했으면 종료(멱등)한다.
4. **🔵 H1 미국 실적 돌파**
   - 대상: F1(EPS 서프라이즈 ≥ +3%) & F2(가이던스 > 컨센)
   - D0 조건: 갭 ≥ +4%(시총 $200B+는 +3%) & 거래량 ≥ 20일 평균×2 & 종가위치 ≥ 0.7
   - 기록: `technical_ideas`(setup='H1', role='announcer'|'beneficiary'). 진입 신호 아님.
5. **한국 수혜주 처리 변경**
   - `idea_scanner`의 한국 수혜주 기술적 판정·텔레그램은 플래그 `KR_TECH_IDEAS_TELEGRAM`(기본 true, 병행 2주 후 false)로 끌 수 있게 한다.
   - 대신 신규 테이블 `catalyst_watch`(anon SELECT)에 캐치업 후보를 기록한다.
     - 조건: final 딥분석의 한국 수혜주, strength ≥ 7, 이벤트 후 10거래일 이내, 대장주 반응 ≥ +6%, 수혜주 반응 ≤ 대장주의 1/3
     - 컬럼: leader_symbol, event_date, beneficiary_code, leader_ret, bene_ret, gap, strength, rationale, triggers_timeline, expires_at
   - 한국 종목 기술적 판정은 Heimdallr `entry_checks`로 일원화한다.
6. **§10 FlyWheel 주간 섹션**(미구현)은 **취소**한다(JARVIS 인박스·주간 투자위원회로 대체). PRD에 기록한다.
7. **triggers_timeline**: 각 항목에 가능하면 `expected_by`(ISO 날짜)를 함께 저장한다(JARVIS M4 정확도). 기존 `1Q_내` 등 키는 유지한다.
8. anon SELECT 확인: `analyses`, `beneficiaries`, `quarterly_metrics`, `earnings_events`, `technical_ideas`, `entry_checks_us`, `catalyst_watch`.

---

## D. Compounding FlyWheel (Claude Code) — P2

1. **인박스는 코드 변경이 필요 없다.** STEP2가 Idea_Generating `created_time` 창으로 모든 행을 처리한다. 다만 `[HermesCall]`·`[Heimdallr]`·`[Sage]` 접두어 행은 Haiku 요약 없이 들어온다. `핵심 내용`이 비어 있어도 본문 원문으로 분석하는지 확인하고, 필요하면 1줄 보완한다.
2. **포지션 명령 폐기**: `/매수`·`/매도`·`/포지션`·`/종목등록`은 "SnowBall Heritage에서 입력합니다: https://snowball-heritage.vercel.app/ironman/portfolio"로 응답한다. `state/positions.json`은 보관만 하고 읽지 않는다.
3. **position_impact 입력 교체**: `load_positions()` 대신 JARVIS `GET /api/public/holdings-lite`(헤더 `X-Jarvis-Token`)를 읽는다. 금액 없이 entity·이름·L1·비중 구간만 쓴다. 실패 시 해당 단계만 건너뛴다.
4. **산업**: 변경 없음. 노션에 `[산업] 자율주행차`(1l)·금융(2f)·건설(2g) 페이지를 만들면 `industries.json`에 추가한다(모니터링 DB 포함, Phase 0 탐색 스크립트 재사용).
5. 주간 리포트는 토 08:00 유지. 제목 형식(주차 포함)을 고정한다.
6. `signal_lessons.txt`: JARVIS 분기 성적표의 "가격 기반 교훈"은 사용자가 수동 반영한다.

---

## E. Sage (Claude Code) — P1

1. **SECTORS 교체**: `collector/config.py`의 `SECTORS`를 노션 L1 18개 + `MACRO`(거시경제) + `기타`로 바꾼다. 분석 프롬프트의 섹터 목록도 교체한다.
2. **기존 데이터 치환**: `mentions`(mention_type='sector') 값을 마이그레이션으로 바꾸고 원본 보존 컬럼을 추가한다.
   - `자동차·로봇` → 두 행으로 분리(`자율주행차`, `Robot`)
   - `전력·에너지` → `전력인프라`
   - `뷰티` → `화장품_미용기기`
   - `플랫폼` → `IT`
   - `부동산` → `건설`
   - `거시경제` → `MACRO`
3. **스케줄 이동**: `.github/workflows/strategy.yml` cron을 `0 23 * * 5`(토 08:00)에서 `0 9 * * 5`(**금 18:00 KST**)로 바꾼다.
4. 대시보드 검색 파라미터 `?q=`·`?date=`는 JARVIS 링크가 사용한다. 이름을 바꾸지 않는다.
5. anon SELECT 확인: `mentions`, `mentor_scorecards`, `strategy_reports`, `mentors`. 불가하면 읽기 전용 RPC를 제공한다.
