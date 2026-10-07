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
13. **섹터 오분류 정정(2026-09-30 JARVIS 점검)**: `krx_universe.sector='유통·소비재'`(74종목)에 소비재가 아닌 종목이 섞여 있다 — 기초 화학물질 제조업(국도화학·후성·이수화학·유니드), 1차 철강(휴스틸), 석유 정제(한국쉘석유), 통신(LG유플러스), 방송(CJ ENM), 바이오(HLB테라퓨틱스), 의료로봇(큐렉소) 등. KSIC `industry` 와 교차 검증해 `화학·소재`·`철강·금속` 등 알맞은 섹터로 옮긴다. JARVIS 는 이 섹터로 L1 을 정하므로(국도화학 → 소비재 → FlyWheel 음식료 흐름이 매수 근거로 붙음) 결과가 바로 달라진다.
14. **분석 출력 정리**: `analyses.payload.risks` 에 `{"risk":"...","watch_metric":"..."}` 자리표시가 저장된 사례(제이아이테크 2026Q2), `one_line_thesis` 에 `[[F 218.8억]]`·`[[F announcement_return_pct -11.375]]` 사실 표식과 `[검증 불가 수치 삭제]` 가 남는 사례가 있다. 저장 전에 표식을 값으로 치환하거나 문장을 다시 쓰게 한다(JARVIS 는 표시할 때 흔적만 지운다).

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

---

## F. 정시 실행 (Heimdallr · HermesCall) — P3 운영 개선 (2026-10-02 JARVIS 실측)

- **문제**: Heimdallr `daily_digest`(17:37·18:17·19:07, entry_checks 포함)와 HermesCall `entry_checks_us`(06:40)가 GitHub schedule 에 의존 → 10/1 17:37 실행이 00:37 에 시작(7시간 지연), entry_checks_us 첫 예약 실행 누락. JARVIS 는 원천 지연이면 🟢 를 만들지 않으므로(D50) 신호가 하루 늦어진다.
- **권장**: JARVIS D7 과 같은 방식 — 각 프로젝트 Supabase pg_cron → GitHub `workflow_dispatch` 정시 호출(Vault 토큰), 기존 schedule 은 예비로 유지, 잡은 멱등(이미 성공한 날이면 즉시 종료).
- **D10**: JARVIS 🟢 병행 2주(~2026-10-16) 후 Heimdallr `TECHNICAL_TELEGRAM_ENABLED=False`, HermesCall `KR_TECH_IDEAS_TELEGRAM=false` 로 원 프로젝트 기술적 알림 텔레그램만 중단(DB 기록 유지) — 사용자 결정.

---

## G. Heimdallr Call (Codex) — 🔎 JARVIS 분석 버튼 · 미국 종목 · 드라이브 자동 생성 · 🎤 발표자료 (D59, 2026-10-05 사용자 결정)

**목적**: JARVIS 텔레그램(@Tonny_JARVIS_bot) 🎯 추천 종목의 `🏭 산업`·`🏢 기업` 버튼 한 번으로 Heimdallr Kairos 심층 분석을 노션에 만들고, 기업 분석이 끝나면 `🎤 발표자료` 버튼으로 Claude Code `kairos-deck` 스킬이 양식 PPT를 만들어 노션·드라이브에 저장한다. 사람 확인 단계 없이 끝까지 돈다.
**사용자 결정**: ① 미국 종목도 Heimdallr 분석 대상 ② 재사용 — 기업은 30일 이내이면서 그 사이 실적 발표가 없을 때, 산업은 30일 이내면 다시 돌리지 않고 기존 노션 링크 ③ PPT는 기업 분석 완료 후 별도 🎤 버튼.
**JARVIS 쪽(완료)**: 버튼·콜백·장부(`jarvis.analysis_requests`)·30분 상태 확인·알림. 호출 계약은 JARVIS `lib/ingest/heimdallr.ts` 의 `requestAnalysis`·`analysisStatus`·`requestDeck` 와 1:1. JARVIS 는 분석을 만들지 않고 요청·상태·노션 링크만 다룬다.

### G-1. 스키마 (`docs/migrations/kairos_jarvis.sql`, 재실행 안전)
- `kairos_requests` 추가 컬럼: `source text not null default 'telegram' check (source in ('telegram','jarvis'))`, `market text not null default 'KR' check (market in ('KR','US'))`, `ticker text`, `stage text`, `stage_updated_at timestamptz`, `reuse_after timestamptz`.
- JARVIS 요청의 `update_id` 는 텔레그램 ID 와 겹치지 않게 음수 시퀀스(`create sequence kairos_jarvis_seq increment -1 start -1`), `chat_id`·`user_id` 는 0.
- `kairos_requests_target_shape_check` 교체: 기업 = `company_name is not null and ((market='KR' and code is not null) or (market='US' and ticker is not null))`, 산업 = 기존과 같음. 미국 종목은 `code`(krx_universe FK)를 비운다.
- 새 테이블 `kairos_deck_requests`: `id bigserial pk`, `request_id bigint not null references kairos_requests(update_id)`, `status text check (status in ('pending','working','sent','failed'))`, `notion_url`, `drive_dir`, `files jsonb`, `error`, `attempts int default 0`, `created_at`, `claimed_at`, `completed_at`. `request_id` 당 열린(pending·working·sent) 행은 1개(부분 unique index). RLS 켜고 anon 권한 없음.
- 토큰: Vault `heimdallr_jarvis_token`(값은 JARVIS Vercel env `HEIMDALLR_JARVIS_TOKEN` 과 동일). `_jarvis_ok(p_token)` = Vault 값과 상수 시간 비교.

### G-2. RPC 3개 (security definer, `grant execute … to anon`, 토큰 불일치면 `raise exception 'unauthorized'`)
1. `jarvis_request_analysis(p_token text, p_payload jsonb) returns jsonb`
   - 입력: `{kind:'company'|'industry', target_name, market:'KR'|'US'|null, code, industry, reuse_after}` (기업 `code` = 국내 6자리 또는 미국 티커, `industry` = JARVIS 산업명).
   - 순서: ① 같은 대상(기업 = market+code/ticker, 산업 = G-4 매핑 후 폴더명)에 `pending·working·awaiting_input·sending` 이 있으면 `{status:'in_progress', request_id}` ② `status='sent' and completed_at >= reuse_after` 인 최신 행이 있으면 `{status:'reused', request_id, notion_url, completed_at}` ③ 대상 확인 실패(국내 코드 미등록·미국 티커 미확인·산업 매핑 불가가 아닌 빈 이름)면 `{status:'rejected', reason}` ④ 열린 JARVIS 요청이 6건 이상이면 `{status:'rejected', reason:'대기 6건 초과 — Codex 사용량 보호'}` ⑤ 아니면 `source='jarvis'` 행 insert → `{status:'queued', request_id}`.
2. `jarvis_analysis_status(p_token text, p_request_ids bigint[]) returns jsonb` — 배열 `[{request_id, status, stage, notion_url, error, completed_at, deck:{status, notion_url, error} | null}]`. `deck` 은 그 요청의 최신 `kairos_deck_requests` 행.
3. `jarvis_request_deck(p_token text, p_request_id bigint) returns jsonb` — 기업 요청이고 `status='sent'` 일 때만. 열린 deck 이 있으면 `{status:'in_progress'}`, 완료본이 있으면 `{status:'sent', notion_url}`, `failed` 뿐이면 새 행. 그 외 `{status:'rejected', reason}`. 새로 만들면 `{status:'queued'}`.

### G-3. Kairos 처리 변경 (`source='jarvis'`)
- 수집기가 `pending` 을 로컬 큐로 가져오는 기존 경로를 그대로 쓴다(`codex queue`). 텔레그램 접수·진행·완료 메시지는 **Heimdallr 봇으로 보내지 않는다** — JARVIS 가 30분마다 상태를 읽어 알린다. `progress` 는 `stage`·`stage_updated_at` 을 DB 에 쓰고, `deliver` 는 노션 재조회 검증 후 `status='sent'`·`notion_url`·`completed_at` 만 기록, `fail` 은 `status='failed'`·`error` 코드.
- **`awaiting_input` 금지**: JARVIS 요청은 산업 폴더 확인 질문을 하지 않는다. G-4 매핑으로 정하고, 없으면 새로 만든다.

### G-4. 산업명 → 드라이브 산업 폴더 (`config/industry_folders.yaml`, 텔레그램 요청에도 우선 적용)
드라이브 루트 `G:\내 드라이브\1. 주식 자본\2. 아이언맨의 투자 분석\1. 산업분석\` (2026-10-05 실측 18개 폴더). JARVIS 산업명(= JARVIS `config/taxonomy.yaml` L1 이름 또는 산업 성장 그룹명)을 아래처럼 짝 짓는다. 사용자가 고칠 수 있게 yaml 로 둔다.
| JARVIS 산업명 | 드라이브 폴더 |
|---|---|
| AI · 반도체 | `1. AI 반도체` |
| 바이오 | `2. 바이오` |
| 엔터 | `3. K-엔터` |
| 화장품_미용기기 | `15. 화장품` (미용기기 종목이면 `4. 미용_의료기기`) |
| 헬스케어(의료기기) | `4. 미용_의료기기` |
| 전력인프라 | `5. 전력인프라` |
| IT | `6. IT` (디스플레이 종목이면 `8. OLED`, 네트워크 종목이면 `17. 네트워크`) |
| 우주항공방산 | `7. 우주항공` |
| 소비재(음식료) | `9. 음식료` (의류 종목이면 `13. 의류`) |
| Robot | `10. 로봇` |
| 건설 | `11. 건설` |
| 조선 | `12. 조선` |
| 자율주행차 | `14. 자율주행차` |
| 2차 전지 | `16. 2차 전지` |
| ETF | `18. ETF` |
| 양자컴퓨터 · 여행 · 금융 · 그 외 | 없음 → 새 폴더 `<가장 큰 번호+1>. <산업명>` 생성 |
- 숫자 접두어·공백·밑줄·하이픈 정규화 일치도 허용(ADR 21). 새로 만든 폴더는 yaml 에 자동 추가하고 실행 장부에 남긴다.

### G-5. 드라이브 자동 생성·자료 저장 (`src/collectors/drive_bootstrap.py`, LLM 없음, `claim` 직후·Kairos 전에 실행)
- **기업 폴더**: 국내 `…\2. 기업분석\국내\<정식 기업명>\`, 미국 `…\2. 기업분석\해외\<TICKER>\`(예전 방식 `해외\YYMMDD_<TICKER>.pdf` 파일도 자료로 인정).
  - 폴더가 있고 분석일 기준 3개월 이내 자료가 있으면 → 내려받지 않고 그 최신 자료를 쓴다(기존 ADR 21).
  - 폴더가 없거나 3개월 이내 자료가 없으면 → 폴더를 만들고 아래를 저장: 파일명 `YYMMDD_<기업명>_<보고서명>.<확장자>`(YYMMDD = 공시 접수일), 이미 있으면 건너뜀.
    - 국내: OpenDART(기존 `OPENDART_API_KEY`, 기존 `src/universe/corp_code.py`·`src/collectors/dart_*` 재사용) `list.json` 정기공시(`pblntf_ty=A`) **최근 4건(사업·반기·분기보고서)** PDF + "기업설명회(IR)개최" 공시의 **최근 4개 분기 IR 자료** 첨부 PDF. DART 웹 PDF 는 1초 1건 이하로 받는다.
    - 미국: SEC EDGAR(새 환경변수 `SEC_USER_AGENT` 필수 — `.env.txt` 에 `Heimdallr/1.0 (본인 이메일)` 형식, `.env.example` 에 이름만 추가) submissions JSON → **최근 4건 10-K·10-Q** 본문 + 최근 4개 분기 8-K(Item 2.02)의 EX-99.1(실적 발표)·EX-99.2 등 IR 프레젠테이션.
    - IR 자료를 공시에 올리지 않는 회사는 "IR 자료 없음"으로 기록하고 계속한다. 다운로드 실패는 분석을 막지 않는다.
- **산업 폴더**: G-4 로 못 찾으면 새 폴더 + 날짜 하위 폴더(`YYMMDD`)를 만든다. 산업 공통 자료는 자동으로 받지 않는다(표준 소스 없음) — Kairos 가 실제로 읽은 산업 원문 PDF 가 있으면 그 하위 폴더에 저장한다.
- 드라이브는 이 PC 의 Google Drive for Desktop(`G:\`)에 파일로 쓴다(동기화는 앱이 한다). 실행 결과(만든 폴더·받은 파일·실패)를 체크포인트 장부에 남긴다.

### G-6. 미국 종목 (텔레그램 직접 입력 포함)
- 대상 해석: 티커·영문/한글 회사명 → SEC `company_tickers.json`(하루 캐시) + JARVIS 가 넘긴 `market='US'`·티커. 모호하면 기존처럼 거절.
- 노션 기업 페이지 제목 `기업명 (TICKER·NASDAQ|NYSE)`, Kairos 자료 = SEC 공시·IR·실적 발표·증권사·네이버증권 해외 링크(확인된 경우만, ADR 22).

### G-7. 🎤 발표자료 실행기 (`telegram_bridge/deck_runner.py`, 수집기와 같은 1분 예약 작업)
- `kairos_deck_requests` 의 `pending` 1건만 집어 `working` 으로 바꾸고(동시에 1건), 이 PC 의 Claude Code 를 화면 없이 실행:
  ```
  claude -p "/kairos-deck <company_name> --code <code|ticker> --market <KR|US> --analysis <notion_url> --request-id D<id>" ^
    --allowedTools "Bash,Read,Write,Edit,Glob,Grep,WebSearch,WebFetch" --permission-mode acceptEdits --output-format json
  ```
  작업 폴더 `C:\Users\user\.claude\skills\kairos-deck`, 제한 120분. 스킬 위치 `~/.claude/skills/kairos-deck/SKILL.md`(이미 설치됨: 양식 20장 채우기·PDF 변환·노션 첨부 스크립트 포함).
- 결과: 마지막 줄 JSON(또는 `work/*/result.json`) `{"status":"ok","notion_url",…}` → `sent`·`notion_url`·`drive_dir`·`files`, `{"status":"failed","reason"}` → `failed`·`error`. 사용량 한도 메시지면 `pending` 으로 되돌리고 30분 뒤 재시도(`attempts` 3회 초과 시 `failed: USAGE`).
- 조건: Claude Code CLI 로그인(구독) 상태 — API 키 불필요. PC 켜짐·로그인·절전 아님(기존 Kairos 와 같음). PowerPoint 설치(PDF 변환).

### G-8. 검증
1. SQL Editor: 잘못된 토큰 → `unauthorized`. 올바른 토큰으로 `jarvis_request_analysis` 를 같은 대상 2회 → `queued` → `in_progress`. `status='sent'`·`completed_at` 이 `reuse_after` 이후인 행 → `reused`.
2. 사용자가 JARVIS 브리핑의 `🏢` 버튼 1회 → Heimdallr 로컬 큐 → 노션 작성 → 30분 안에 JARVIS 에 "✅ 기업 분석 완료" + `🎤`. `🎤` → `kairos_deck_requests` → 노션 기업 페이지에 PDF·PPTX, 드라이브 기업 폴더에 3개 파일.
3. 드라이브 기업 폴더가 없던 종목 1건: 폴더 생성 + 정기보고서 4건(국내) 또는 10-K/10-Q 4건(미국) 저장 확인.
4. 시험용 노션 페이지를 만들지 않는다(기존 규칙) — 2·3은 실제 요청으로 확인한다.

---

## H. Heimdallr Call (Codex) — 🧠 Codex 완료 후 Claude 심층 분석 자동 실행 (D60, 2026-10-05 사용자 결정)

**목적**: Codex(Kairos)가 노션 분석을 끝내면(`status='sent'`) **자동으로** 이 PC 의 Claude Code `kairos-deck` 스킬 **analysis 모드**를 실행해, Codex 노션 분석 + Codex 가 그 요청에 실제로 쓴 자료(체크포인트 장부·`state/sources/<ID>`) + 드라이브 + 웹 검색으로 심층 분석(사용자 지침 1단계·2단계)을 노션 `🧠 … Claude 심층 분석` 페이지(Codex 분석과 같은 🏢/🏭 페이지 아래)와 드라이브 `.md` 로 남긴다. 🎤 발표자료(deck 모드)는 사용자가 JARVIS 에서 고를 때만, **🧠 분석을 바탕으로** 만든다.
**JARVIS 쪽(완료)**: `jarvis_analysis_status` 응답의 `claude` 필드를 읽어 "✅ Codex 완료 → 🧠 진행 중" → "🧠 완료 + [📝 Codex][🧠 Claude][🎤]"(산업은 🎤 대신 Claude 가 고른 최고 기업 `🏢` 버튼) 순서로 알린다. 계약은 JARVIS `lib/ingest/heimdallr.ts` 의 `ClaudeJob`·`AnalysisStatus.claude`·`AnalysisRequestResult.claude`.
**스킬(완료)**: `~/.claude/skills/kairos-deck/SKILL.md` — `--mode analysis|deck` 입력·결과 JSON 이 아래 H-3 과 1:1. 노션 읽기·쓰기 스크립트 `scripts/notion_md.py`(Codex 페이지 읽기, 같은 부모에 🧠 페이지 발행·재실행 시 덮어쓰기).

### H-1. 스키마 (`docs/migrations/kairos_claude.sql`, 재실행 안전)
- `kairos_deck_requests` 에 `mode text not null default 'deck' check (mode in ('analysis','deck'))`, `analysis_md text`, `top_pick jsonb` 추가. 기존 행은 `deck`.
- 열린 작업 유일 인덱스를 `(request_id, mode)` 기준으로 바꾼다(`status in ('pending','working','sent')`). 동시에 1개만 도는 `kairos_deck_single_worker_idx` 는 그대로 — analysis·deck 이 같은 Claude 를 하나씩 쓴다.
- **자동 생성 트리거**: `kairos_requests` 가 `status` 를 `'sent'` 로 바꾸는 순간(이전 값 ≠ `'sent'`) `source='jarvis'` 이면 `kairos_deck_requests(request_id, mode='analysis')` 를 `on conflict do nothing` 으로 넣는다. deliver 와 같은 트랜잭션이라 JARVIS 가 "Codex 완료" 를 볼 때 🧠 작업이 이미 있다(경합 없음). 텔레그램 직접 요청은 지금처럼 Codex 분석만 한다.
- `kairos_claim_deck()`: 같은 요청의 `analysis` 가 `pending·working` 이면 그 요청의 `deck` 은 집지 않는다(🧠 먼저). 나머지는 생성 순서. 반환 JSON 에 `mode` 포함.

### H-2. RPC 응답 추가 (기존 계약 유지, 필드만 추가)
- `jarvis_analysis_status`: 각 항목에 `claude: {status, notion_url, error, top_pick} | null`(그 요청의 최신 `mode='analysis'` 행). 기존 `deck` 은 최신 `mode='deck'` 행으로 한정.
- `jarvis_request_analysis` 의 `reused` 응답에 같은 형식의 `claude` 추가(재사용 분석의 🧠 상태·링크).
- `jarvis_request_deck`: 지금처럼 `company`·`sent` 일 때만. `mode='deck'` 행만 대상으로 dedupe. 🧠 가 진행 중이어도 접수(`queued`)하되 실행은 H-1 claim 규칙대로 🧠 다음.

### H-3. 실행기 (`telegram_bridge/deck_runner.py`) — mode 별 프롬프트·검증
- **analysis** (`request_id = A<id>`, 제한 90분):
  ```
  /kairos-deck --mode analysis --kind <request_kind> "<target_name>" [--code <code|ticker> --market <KR|US>]
    --codex "<kairos_requests.notion_url>" --ledger "<절대경로 state\checkpoints\<로컬 작업 ID>.md>"
    --sources "<절대경로 state\sources\<로컬 작업 ID>>" --drive-dir "<기업 폴더 또는 G-4 산업 폴더>" --request-id A<id>
  ```
  체크포인트·sources 경로는 `telegram_bridge/bridge.py checkpoint_path()` 와 같은 규칙(로컬 작업 ID). 없으면 그 옵션만 뺀다.
  성공 검증: `notion_url` 이 노션 URL, `files` 에 `.md` 1개 이상이 `drive_dir` 안에 실제 존재, `analysis_md` 가 존재하는 절대경로. 저장: `status='sent'`, `notion_url`, `drive_dir`, `files`, `analysis_md`, `top_pick`(산업만).
- **deck** (`request_id = D<id>`, 제한 120분): 같은 요청의 `mode='analysis'` 최신 `sent` 행이 있으면 `--analysis-md <그 analysis_md> --claude-notion <그 notion_url>` 를 넘기고, 없거나 `failed` 면 빼고 넘긴다(스킬이 분석부터 한다). 나머지 옵션·검증(pptx·pdf·md)은 지금과 같다.
- 결과 파일 매칭(`result_file`)은 `A<id>`/`D<id>` 를 구분한다. 사용량 한도 재시도·타임아웃·단일 실행 규칙은 그대로.

### H-4. 검증
1. SQL: JARVIS 요청 1건을 `sent` 로 바꾸는 시험은 하지 않는다(실데이터). 트리거 정의·인덱스·RPC 응답 형태는 `\d`·함수 소스로 확인하고, 잘못된 토큰 `unauthorized` 를 다시 확인.
2. 실제 흐름: JARVIS 🏢 1회 → Codex 노션 → 30분 안에 JARVIS "✅ (Codex) 완료 · 🧠 진행 중" → Claude 🧠 노션 페이지(Codex 분석과 같은 기업 페이지 아래)·드라이브 `YYMMDD_<기업>_Claude_심층분석.md` → JARVIS "🧠 완료 + 🎤" → 🎤 → PPT·PDF.
3. 산업 1회: 🧠 결과의 `top_pick` 이 JARVIS 알림의 `🏢 <기업> 기업 분석` 버튼으로 나오는지.
4. 시험용 노션 페이지를 만들지 않는다 — 2·3 은 실제 요청으로 확인한다.

---

## I. Codex Kairos 자료 범위 추가 — 노션 2_1. 산업 & 종목 · 2. Invest_WiKi (D61, 2026-10-06 사용자 결정)

**대상**: Codex 사용자 스킬 `C:\Users\user\.codex\skills\kairos\` (`SKILL.md` 조사 단계 2, `references/source-policy.md`). Heimdallr 저장소 문서(`telegram_bridge/WORKFLOW.md`, `docs/PRD.md` §8.7)의 자료 목록도 같이 고친다.
**목적**: Codex(1차 분석)와 Claude(🧠 심층 분석, `~/.claude/skills/kairos-deck` — 이미 반영됨)가 **같은 노션 참고 자료**를 같은 3개월 규칙으로 철저히 읽는다.

1. **참고 루트 추가** (기존 SnowBall Heritage·1. 기업 투자 분석·2. 산업 투자 분석에 더해):
   - `2_1. 산업 & 종목` https://app.notion.com/p/36a9c770aa61809c95e5c1117f9779b5 — L1 산업별 데이터베이스(1a. AI, 1b. 반도체 …)와 일부 페이지(1l. 자율주행차 등). 대상 산업의 데이터베이스 전체 + 모든 산업 데이터베이스에서 제목에 대상 기업명·티커·핵심 제품이 들어간 글.
   - `2. Invest_WiKi` 데이터베이스 https://app.notion.com/p/3999c770aa6180ecb514e74eb998e127 (2_4. Compounding_FlyWheel 아래) — `제목`·`관련 산업`·`수혜 기업`·`핵심 내용`·`Insight` 에 대상어가 들어간 글.
2. **3개월 규칙 — 내용 날짜로 판단**: 날짜 속성(`날짜`) → 제목 속 날짜(YYYY-MM-DD·YYYYMMDD·YYMMDD, 달력 검증) → 생성일 순. **마지막 수정일은 쓰지 않는다**(2026-07-10 일괄 수정으로 2021년 글 `반도체 동향_210322` 이 최근 수정으로 보이는 실측). `[산업] …` 허브 페이지는 본문 중 날짜가 3개월 이내인 항목만 쓴다. 3개월 밖 글은 현재 판단 근거로 쓰지 않는다(변화 비교용 언급만).
3. **기록**: 사용한 글마다 제목·노션 링크·내용 날짜·판단 기준을 체크포인트 장부에 남긴다(🧠 Claude 단계가 그대로 읽는다). 핵심 수치는 기존처럼 1차 출처로 재검증.
4. ✅ **(2026-10-06 완료 — 하지 않는다)** SnowBall Heritage 노션 페이지(앱 개발 요청 메모)는 Codex 스킬 3개 파일·WORKFLOW.md·PRD.md 의 참고 루트에서 빼고 "분석 근거로 조회하지 않는다" 규칙을 넣었다(Heimdallr c87178c). 페이지의 평문 토큰도 지웠다. 투자 논지·훼손조건은 JARVIS `GET /api/public/stock-context?entity=KR:005930`(헤더 `X-Jarvis-Token`).
5. **텔레그램 리서치 세션**: `python -m src.collectors.telegram_sources status` 가 현재 `not_configured`(2026-10-06 실측) — Codex·Claude 모두 채널을 직접 검색하지 못한다. 사용자가 `TELEGRAM_RESEARCH_API_ID/HASH` 를 `.env.txt` 에 넣고 `auth` 1회를 하면 둘 다 쓴다(값을 채팅에 붙여 넣지 않는다).
6. 검증: 스킬 문서만 바꾸는 작업이므로 시험 분석·시험 노션 페이지를 만들지 않는다. 다음 실제 요청의 체크포인트에 2_1·Invest_WiKi 사용 기록이 남는지로 확인한다.

---

## J. Heimdallr Kairos 무인 자동 처리 — Codex 대화를 열지 않아도 분석이 시작되게 (D62, 2026-10-07)

**문제(10/7 실측)**: JARVIS 🏢 유니트론텍 요청(-1)이 21:26 접수 → 수집기가 `codex queue --thread 01a0d886…`로 21:27·21:33·21:39 깨움(오류 없음) → **Codex 가 시작하지 않음**. `~/.codex/queue_1.sqlite` 에 그 대화 앞으로 메시지 3개가 쌓여 있고, 9/26 요청(893060870) 메시지도 다른 대화(`01a0b3d1…`)에 그대로 남아 있다. 큐 메시지는 **그 대화가 앱에서 열려 있을 때만** 전달된다. 또 트리거 대화 "텔레그램 기업·산업 분석 자동화"는 기록이 **135MB** 로 비대하다.
**확인한 제약**: 화면 없는 `codex exec` 는 `$kairos` 스킬은 보이지만 **Notion·Google Drive 커넥터가 없다**(10/7 진단) → Kairos 의 노션 양식 작성·검증을 할 수 없으므로 exec 전환은 쓰지 않는다. 커넥터가 있는 **Codex 앱의 heartbeat 자동화**로 해결한다.

### J-1. 전용 경량 대화
- 프로젝트 `C:\Codex\Heimdallr_Call_Codex` 에 새 대화 **"Kairos 자동 분석 전용"** 을 만든다(기존 135MB 대화는 보관만, 더는 트리거로 쓰지 않음).
- `python -m telegram_bridge.bridge configure-trigger --thread <새 대화 ID>` — 대기 중 요청의 깨우기 기록이 초기화되어 새 대화로 다시 보내진다. `poll` 의 `trigger_thread` 로 확인.

### J-2. 접수 heartbeat 자동화 (상시 ACTIVE)
- 새 heartbeat `kairos-intake`, 대상 = J-1 대화, **15분 간격, 07:00~24:00 KST**(브리핑 07:30·19:20 뒤 사용 구간). 기존 `kairos`(사용량 회복 재개)의 역할도 흡수해 하나로 운영하고, 기존 `kairos` 는 PAUSED 유지 또는 정리.
- 프롬프트 요지(그대로 구현):
  1. `.\.venv\Scripts\python.exe -X utf8 -m telegram_bridge.bridge poll` **한 번만** 실행.
  2. `pending`·`working` 이 모두 없으면 **다른 도구를 쓰지 말고 조용히 종료**(알림 없음).
  3. `working` 이 있으면 기존 재개 규칙(사용량 10% 이상일 때 같은 장부로 이어서 완료)을 따른다.
  4. `working` 이 없고 `pending` 이 있으면 가장 오래된 **1건만** `claim` → `$kairos` 를 WORKFLOW.md 그대로 끝까지(노션 작성·재조회 검증·`deliver` / `fail`). 한 번에 1건, 나머지는 다음 실행.
  5. 사용량이 부족하면 `pending` 그대로 두고 종료(다음 실행에서 재확인).
  6. 텔레그램 리서치는 쓰지 않는다(사용자 결정 10/7). JARVIS 요청(`source='jarvis'`)은 Heimdallr 봇 메시지를 보내지 않는 기존 규칙 유지.
- **유휴 비용 측정**: 빈 실행 1회의 토큰을 기록한다. 2만 토큰을 넘으면 간격을 30분으로 늘린다.

### J-3. (선택·조사) 유휴 비용 0 으로
- 수집기(`bridge ingest`)가 `pending` 이 생길 때 `~/.codex/automations/kairos-intake/automation.toml` 의 `status` 를 `ACTIVE`, 큐가 비면 `PAUSED` 로 바꾸는 방식이 **앱에 실제로 반영되는지** 1회 실측한다(앱이 파일 변경을 읽는지). 반영되면 적용하고, 아니면 J-2 상시 ACTIVE 유지. 앱 내부 sqlite(`queue_1.sqlite` 등)는 직접 수정하지 않는다.

### J-4. 지금 걸린 요청 처리와 검증
- 설정 직후 **요청 -1(유니트론텍, JARVIS)** 이 사람 개입 없이 다음 heartbeat 에서 `claim` 되는지 확인 → 노션 작성 → `sent` → (H 트리거) 🧠 Claude 작업 생성 → JARVIS 알림까지 이어지는지 확인한다. 사용자가 대화를 열지 않은 상태로 검증한다.
- `telegram_bridge/WORKFLOW.md`·`JARVIS.md`·AGENTS 에 "트리거 대화를 열어 둘 필요 없음, heartbeat 가 접수" 로 갱신하고 세션 기록·ADR 을 남긴 뒤 커밋·push.
