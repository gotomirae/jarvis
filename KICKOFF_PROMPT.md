# Claude Code 시작 프롬프트 (C:\Claude\dev\JARVIS 에서 실행)

> **먼저** `docs/START_HERE.md` 1~3단계를 끝낸다: 결정 2개 → SnowBall 연결(`docs/SNOWBALL_SETUP_GUIDE.md` 1~7단계) → 계정·키 준비. 그다음 아래 프롬프트를 쓴다(START_HERE 4단계).

아래 블록을 그대로 붙여 넣는다.

```
너는 JARVIS 프로젝트의 구현 담당이다. 이 폴더(C:\Claude\dev\JARVIS)에서 작업한다.

1) CLAUDE.md → PRD.md(v1.3 FINAL) → config/*.yaml → docs/INTEGRATION_TASKS.md 순서로 전부 읽어라.
   PRD가 유일한 기준이며, 임계값·URL·산업명은 config 파일에서만 읽는다(하드코딩 금지).

2) PRD §16의 P0(준비)부터 시작한다. 다음 작업을 순서대로 진행한다.
   - git 저장소 초기화(public 예정, .gitignore에 .env* 포함), Next.js 15 + TypeScript + Tailwind v4 + vitest 스캐폴딩(SnowBall Heritage와 같은 구조: C:\Claude\dev\SnowBall Heritage 참고)
   - lib/env.ts, .env.example(PRD 부록 C). .env.local을 만들고, 연계 프로젝트의 URL·anon 키만 읽기 전용으로 채워라:
     Heimdallr = C:\Codex\Heimdallr_Call_Codex\dashboard\.env.local, HermesCall = C:\Claude\dev\HermesCall\dashboard\.env.local 의 NEXT_PUBLIC_SUPABASE_URL·NEXT_PUBLIC_SUPABASE_ANON_KEY.
     service 키는 절대 복사하지 않는다. 나머지 값은 내가 붙여 넣을 수 있게 빈칸으로 두고 알려라. 키 값을 화면에 출력하지 마라.
   - supabase/migrations: jarvis 스키마(PRD §13) + pg_cron → workflow_dispatch 함수(SnowBall 0016_cron_dispatch.sql 패턴)
   - lib/ingest 어댑터 골격 5개와 소스별 읽기 스모크 스크립트(anon SELECT 가능 여부 실측 결과를 docs/DECISIONS.md에 기록)
   - Telegram webhook(/api/telegram/webhook, secret_token 검증)과 /status·/links 명령
   - FlyWheel 노션 연계종합 행의 신호강도 속성명·형식 실측 후 어댑터에 고정
   - M3 ② 무료 소스 스모크(GitHub Actions에서 실행, 유료 API·LLM 사용 금지): Google News RSS·Bing News RSS·GDELT 각 1쿼리 결과 수·HTTP 상태, Google News 원문 URL 해제, 증권사 인사이트 목록 URL 실측 → config/industry_growth.yaml 고정. 결과를 docs/DECISIONS.md에 기록
   - SnowBall 연결 확인: jarvis_export_positions 호출이 보유 종목을 반환하는지(.env.local의 SNOWBALL_* 사용)

3) 각 단계마다 npm run typecheck && npm run test && npm run build 를 통과시켜라.
   P0가 끝나면 통과 조건(PRD §16) 충족 여부와 막힌 항목(키·권한·슬롯 등 내가 해야 할 일)을 정리해서 보고하고 멈춰라.

4) 확인이 필요한 결정(D5: 신규 Supabase 프로젝트 가능 여부 등)은 추측하지 말고 나에게 질문해라.
   연계 프로젝트(SnowBall·Heimdallr·HermesCall·Sage·FlyWheel)의 코드는 이 세션에서 수정하지 않는다.
```

## 이후 Phase 진행 프롬프트
```
PRD §16의 P{번호}를 진행해라. 시작 전에 해당 절과 관련 config를 다시 읽고, 끝나면 통과 조건 충족 여부와 DECISIONS 기록을 보고하고 멈춰라.
```

## 연계 프로젝트 작업 (각 저장소에서 별도 세션)
- SnowBall Heritage: `docs/SNOWBALL_SETUP_GUIDE.md` — **P0 전에 먼저**
- Sage: §E · HermesCall: §C · Heimdallr(Codex): §B · FlyWheel: §D


[인계 — 이미 끝난 것]
- SnowBall 연결(P(-1)) 완료: 0019_jarvis_contract.sql 운영 DB 적용·검증 끝(SnowBall 커밋 5ab99ff, D-69).
  읽기 RPC 6개 모두 200 응답(보유 49종목 — 주식 37·ETF 6·펀드 6, 연금 계좌 포함 → 개별 종목 신호는 asset_class='stock' 만).
  jarvis_submit_idea 는 운영 DB에서 아직 호출 안 함. 아이디어 payload 형식은 SnowBall types/index.ts 의
  JarvisSubmitIdeaInput·JarvisEntry(M1~M5: {pass, note}) 를 따른다. RPC 는 반드시 POST 로 호출(GET 이면 토큰이 URL 에 남음).
- risk_alerts 미확인 경보가 7일에 250건 → 보유 경고는 종목·규칙별 묶음/심각도 필터 필요.
- git: 이미 초기화됨. 원격 gotomirae/jarvis(현재 private, 브랜치 master). .gitignore 로 .env.local 제외 확인.
  공개 여부(D8 은 public)는 내가 아직 결정 안 함 — 묻고 진행해라.
- .env.local 에 SNOWBALL_SUPABASE_URL·SNOWBALL_ANON_KEY·SNOWBALL_JARVIS_TOKEN 입력 완료, GitHub Secrets 에도 같은 3개 등록 완료.
- D5: A안 — 별도 구글 계정의 새 Supabase 프로젝트 jarvis(서울). 키는 내가 .env.local 에 직접 넣는다.
  스키마 SQL 은 전부 supabase/migrations 에 커밋하고, 재생성 불가 데이터(성과 원장 등)는 주기적 내보내기를 설계해라.
- Vercel 은 앱 골격 push 후 연결 예정(아직 안 함).
