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
