# JARVIS 결정 기록

| ID | 날짜 | 결정 | 근거 |
|---|---|---|---|
| D1 | 2026-09-27 | 포트폴리오 원장 = SnowBall Heritage(member ironman). 구글 시트·FlyWheel positions.json 폐기 | 사용자 지정. 이중 장부 불일치 실측 |
| D2 | 2026-09-27 | 산업 정본 = 노션 2_1 카테고리 18개(L1, `1l 자율주행차` 추가) + [산업] 페이지(L2) | 사용자 지정 |
| D3 | 2026-09-27 | 매핑 = 키워드 일부 겹침 + 오탐 가드. 에너지→전력인프라, 자동차→자율주행차, 그 외 미매칭→기타 | 사용자 지정 + 실측 오탐 |
| D4 | 2026-09-27 | Pull + 계약(SnowBall 토큰 RPC, anon SELECT 우선) | 회귀 위험 최소화 |
| D5 | 2026-09-27 | **A안 확정**: 별도 구글 계정의 새 Supabase 프로젝트 `jarvis`(서울). 스키마 SQL 은 전부 `supabase/migrations` 에 커밋, 재생성 불가 데이터는 주기 내보내기(D24) | 사용자 결정(KICKOFF 인계) |
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
| D20 | 2026-09-27 | JARVIS 테이블은 `jarvis` 스키마(PRD §13, `0001_jarvis_schema.sql`). RLS 전 테이블 ON, 읽기 authenticated·쓰기 service_role, anon 권한 없음. `entry_eval` 에 `level='green' → m1∧…∧m5` CHECK 제약을 둬 SC6 를 DB 에서도 이중 강제 | 불변 규칙 4. PostgREST 노출을 위해 대시보드 Exposed schemas 에 `jarvis` 추가 필요 |
| D21 | 2026-09-27 | pg_cron 스케줄은 Phase 별로 해당 잡이 구현된 뒤 마이그레이션으로 추가(P0 = `outlook_smoke` 일·수 04:00 KST 1개). 토큰은 Vault `jarvis_github_dispatch_token`, dispatch ref=`master` | 없는 잡 디스패치는 Actions 분만 소모 |
| D22 | 2026-09-27 | FlyWheel 연계종합 형식 고정(노션 AI 모니터링 DB 실측): 구분은 `날짜` 텍스트 둘째 줄(`"2026-09-26\n연계종합"`), `구분` select 는 비어 있음. `신호강도` = select `"1"`~`"5"`, 연계종합 행에만 값. L2별 모니터링 DB ID 17개는 `taxonomy.yaml > notion.flywheel_monitoring` 에 고정(FlyWheel `industries.json` 복사) | FlyWheel `src/notion_client.py` create_monitoring_row + 노션 실데이터(9/22~26 연계종합 4행 모두 신호강도 5) |
| D23 | 2026-09-27 | M3 ② 무료 소스: Bing News RSS 는 OR·괄호 묶음 쿼리에 0건 → 증권사별 단순 쿼리(`query_templates.bing_en`). GDELT 는 마침표 든 이름 대신 별칭(JPMorgan), 429 는 10·30·60초 백오프. 증권사 목록 페이지는 JS 렌더링이 많아(GS·BofA 링크 0) **sitemap lastmod 90일**을 주 경로로 고정. Wells Fargo 목록 URL 404 → `wellsfargo.com/cib/insights/`(sitemap lastmod 없음 → 본문 메타 날짜) | P0 로컬 실측(아래 P0 기록). Actions 실측은 push 후 추가 |
| D24 | 2026-09-27 | 재생성 불가 데이터(signal_ledger·outcomes·entry_eval·breakout_watch·industry_outlooks·weekly_memos·notifications·queue_items·taxonomy_labels/pending·inbox_log·cost_log)는 주 1회(일 23:30 KST) `pg_dump` → **private 백업 저장소** 커밋, 최근 12개 유지(`.github/workflows/backup.yml`). 공개 저장소·아티팩트에는 두지 않음 | D5 인계 + 불변 규칙 10. SnowBall backup.yml 과 동일 방식 |
| D25 | 2026-09-27 | SnowBall `jarvis_export_positions` 의 `market` 은 거래소 코드(KOSPI·KOSDAQ·NASDAQ·NYSE·OTHER)이고 `industry_l1` 필드는 없다 → JARVIS 가 KR/US 로 환산하고 `sector` 를 taxonomy 로 L1 매핑한다. 개별 종목 신호는 `asset_class='stock'` 만 | P0 실측(보유 49 = stock 37·etf 6·fund 6) |
| D26 | 2026-09-28 | `holdings_cache` 에는 SnowBall 보유의 **수량·평단·평가액을 저장하지 않는다**(`lib/entities.ts` HOLDING_KEEP 화이트리스트). 비중·허용비중·과열·논지 요약만 둔다 | 불변 규칙 1·10, SC7. H축·익절·보유 경고에 금액 불필요 |
| D27 | 2026-09-28 | 대시보드 읽기 권한을 **허용 이메일 1개**로 제한: `jarvis.allowed_users` + `jarvis.is_allowed()`(security definer) 정책(`0003`). 이메일은 저장소가 아닌 테이블에 `auth_setup` 잡으로 넣는다. middleware 도 ALLOWED_EMAIL 외 세션을 로그아웃 | Supabase 기본 설정은 anon 키로 누구나 가입 가능 → 0001 의 authenticated 전체 허용은 구멍. 공개 저장소에 이메일 미기재 |
| D28 | 2026-09-28 | 노션 `2_1` 변경 감지는 **ID 기준**(taxonomy.yaml `l1_urls`). 공개 API 의 child_database 제목은 화면 제목이 아니라 데이터 소스 이름(`1f. 엔터_미디어`, `1j. IT`)이라 제목 비교는 오탐 8건 → 참고(title_notes)로만 표시 | P1 실측(API 2022-06-28·2025-09-03 모두 동일) |
| D29 | 2026-09-28 | 네이버 미국 코드 해석 순서 `.O → .K → (접미사 없음)`, 응답 `reutersCode` 우선. TSM·MDT·IBM 은 접미사 없이만 200(HermesCall 이 "MDT 미수록"으로 본 사례 해결) | P1 실측 |
| D30 | 2026-09-28 | 링크 스모크 빈 화면 판정은 **`<title>` 안에서만**(본문 검사 금지), 리다이렉트 최대 5회 추적, 타임아웃 45초. 로그인 필요 규칙: StockEasy·Sage·SnowBall·JARVIS | Next.js 앱·StockEasy 정상 페이지 번들에 404 문구가 들어 있어 본문 검사 오탐 12건. 없는 종목은 HermesCall·StockEasy 가 404 상태로 응답. notion.so 는 2단계 리다이렉트 |
| D31 | 2026-09-29 | 대시보드 로그인을 **매직링크 → 이메일+비밀번호**로 변경. 비밀번호는 사용자가 PC PowerShell 에서 `npm run job -- set_password`(대화형·비표시 입력, Admin API)로 직접 설정. 세션 쿠키 유지로 같은 브라우저에선 재로그인 불필요. `/auth/callback` 제거 | 사용자 요청(매번 링크 번거로움) + 첫 시도 "링크 만료/잘못됨" — 메일 앱 내 브라우저 등 다른 브라우저로 열면 PKCE code_verifier 쿠키가 없어 교환 실패(추정). RLS·ALLOWED_EMAIL 보호는 그대로 |
| D32 | 2026-09-29 | **가벼운 잡(30분 폴링·브리핑)은 pg_cron → Vercel 라우트(`/api/cron/*`, CRON_SECRET)**, 무거운 수집(ingest·M3·M4·큐)은 pg_cron → Actions. Actions 에는 30분 뒤 예비 스케줄(같은 슬롯이면 건너뜀) | 30분 폴링을 Actions 로 돌리면 하루 48회 ≈ 월 1,400분 — private 저장소 무료 분(계정 공유) 소진. Vercel 호출은 GitHub 대기 지연도 없어 브리핑 정시성(SC8·P2 게이트)에 유리 |
| D33 | 2026-09-29 | 보유 경고: SnowBall 경보는 **동적 비중 critical + 드로다운 ≤ −20%**만, 드로다운은 **5%p 더 깊어질 때만** 재알림(종목·단계 dedupe), 그 외는 종목·규칙 7일 1회. 훼손 트리거(thesis_link=훼손·negative)는 신규·imminent 때. 첫 실행은 부트스트랩(발송 없이 기록) | P2 실측: 7일 경보 250건(drawdown/warn 215), 2일 창 후보 48건 → 주 1회 반복은 알림 피로(SC3). PRD §7.5 −20% 기준 |
| D34 | 2026-09-29 | M4: SnowBall 트리거는 expected_date 가 모두 비어 **expected_window 를 기간 끝으로 환산**(갱신일 + 0-1Q 91·1-2Q 182·2-4Q 365일, 4Q+ 제외). 국내 "실적+컨센 상향"은 Heimdallr consensus_snapshots 영업이익 추정 변화(45일 창) + 분기말+45일 예상일. **미국은 HermesCall 에 컨센 시계열이 없어 미계산** | P2 실측(트리거 96건 날짜 0건) |
| D35 | 2026-09-29 | FlyWheel 인박스의 "HermesCall 최종 딥분석" = **deep_analysis 가 있는 분석**(stage 값은 전부 `preliminary`) | P2 실측(60건 중 deep 46건, final 0건) |
| D36 | 2026-09-29 | M3 ② 수집 최적화: **등급 A·B 매체만 원문 수집**(Google News `<source url>` 로 해제 전 거름), Bing 은 산업별 첫 세그먼트만(증권사별 쿼리), 도메인별 직렬화 + 6개 동시. 처리한 URL 은 `outlook_seen`(120일) | 반도체 1개 L1 시험: 272초(Google 해제 건당 ~4초) → 최적화 후 전력인프라 115초. 18개 L1 전체 예상 30~40분 → Actions timeout 90분 |
| D37 | 2026-09-29 | M3 ② 영문 문장의 L1 판정 = taxonomy 키워드 + `segments_en/ko` **최장 일치**(예: "AI chips"→1b 가 "AI"→1a 보다 우선), 같은 길이 다른 L1 은 모호로 폐기. 비메이저 증권사 목록(`non_major_brokers`)으로 탈락 사유 구분. 범위 "20-25%"는 하한 선처리 | fixture 정탐 7·오탐 8·채택 7·집계 3 전부 통과. 첫 실채택: BofA 미국 반도체 CAGR 18%(~2030, finance.yahoo.com, B2) |
| D38 | 2026-09-29 | **표시 원칙**: 대시보드·텔레그램에서 약어(N·C·F·P·PRI·M3·M4·CAGR·YoY·등급 A/B·규칙 A1/B1/B2·L1 코드)를 쓰지 않고 쉬운 이름(`lib/labels.ts`)과 섹션별 한 줄 설명을 쓴다. 종목은 **결론 → 근거 → 링크(맨 끝 줄)** 순서(`lib/engine/explain.ts`, 텔레그램·대시보드 공용). 🎯 매수 검토 판정에는 MACD·RSI 가 들어가지 않는다(판정 = 실적 숫자 + 주가 반영도 40 미만 + 서로 다른 프로젝트 2곳 합의). MACD 교차 직전(M2)·수급(M5)은 🟢 필수 조건으로 P3 에서 Heimdallr·HermesCall `entry_checks` 로 적용. 그 전까지 Heimdallr 기술 셋업·시세 RSI, HermesCall 기술 아이디어를 **"기술적 참고(판정 미사용)"**로만 표시(파이프라인이 axes_daily.evidence.tech 에 저장, 화면은 DB 만 읽음) | 사용자 요청(가독성·MACD/RSI 반영 여부 확인) |
| D39 | 2026-09-30 | **보유 경고 텔레그램 일시 정지**: `bot_state.holding_alert_pause={paused:true}` 이면 폴링은 계속 계산·기록(payload.paused)하되 보내지 않는다. 텔레그램 `/alerts off·on`, `/status` 에 상태 표시. 정지 중 쌓인 경고는 재개해도 한꺼번에 보내지 않는다(새 경고부터). 브리핑 상단에 "⏸ 알림 정지 중" | 사용자 요청(논지 재작성 예정). 정지 동안 SC4(경고 지연 ≤ 35분) 측정 불가 → P2 판정에서 제외 기록 |
| D40 | 2026-09-30 | 폴링 최적화: 보유 종목만 조회 + 알림 중복 확인을 40개씩 묶음 조회(실패 시 "이미 보냄"으로 간주). 36~53초 → 약 2초 | Vercel 60초 제한으로 44회 중 6회 강제 종료 → 경고 지연 최대 50분 실측 |
| D41 | 2026-09-30 | 공개 API `/api/public/{taxonomy,holdings-lite,industry-heat,catalyst-watch}`(헤더 `X-Jarvis-Token`, 캐시 없음). holdings-lite 는 금액 없이 비중 구간(없음·<2%·2~5%·5~10%·≥10%)만 | FlyWheel·Heimdallr 연계(INTEGRATION_TASKS D-3·B-10). 불변 규칙 1·10 |
| D42 | 2026-09-30 | **브리핑 🎯 추천 재설계**: 브리핑마다 최대 5개. 순위 = 신호 합의 프로젝트 수 ↓ → 주가 반영도 ↑(낮을수록 먼저) → 산업 실제 성장률 ↓ → 가까운 이벤트(`lib/engine/idea.ts rankBuy`). 추천 시장(아침 미국·저녁 국내)을 먼저 채우고 모자라면 다른 시장으로 채움(07:30 은 국내 장 전). 카드 = 💡 투자 아이디어(원 프로젝트 분석 문장 인용: Heimdallr `one_line_thesis` → HermesCall 수혜 `investment_idea`, 출처·분기 표기) → 📈 매수 근거 ①실적(최근 2개 분기 전년 대비, 가속 여부) ②주가 반영도 ③산업 성장(실적 중앙값·미국 증권사·전망) ④신호 합의 → ⏰ 다음 확인 이벤트 2개 → ⚠️ 가장 큰 리스크+확인 지표 → 📊 기술적 참고(판정 미사용) → 🔗 링크. 파이프라인이 `axes_daily.evidence.idea` 에 저장하고 화면·브리핑은 DB 만 읽음. 긴 브리핑은 카드 경계에서 나눠 보냄. 그 밖의 큐(🔭⏳💰)는 이름만 요약 | 사용자 요청. JARVIS 는 LLM 을 부르지 않는다(불변 규칙 5) — 원 프로젝트 문장은 편집 흔적(`[검증 불가 수치 삭제]`·`[[F 값]]`)만 지우고 그대로 인용, 숫자는 원천 결정적 값만 |
| D43 | 2026-09-30 | 같은 날 파이프라인 재실행(07:12 → 19:10)에서 큐를 벗어난 종목의 오늘 `queue_items` 행은 삭제한다 | 실측: 19:10 재평가에서 🎯 를 벗어난 종목(솔브레인)이 브리핑·대시보드에 남음(🎯 8 표시, 실제 7) |
| D44 | 2026-09-30 | 🎯 추천 카드 매수 근거에 **⑤ 52주(250거래일) 최고 종가 대비 하락률 ⑥ 5일선·20일선 상태 ⑦ MACD·시그널 상태 ⑧ RSI(14) 수치·방향(3거래일 전 대비, ±1 이내 보합)** 추가. 상태 = 오늘 상향 통과 / 통과 직전 / 이미 위(며칠째) / 아래. "직전" 기준: 이동평균은 5일선이 20일선 아래 1.0% 이내 & 격차 2일 연속 축소(`rules.yaml tech_display`), MACD 는 🟢 M2 와 **같은 값**(`entry_core.M2_macd_pre_cross`: 히스토그램 2일 연속 개선 & 격차 ≤ 종가의 0.30% 또는 추정 교차 ≤ 3봉). 데이터 = Yahoo 일봉 1년(`lib/ingest/market.ts`), 국내 거래소 구분은 Heimdallr `krx_universe.symbol`. 계산 `lib/engine/technicals.ts`(순수 함수). **표시 전용 — 🎯·🟢 판정에 쓰지 않음**(카드에 "※ 참고용" 명시), 🟢 M2 는 P3 에서 원 프로젝트 `entry_checks` 값으로 판정(D13 유지). 이 지표가 있으면 원 프로젝트 기술 참고 줄은 생략 | 사용자 요청. 실측: 코스닥 종목을 `.KS` 로 조회하면 당일 봉이 빠진 시세가 옴(417500·417840) → 거래소 구분 필수 |
| D45 | 2026-09-30 | **Heimdallr 섹터 오분류 → 기타(ETC)**: `taxonomy.yaml heimdallr_sector_guard` — 섹터 `유통·소비재` 이면서 KSIC 업종(`krx_universe.industry`)에 화학·철강·석유·광물·비료·통신·방송·의약·의료용품이 들어 있으면 ETC 고정(`lib/entities.ts sectorMisfit`). SnowBall 섹터가 있는 종목은 SnowBall 우선. Heimdallr 가 B-13 을 고치면 목록을 비운다. 적용 결과: 국도화학·LG유플러스·CJ ENM·한국석유공업 등 → ETC, 국도화학은 🎯 에서 빠짐(FlyWheel 음식료 흐름이 더는 근거로 붙지 않음). KSIC 가 도·소매로 등록된 종목(HLB테라퓨틱스·큐렉소)은 이 규칙으로 못 거름 | 사용자 지정("기타로 처리") |
| D46 | 2026-10-01 | **FlyWheel 산업 흐름(L2 단위)은 해당 L2 종목에만**: `taxonomy.yaml narrative_l2_scope` 에 적힌 L2(현재 음식료)는 SnowBall 섹터(음식류) · Heimdallr 섹터(음식료) · KSIC 업종 단어(식품·식료품·음료·낙농·곡물·사료·담배) 중 하나라도 맞는 종목에만 N 신호로 붙인다(`lib/entities.ts l2Members`, `lib/engine/axes.ts`). 목록에 없는 L2 는 기존대로 L1 전체. 미국 종목은 섹터 근거가 없으면 붙지 않음. Sage 멘토 합의(L1 단위)는 그대로. 결과(10/1): 제이에스코퍼레이션(가방·의류)·국도화학은 N 꺼짐 → 🎯 에서 빠짐, 빙그레(음식료)는 유지 | 사용자 지정. 소비재(2d)의 L2 가 음식료 하나뿐이라 의류·가방·유통 종목에도 "음식료 흐름"이 매수 근거로 붙음(실측) |

| D47 | 2026-10-01 | **성과 원장 가동(P4 일부 선행)·측정 기간 D+5·20·40·60**(PRD §12 의 5·20·60 에 40 추가). `outcomes_update`(매일 20:00, 0006) 가 ① `queue_items` 큐 진입 구간(종목·큐·first_seen 이 같으면 1건)과 SnowBall 제출(종목·신호일당 1건 — 수동 버튼 연타 중복 제거, 큐 없는 제출 = `manual`)을 `signal_ledger` 에 소급 기록(dedupe_key 멱등) ② 진입가 = 신호 시각의 **거래소 현지 날짜 다음 첫 거래일 종가**(KST 07:12 신호의 미국 날짜는 전날), D+N = 진입일부터 N 거래일(종목 일봉 날짜가 곧 휴장 캘린더), 장 마감 전 당일 봉 미사용 ③ 벤치마크 KOSPI·KOSDAQ(거래소 구분 = krx_universe `.KS/.KQ`)·S&P 500, 휴장일 차이는 직전 종가 ④ outcomes 는 한 번 쓰면 고치지 않음, 수익률은 매번 같은 시세 계열에서 진입가·평가가를 함께 읽어 분할 조정에도 안전. 원장 시작일(9/29) 큐는 시작 시점 상태라 `payload.initial_state=true`. 매도 쪽(⚠️·💰)은 초과수익 < 0 을 적중으로 센다. **국내 시세 = 네이버 일봉(거래소 공식 종가)**, 미국 = 야후 | 사용자 지정(D+40). 실측: 야후 국내 종가가 공식 종가와 1~3% 다름(삼성전자 9/30 야후 268,500 vs 공식 269,500, SK하이닉스 1,776,000 vs 1,783,000 — 동시호가 전 체결가로 추정). 첫 실행 57행(큐 50·제출 7), 진입가 55건 확정(10/1 신호 2건은 10/2 종가 대기) |
| D48 | 2026-10-01 | **정시 슬롯 보호**: ① 저녁 브리핑 날짜 = 정오 전 실행이면 전날(`lib/time.ts briefDate`, cron 라우트 슬롯·dedupe 키 공용) ② `--slot YYYY-MM-DD-am|pm` 은 실행 시각이 같은 날짜·해당 시간대(오전 05~12시, 오후 12~24시 KST)가 아니면 거부(`slotTimeOk`). 수동 실행은 `--slot` 없이 ③ (10/2 보강) 브리핑 잡은 `--slot YYYY-MM-DD` 가 지금 실행이 속한 브리핑 날짜와 다르면 기록 없이 건너뜀(`briefSlotOk`), Actions 저녁 예비 슬롯은 `date -d '12 hours ago'` | 실측: 10/2 02:08 — 19:45 저녁 예비가 GitHub 지연으로 6시간 늦게 돌며 `brief_evening 2026-10-02` 슬롯을 차지(발송은 dedupe 로 막혔으나 그날 19:20 정시가 건너뛰어질 상태 → 기록 이름 변경으로 해제). 10/1 01:30 수동 실행이 `brief:evening:2026-10-01` 과 `pipeline 2026-10-01-am` 슬롯을 차지 → **10/1 19:20 저녁 브리핑 미발송**, 07:12 파이프라인도 건너뜀(아침 브리핑은 01:30 데이터로 발송) |
| D49 | 2026-10-01 | **성과 피드백 루프**(PRD §7.3 게이트 6 · §12). ① 매일(`outcomes_update` 20:00) 큐 원장 행마다 **신호 시점 특징**(신호 계열·신호원·주가 반영도 구간·실적 등급·시장·산업)을 `payload.features` 에 고정 저장(사후 값으로 바뀌지 않음 — 미래 정보 누수 방지) → 큐·특징 구간·기간별 초과수익 중앙값·적중률을 `perf_stats` 에 스냅샷(제출 이벤트는 같은 신호 중복이라 제외) ② **🎯 추천 순위 자동 반영**: 후보가 속한 구간 중 표본 ≥ 30(`feedback.min_samples`)인 구간의 D+20 초과수익 중앙값을 n/(n+30) 로 축소해 평균한 "기대 초과수익"을 첫 기준으로, 없으면 기존 규칙 순위(`rankBuy`). 카드에 "🧾 과거 성과" 줄(반영 여부 명시). **후보 자격(🎯 조건)·🟢 M1~M5 는 바꾸지 않음**(불변 규칙 4) ③ **분기 보정 제안**(`calibration_review`, 분기 첫 토 10:30): 표본 충분 구간끼리만 비교해 주가 반영도 상한·최소 계열 수 임계값 제안 + 신호원·산업·큐 정보 제안 → `calibration_reviews`(open) + 텔레그램 성적표. **rules.yaml 자동 변경 없음** — 승인 시 Claude Code 세션에서 설정 변경 + 이 문서 기록 후 status=applied/rejected ④ `/scorecard` 화면(큐별 성과·특징별 성과·보정 제안 이력) | 사용자 요청("성과를 축적해 추천에 피드백·지속 고도화"). PRD §12 "자동 적용 금지·표본 30 미만 변경 금지"(T12 과최적화)와 §7.3 게이트 6 "표본 30건 초과 시 성과 순위로 교체"의 범위 안에서 자동화. 첫 실행: 큐 50건 특징 저장(전부 axes_daily 근거), 성과 표본 0 → 규칙 순위 유지 |
| D50 | 2026-10-02 | **P3 진입 신호 구현**. ① `lib/engine/entry.ts entryLevel` 만 🟢 를 만든다 — M1∧M2∧M3∧M4∧M5 가 모두 `=== true` 이고 게이트 `allowed === true` 일 때만(진리값 우회 불가), 게이트는 거부만. 32개 조합 전수 + 게이트 차단 조합 테스트(SC6), DB CHECK 이중 강제(D20) ② M1·M2·M5 = 원천 값 그대로(국내 Heimdallr `entry_checks`, 미국 HermesCall `entry_checks_us`), 필드 누락은 false+사유. 미국 M1 "반영도 낮음"은 JARVIS `pri_us_lite` < 50(§7.6, 하루 1회 계산 → `bot_state.pri_us_lite`, 파이프라인 미국 P축에도 사용 — 그동안 null) ③ **원천 지연 보호**: 기대 거래일(지수 일봉 기준 확정 종가 마지막 날)보다 원천 계산일이 오래되면 M1·M2·M5 모두 false("원천 지연") — 지난 값으로 🟢 를 만들지 않음 ④ M3 = industry_heat 통과 L1, M4 = catalyst_events + HermesCall catalyst_watch(캐치업) 180일 ⑤ 태그 우선순위 PEAD_PB(🔵 60거래일 무장) > CU > PB > SW, 무효화선 PB 10일·SW 20일 최저·CU 원천 무효화선·PEAD_PB 돌파일 저가 ⑥ 게이트: 반영도 < 50 재확인 · 위험 회피 국면(국내 ★·미국 F1∧F3∧F4 만, 1차 비중 절반) · SnowBall 허용 비중 여유. 발송: 14거래일(주말 제외 근사) 재발송 금지 · 하루 국내 2·미국 1(상한 밖은 /entry 만) · 우선순위(성과 표본 충분 시 기대 초과수익 → 계열 수 → 반영도 → 산업 성장 → 가까운 이벤트) ⑦ 첫 🟢 → SnowBall draft(파이프라인 제출과 하루 상한·7일 dedupe 공유), 🟢 후 20거래일 안에 보유 종목 종가가 무효화선 아래면 ⚠️(알림 정지 중이면 기록만) ⑧ 🟢🟡🔵 를 성과 원장에 기록(단계별 연속 구간 1건, 특징 고정) → 성과 피드백(D49) 대상 ⑨ 실행: 07:12·19:10 pipeline 안(두 시장 모두 평가) + 21:40 재시도(0007). 브리핑에 🟢🟡🔵 줄, `/entry` 진입 보드. 저장은 M1 통과·M2∧M5·🟡🟢·무장·보유 종목만(하루 수십 행, 탈락 분포는 job_runs detail) | P3(PRD §16). 실측(10/2 18:30): 국내 1,152 전부 원천 지연(Heimdallr 10/2 실행이 GitHub 지연) → 🟢 없음(의도대로), 미국 100 중 ① 3·② 10·⑤ 4·🟢 0. 10/1 데이터가 제때였다면 미리보기: 🟢 1(KR:097230 조선 · 3Q 인도 이벤트), 🟡 3(모두 ③ 산업 근거 부족) — 미리보기 기록은 삭제. 텔레그램 액션 버튼(SnowBall 아이디어로·무시 7일)은 콜백 미지원이라 보류(링크 버튼 세트는 동일) |
---

## P2 진행 기록 (2026-09-29)

| 항목 | 실데이터 결과 |
|---|---|
| ingest_all | 17초, 신호 1,232건(산업 서사 16·멘토 11·HermesCall 수혜 176·F1~F4 35·센티먼트 5·등급 162·PRI 571·SnowBall 경보 256). Invest_WiKi 는 JARVIS 통합 미연결로 404 |
| catalysts (M4) | 이벤트 560건 (SnowBall 48·HermesCall 242·Heimdallr 215·국내 실적 컨센 상향 55) |
| pipeline (축·큐) | 644종목 평가 → 🎯 10 · 🔭 7 (레짐 정상, VIX 15.8) |
| industry_growth_realized (M3) | 통과 5/18: AI(①③)·반도체(①③)·전력인프라(③)·우주항공방산(①)·조선(①) |
| poll (보유 경고) | 부트스트랩 후보 48건(전부 SnowBall 경보) — 첫 실행은 기록만 |
| 브리핑 | 아침 1.5초·저녁 0.5초 생성(발송 전 확인) |
| 인박스 | 최근 2일 후보 0건(드라이런) |

### P2 가동 (2026-09-29 22:30 KST)
- 0005 적용(Vault jarvis_base_url·jarvis_cron_secret, 스케줄 9개), Vercel CRON_SECRET, 노션 2_4 연결(사용자).
- Vercel `/api/cron/poll` 200(24초) — 보유 경고 부트스트랩 48건 기록(발송 없음). **22:30 pg_cron 정시 폴링 도착 확인**(job_runs 슬롯 13:30Z, fresh 0).
- 첫 pipeline: 신호 1,352(WiKi 언급 120 포함) · M4 560 · 큐 ⚠️32(부트스트랩 경고 = 현재 상태) 🎯8 🔭7 · **SnowBall draft 3건 제출**(GEV·LITE·KR:417840) · 인박스 0.
- 저녁 브리핑 시험 발송 22:31(🎯 8건).
- **7일 관찰 시작**: 통과 판정 = 브리핑 `notifications.brief_*` 의 sent_at 이 07:30·19:20 기준 정시(허용 오차는 판정 때 기록) 7일 연속 + 보유 경고 `payload.latency_min` ≤ 35.

### P2 연계 점검 (2026-09-30 21:30 KST)
| 원천 | 역할(JARVIS 가 읽는 것) | 상태 |
|---|---|---|
| SnowBall | 보유·비중·과열·논지/훼손 트리거·레짐 → 보유 경고·익절·H축 / 쓰기는 `jarvis_submit_idea` 만 | ✅ 경보 325·트리거 52·draft 제출 누적 6종목(9/29 수동 버튼 중복 클릭 기록은 10분 가드로 해결) |
| Heimdallr | 실적 등급·점수(F)·주가 반영도(P)·분석 논지·리스크·분기 실적·기술 셋업 | ✅ 등급 163·PRI 1,141. ⚠️ 섹터 오분류(아래 B-13)·분석 리스크 자리표시("...") |
| HermesCall | 미국 실적 F1~F4·수혜주(C)·실적 일정·기술 아이디어·수혜 아이디어 | ✅ F1~F4 35. 마지막 분석 9/10(ORCL) — 9월 실적 공백기, **MU 9/30 발표 감지 여부 10/1 확인** |
| FlyWheel | 산업 흐름 강도(N)·위키 언급·인박스 | ✅ 산업 15·언급 246 |
| Sage | 멘토 합의(N, 산업 단위) | ✅ 21건(9/29 금 수집분) |
| 무료 검색(M3 ②) | 미국 증권사 산업 성장률 | ✅ 4개 소스 정상(GDELT 429 16/20 — 백오프로 진행). 채택 누적 2건(반도체 BofA 18% 등) — 정규식 엄격 기준이라 재현율 낮음(D19 설계대로) |
- 브리핑·폴링·파이프라인·카탈리스트·M3·링크 스모크 3일 연속 정상. 폴링 실패 6회는 D40 이전 60초 초과분.

### P2 7일 관찰 중간 점검 (2026-10-01 22:50 KST)
| 브리핑 | 예정 | 실제 발송(KST) | 판정 |
|---|---|---|---|
| 9/29 저녁 | 19:20 | 22:31 (가동 첫날 시험 발송) | 관찰 시작 전 |
| 9/30 아침 | 07:30 | 07:30 | ✅ |
| 9/30 저녁 | 19:20 | 19:20 | ✅ |
| 10/1 아침 | 07:30 | 07:30 (단, 07:12 파이프라인이 건너뛰어져 01:30 데이터) | △ |
| 10/1 저녁 | 19:20 | **미발송** — 01:30 수동 실행이 슬롯 선점(D48) | ❌ |
- 결함 수정(D48) 배포 후 **10/2 아침부터 7일 연속 재측정** → 가장 이른 판정 10/8 저녁. 보유 경고 지연(SC4)은 알림 정지(D39) 동안 판정 제외.
- 성과 원장(D47) 가동: 0006 적용 전에는 outcomes 쓰기(D+5 첫 도래 10/7)가 실패하므로 그 전에 적용 필요.

---

## ✅ P1 통과 (2026-09-28)
| 통과 조건(PRD §16) | 결과 |
|---|---|
| 부록 A 재현 | 참조 스냅샷 7개 프로젝트·127 라벨 전부 일치, 실데이터 라벨 96개 매핑(pending 1: SnowBall `S&P500`) |
| 링크 규칙 전부 200/3xx | **24/24** (배포 후 link_smoke, JARVIS `/stock/*` 307 로그인 이동 포함) |

- 0003(허용 이메일 RLS)·0004(P1 pg_cron 6개) 적용, `auth_setup` 으로 allowed_users 1명 등록, Supabase Auth URL 설정(사용자).
- `entities_sync`: **1,499 종목**(KR 1,399·US 100), L1 근거 Heimdallr 1,341·HermesCall 88·SnowBall 38·override(ETF) 6·없음 26, SnowBall 연결 44, HermesCall 분석 링크 93, 네이버 미국 코드 100/100.
- 남은 사용자 작업: 각 프로젝트 산업명 수정(INTEGRATION_TASKS §C·§E, P1 범위의 사용자 몫), `/taxonomy` 에서 `S&P500` 확정.

## P1 검증 기록 (2026-09-28)

- **부록 A 재현**: `lib/taxonomy/match.ts` = 참조 구현 스냅샷 7개 프로젝트·127 라벨 **전부 일치**, 오탐 회귀 3종 통과. 참조 스크립트 재실행 결과도 `taxonomy_expected.json` 과 동일(현 yaml 기준). 커버리지 lib/taxonomy·links·entities 라인 100%(테스트 73).
- **taxonomy_sync 실데이터**: 라벨 96개(HermesCall 13·Sage 9·Heimdallr 섹터 37·SnowBall 20·FlyWheel 17) 전부 매핑. pending 1건 = SnowBall ETF 섹터 `S&P500`(미매칭 → /taxonomy 확정 대기). 노션 2_1: ID 기준 변경 없음.
- **holdings_sync**: SnowBall 49종목 스냅샷(금액 필드 제외).
- **link_smoke**(로컬): 21개 중 19개 통과. 실패 2 = JARVIS `/stock/*`(P1 에서 페이지·로그인 보호 추가, 배포 후 재측정).

---

## P0 검증 기록 (2026-09-27)

### 1. 소스별 읽기 실측 (`npm run job -- source_smoke`, anon 키 · limit 1, 값 미저장)
| 소스 | 객체 | 결과 |
|---|---|---|
| SnowBall | 읽기 RPC 6개(positions·watchlist·triggers(180일)·macro·risk_alerts(7일)·performance) | **6/6 HTTP 200**. 보유 49종목(stock 37·etf 6·fund 6 / KOSPI 19·KOSDAQ 11·NASDAQ 7·NYSE 6·OTHER 6), 트리거 77, 매크로 키 11, 미확인 경보 250(7일) |
| Heimdallr | screen_results·price_snapshots·quarterly_fundamentals·consensus_snapshots·notifications·analyses·outcome_tracking·krx_universe·index_snapshots | **9/9 anon SELECT 가능**(행 반환) |
| Heimdallr | entry_checks | 404 — 연계 작업 B 전(예상대로 없음) |
| HermesCall | analyses·beneficiaries·quarterly_metrics·earnings_events·technical_ideas·watchlist | **6/6 anon SELECT 가능** |
| HermesCall | entry_checks_us·catalyst_watch | 404 — 연계 작업 C 전 |
| Sage | mentions·mentor_scorecards·strategy_reports·mentors | (9/28 재측정, publishable 키) **HTTP 200 이지만 4개 모두 0행** → RLS 가 anon 을 막는 것으로 판단(Sage 저장소 SQL 에 anon 정책 없음). INTEGRATION_TASKS §E-5 대로 Sage 쪽에서 anon SELECT 정책 또는 읽기 전용 RPC 필요. → 9/28 사용자가 Sage SQL Editor 에서 4개 테이블에 `jarvis_anon_read`(anon SELECT 전용) 정책 적용 → **4/4 행 반환 확인** |
| FlyWheel | 노션 모니터링 DB 연계종합 (JARVIS 통합, 9/28) | **16/17 L2 읽기 성공, 16개 모두 신호강도 값 있음**. `엔터` DB 는 연계종합 행이 한 번도 없음(신호강도 옵션 자체가 비어 있음) → "신호 없음"으로 처리 |

→ 읽기 RPC 요청(INTEGRATION_TASKS) 불필요: Heimdallr·HermesCall 은 기존 테이블 anon SELECT 로 충분, Sage 는 anon SELECT 정책 추가로 해결. **5개 소스 읽기 5/5 충족.**

### 1-1. JARVIS DB · 봇 (9/28)
- `0001_jarvis_schema.sql` 적용·`jarvis` 스키마 노출 확인: service 키로 job_runs·entities·entry_eval·source_health 조회 OK, **anon 은 401 `permission denied for schema jarvis`**(의도대로 차단).
- `TELEGRAM_BOT_TOKEN` = **@Tonny_JARVIS_bot** 확인(getMe). webhook 미등록(배포 후 등록).

### 2. M3 ② 무료 소스 스모크 (`npm run job -- outlook_smoke`, **로컬** 참고값, 쿼리 세그먼트 "AI chips")
| 소스 | HTTP | 결과 | 90일 이내 | 비고 |
|---|---|---|---|---|
| Google News RSS | 200 | 52 | 52 | 원문 URL 해제 5/5(batchexecute 방식, 구형 base64 는 0) → finance.yahoo.com·fortune.com 등 |
| Bing News RSS | 200 | 9 | 6 | 묶음 쿼리는 0건 → 단순 쿼리로 교체(D23) |
| GDELT DOC 2.0 | 200 | 75 | 75 | 첫 실행 429 → 백오프 후 200. 결과 잡음 많음(추출 단계에서 거름) |
| 증권사 공개 페이지 | 200 (6/6) | sitemap 90일 lastmod: MS 76·JPM 191·GS 177·BofA 33·Citi 71·WF 없음 | — | robots.txt 6곳 모두 해당 경로 허용 |

→ 로컬 기준 **4/4 응답**(통과 조건 3종 이상).

### 2-1. M3 ② 무료 소스 스모크 — **GitHub Actions 실측** (2026-09-28, run 36420608492)
| 소스 | HTTP | 결과 | 90일 이내 | 비고 |
|---|---|---|---|---|
| Google News RSS | 200 | 51 | 51 | 원문 URL 해제 5/5(batchexecute) → finance.yahoo.com·cnn.com 등 |
| Bing News RSS | 200 | 7 | 5 | msn.com·finance.yahoo.com 등 |
| GDELT DOC 2.0 | 응답 없음 | 0 | 0 | Actions 러너에서 20초 내 응답 없음(연결 실패/타임아웃). 로컬에선 200. T21 대로 격리·다음 실행 재시도, P2 수집기에서 타임아웃 상향 검토 |
| 증권사 공개 페이지 | 200 (6/6) | sitemap 90일 lastmod: MS 76·JPM 191·GS 173·BofA 33·Citi 70·WF 없음(패턴 14) | — | robots.txt 6곳 허용 |

→ **Actions 기준 3/4 응답 → P0 통과 조건(3종 이상) 충족.**

### 2-2. pg_cron → workflow_dispatch (2026-09-28)
- `0002_cron_dispatch.sql` 적용(cron job id 1 `jarvis-outlook-smoke`), Vault `jarvis_github_dispatch_token` 저장.
- `select jarvis.dispatch_job('outlook_smoke')` → `net._http_response` **204** → Actions run 36423106379(workflow_dispatch) **성공**. 결과 동일(Google 51·Bing 9·GDELT 무응답, 3/4).
- GDELT 는 Actions 에서 2회 연속 무응답 → P2 `industry_outlook_collect` 에서 타임아웃·재시도 상향, 계속 실패하면 🔧 알림 대상(T21).

### 2-3. 봇 webhook (2026-09-28)
- Vercel 배포 확인: `GET /api/telegram/webhook` 200, 잘못된 secret POST → 401, 올바른 secret(빈 업데이트) → 200, 홈 200.
- `npm run job -- telegram_webhook --action set` → @Tonny_JARVIS_bot 확인 후 등록. 사용자가 `/status`·`/links` 전송 → **둘 다 응답**, getWebhookInfo pending 0 · last_error 없음.

### ✅ P0 통과 (2026-09-28)
| 통과 조건(PRD §16) | 결과 |
|---|---|
| 5개 소스 읽기 | 5/5 (SnowBall RPC 6 · Heimdallr 9 · HermesCall 6 · Sage 4 · FlyWheel 16/17 L2) |
| 무료 검색 소스 3종 이상 응답(Actions) | 3/4 (Google News · Bing · 증권사 sitemap. GDELT 무응답) |
| 봇 `/status`·`/links` 응답 | 응답 확인 |
| (추가) pg_cron → workflow_dispatch | 204 → Actions 성공 |

남은 P0 외 항목: `GITHUB_READ_TOKEN`(P4 `/health` 전), 저장소 public 전환(D8, 사용자 결정), Actions Node 20 경고(actions/checkout·setup-node 버전 갱신).

### 3. 코드 게이트
- `npm run typecheck` ✅ · `npm run test:coverage` ✅(32 tests, 대상 파일 라인 100%) · `npm run build` ✅
