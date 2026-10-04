# JARVIS 시작 체크리스트 — 아이언맨이 먼저 할 일 (PRD v1.3 §18)

> 2026-09-27 PC 실측 기준
> - `C:\Claude\dev\JARVIS`는 아직 git 저장소가 아니다. P0에서 Claude Code가 초기화한다.
> - SnowBall Heritage 저장소에 **커밋 안 된 파일이 125개** 있다. 1단계에서 반드시 정리한다.
> - Heimdallr(199개)·HermesCall(53개)도 커밋 안 된 변경이 많다. 각 연계 작업(6단계·8단계) 직전에 정리한다.
> - 각 프로젝트의 `.env*` 파일은 모두 git 무시 대상이다(확인 완료).
>
> 전체 소요: 오늘 1~5단계 약 **2시간 + Claude Code P0 실행 2~4시간**(자동 진행).
> 목표 일정: P0 ~9/30 → P1 ~10/3 → **P2 ~10/12**(3분기 실적 시즌 전) → P3 10/13~10/31.

---

## 1단계. 결정 2개 (10분)

- [ ] **D5 — JARVIS용 새 Supabase 프로젝트를 만들 수 있는가?**
  - Supabase 대시보드 → New project → 이름 `jarvis`, 리전 **Northeast Asia (Seoul)**.
  - 만들어지면 **A안**(권장): DB 비밀번호를 비밀번호 관리자에 저장하고 Settings → API에서 URL·anon·service_role 키를 확인해 둔다.
  - 요금제 한도로 막히면 **B안**: SnowBall DB 안에 `jarvis` 스키마를 만든다. P0 시작 때 Claude Code에 "D5는 B안"이라고 답한다.
- [ ] **GitHub 저장소**: `gotomirae/JARVIS`, **public**(Actions 무료 분 보호, D8). 이름을 바꾸면 `config/industry_growth.yaml`의 `user_agent`도 바꾼다.

## 2단계. SnowBall 연결 (40~60분) — P0의 선행 조건

- [ ] `docs/SNOWBALL_SETUP_GUIDE.md` **1~7단계**를 순서대로 진행한다.
  1. 작업 트리 정리: 커밋 안 된 파일 125개를 먼저 커밋하거나 `git stash push`한다.
  2. SnowBall 저장소에서 Claude Code 프롬프트를 실행한다.
  3. PowerShell로 토큰을 만든다.
  4. SQL Editor에서 `0019_jarvis_contract.sql`을 실행한다. `JARVIS_TOKEN_HERE`는 **에디터 안에서만** 바꾸고 파일에는 저장하지 않는다.
  5. 검증 3개(SQL · PowerShell RPC 호출 · 테이블 직접 접근 차단)를 확인한다.
  6. push하고 배포한다.
  7. `SNOWBALL_SUPABASE_URL`, `SNOWBALL_ANON_KEY`, `SNOWBALL_JARVIS_TOKEN`을 메모해 둔다(4단계에서 사용).
- 통과 기준: 5단계 검증에서 PowerShell 호출이 아이언맨 보유 종목을 반환한다.

## 3단계. 계정·키 준비 (30~40분)

| # | 항목 | 방법 | 들어갈 곳(`.env.local`) |
|---|---|---|---|
| 3-1 | 텔레그램 봇 토큰 | BotFather → `/mybots` → Tonny_JARVIS_bot → API Token. 봇이 없으면 `/newbot` | `TELEGRAM_BOT_TOKEN` |
| 3-2 | chat_id | 텔레그램에서 @Tonny_JARVIS_bot에 `/start`를 보낸다(**필수**, 안 보내면 봇이 메시지를 못 보냄). 개인 대화의 chat_id는 봇과 무관하게 같으므로 HermesCall `.env`의 `TELEGRAM_CHAT_ID`와 같은 값이다 | `TELEGRAM_CHAT_ID` |
| 3-3 | webhook 비밀값 | PowerShell 토큰 명령(SnowBall 가이드 3단계)을 한 번 더 실행 | `TELEGRAM_WEBHOOK_SECRET` |
| 3-4 | JARVIS 공개 API 토큰 | 위와 같은 방법으로 하나 더 | `JARVIS_PUBLIC_TOKEN` |
| 3-5 | GitHub 빈 저장소 | github.com/new → `JARVIS`, Public, README·.gitignore **없이** 생성 | — |
| 3-6 | GitHub PAT ① | Settings → Developer settings → Fine-grained token → 저장소 `JARVIS`만, **Actions: Read and write** | `GITHUB_DISPATCH_TOKEN` |
| 3-7 | GitHub PAT ② | Fine-grained token → 저장소 6개(JARVIS·snowball-heritage·Heimdallr_Call·HermesCall·Sage·Compounding_Flywheel), **Actions: Read-only** | `GITHUB_READ_TOKEN` |
| 3-8 | 노션 통합 | notion.so/profile/integrations → 새 내부 통합 `JARVIS`(읽기·콘텐츠 삽입). 아래 3곳에서 ••• → 연결 → JARVIS 추가: `2_1. 산업 & 종목`, `Idea_Generating` DB, `2_3. 투자 아이디어` | `NOTION_API_KEY`, `NOTION_IDEA_DB_ID`, `NOTION_WEEKLY_PARENT_PAGE_ID` |
| 3-9 | Sage anon 키 | PC에는 Sage의 service 키만 있다. Supabase 대시보드 → Sage 프로젝트 → Settings → API → anon(publishable) 키 복사 | `SAGE_SUPABASE_URL`, `SAGE_READ_KEY` |
| 3-10 | Heimdallr·HermesCall anon 키 | **직접 안 해도 된다.** P0에서 Claude Code가 각 `dashboard/.env.local`의 URL·anon 키만 읽어 채운다(service 키는 복사하지 않음) | `HEIMDALLR_*`, `HERMES_*` |
| 3-11 | Anthropic 키 | 주간 메모 전용(P4부터 필요). SnowBall 키를 재사용해도 되고, 콘솔에서 월 한도 $5를 걸어 두면 안전하다 | `ANTHROPIC_API_KEY` |
| 3-12 | Vercel | 계정만 확인해 둔다(GitHub 연결). 프로젝트 가져오기는 5단계 | — |

> 값은 **채팅이나 PRD에 붙여 넣지 않는다.** 4단계에서 Claude Code가 `.env.local`을 만들면 거기에 직접 붙여 넣는다. `.env*`는 커밋 금지(공개 저장소).

## 4단계. Claude Code로 P0 실행 (2~4시간, 대부분 자동)

- [ ] PowerShell: `cd C:\Claude\dev\JARVIS` → `claude`
- [ ] `KICKOFF_PROMPT.md`의 코드 블록 전체를 붙여 넣는다.
- [ ] 질문이 오면 답한다. 예상 질문은 D5(A안/B안), 저장소 이름, `.env.local` 값 붙여 넣기 완료 여부다.
- [ ] Claude Code가 P0 통과 조건과 "사용자 할 일"을 보고하고 멈춘다.
  - P0 통과 조건: 5개 소스 읽기, 무료 검색 소스 3종 이상 응답(Actions에서), 봇 `/status`·`/links` 응답.

## 5단계. P0 마무리 — 내가 할 일 (20분)

- [ ] **GitHub Secrets**: JARVIS 저장소 → Settings → Secrets and variables → Actions → `.env.local`과 같은 이름으로 등록한다. 목록은 P0 보고서에 나온다.
- [ ] **Vercel**: Add New → Project → `JARVIS` 가져오기 → Environment Variables에 `.env.local` 값 입력 → Deploy → 나온 URL을 `.env.local`·Secrets의 `JARVIS_URL`에 넣는다.
- [ ] Claude Code에 "Vercel URL은 …, webhook 등록해줘"라고 요청한다. 등록이 끝나면 텔레그램에서 `/status`·`/links`로 확인한다.
- [ ] GitHub → JARVIS → Actions → `industry_outlook_collect` 스모크 실행 결과(소스별 결과 수)를 확인한다.

## 6단계. 연계 작업 ① — JARVIS P1과 병행 (각 30~60분)

순서는 `docs/INTEGRATION_TASKS.md`의 **E → C(산업명 부분)**다. 각 저장소에서 **작업 트리 정리 후** 해당 절을 붙여 넣는다.
- [ ] **E. Sage**: SECTORS = 노션 18 L1 + MACRO + 기타, 기존 데이터 치환, 전략 리포트 **금 18:00**으로 이동.
- [ ] **C. HermesCall**(1~2항, 산업명·watchlist 교체): 먼저 커밋 안 된 53개를 정리한다.
- [ ] **노션**: `[산업] 자율주행차` 페이지를 만든다(FlyWheel `industries.json` 반영은 D에서).

## 7단계. JARVIS P1 → P2 (10/12까지)

- [ ] Claude Code: `PRD §16의 P1을 진행해라…`(KICKOFF 하단 "이후 Phase 진행 프롬프트") → 보고 → P2.
- [ ] P2 통과 조건: 7일 연속 정시 브리핑, 보유 경고 ≤ 35분.

## 8단계. 연계 작업 ② — 🟢 진입 신호(P3)의 선행

- [ ] **B. Heimdallr**(Codex): 먼저 커밋 안 된 199개를 정리한다. `entry_checks`(국내 M1·M2·M5), K1, Kairos 18 L1.
- [ ] **C. HermesCall**(나머지): `entry_checks_us` 06:40, H1, `catalyst_watch`, idea_scanner 개편.
- [ ] **D. FlyWheel**: 인박스, `/매수` 폐기, holdings-lite 읽기.
- [ ] 그다음 JARVIS P3. 2주 병행 후 원 프로젝트의 기술적 알림 텔레그램을 중단한다(D10).

---

## 매일 쓰는 법 (2026-10-04 갱신, D53~D55)
| 언제 | 어디서 | 무엇을 |
|---|---|---|
| 07:30 · 19:20 | 텔레그램 브리핑 | 🎯 카드의 **🔁 몇 번째 추천·첫 추천 이후 수익률** → **🏢 좋은 기업인가** → **⏱️ 지금 사기 좋은가**(✅⚠️❌) 순서로 읽는다. ⏸️ 대기 목록은 "좋은 기업이지만 지금은 아님" |
| 브리핑 직후 | 대시보드 🏠 오늘 | 요약 타일 → 보유 경고 → 🎯 지금 사기 좋은 종목. 종목 이름 → 종목 화면 → SnowBall로 보내기 |
| 🟢 알림 때 | 🚦 진입 보드 | 필수 조건 5개 ✅ 확인, 무효화 가격·1차 비중을 SnowBall에 기록 |
| 주 1회 | ✅ 사후 검증 | 추천 승률·시장 대비 초과수익, 자동으로 빠진 기준(🚫)·우수 기준(⭐) 확인 |

- 추천 기준 자동 학습을 끄려면 `config/rules.yaml` → `pick_policy.auto_apply: false`(그러면 제안만 표시).
- ⏱️ 점수 배점·임계값은 `config/rules.yaml` → `buy_timing`. 바꾸면 `docs/DECISIONS.md` 에 근거를 남긴다.
- 대시보드가 예전 화면이면 `Ctrl + Shift + R`(강력 새로고침), 주소는 `https://jarvis-fawn-pi.vercel.app`.

---

### 막히면
- SnowBall 연결: `docs/SNOWBALL_SETUP_GUIDE.md` 8단계(문제 해결)를 본다.
- 무료 검색 소스가 Actions에서 막히면(429·403) P0 보고서에 기록된다. 한 소스가 막혀도 나머지로 돌아간다(PRD T21).
- 결정이 필요한 문제는 Claude Code가 추측하지 않고 질문하도록 되어 있다(KICKOFF 4항).
