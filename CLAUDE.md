# JARVIS — Claude Code 작업 규약

> 아이언맨 투자 통합 지휘 시스템. 스펙은 `PRD.md`(v1.3 FINAL)가 유일한 기준이다. 세션 시작 시 PRD 해당 절을 먼저 읽는다.
> 연계 프로젝트 변경은 이 저장소에서 하지 않는다 → `docs/INTEGRATION_TASKS.md`를 해당 저장소 세션에 전달한다.

## 스택
Next.js 15 App Router · React 19 · TypeScript · Tailwind v4 · recharts · Supabase(Postgres/Auth/RLS/pg_cron) · vitest · GitHub Actions(`scripts/` 배치) · Vercel

## 설정 단일 출처 (하드코딩 금지)
| 파일 | 내용 |
|---|---|
| `config/taxonomy.yaml` | 노션 18개 L1·L2·동의어·overrides·노션 URL |
| `config/taxonomy_expected.json` | 매핑 스냅샷(테스트 기준, `docs/reference/taxonomy_match_reference.py`로 생성) |
| `config/rules.yaml` | 축·큐·**M1~M5**·게이트·성과 |
| `config/links.yaml` | 텔레그램·대시보드 공용 링크 규칙 |
| `config/industry_growth.yaml` | M3 ② 미국 메이저 증권사 목록·무료 검색 소스·출처 등급·추출 패턴, ③ 전망 근거(출처·기준일 필수) |
| `config/catalyst_calendar.yaml` | M4 수동 이벤트 |

## 불변 규칙
1. **보유·거래·원가를 쓰지 않는다.** 원장은 SnowBall Heritage. SnowBall 쓰기는 `jarvis_submit_idea` RPC 하나.
2. **SnowBall 기능을 재구현하지 않는다.** 논지·훼손조건·결정 검증·과열·리밸런싱은 읽어서 표시만 한다.
3. **자동 매매 금지.** 모든 출력에 "매수 확정 신호 아님"을 명시한다.
4. **🟢 진입 신호는 M1∧M2∧M3∧M4∧M5가 모두 true일 때만 생성한다.** 이 조건을 우회·완화하는 코드 경로 금지. `lib/engine/entry.ts`의 단일 함수만 🟢를 만들 수 있고, 테스트로 강제한다(SC6). 🔵 실적 돌파는 진입 신호가 아니다.
5. **판정은 결정론적 규칙만.** LLM은 주간 메모 서술(grounding gate, PRD §10.4)에만 쓴다. LLM 호출은 `lib/llm/router.ts`만 경유하고 `cost_log`에 기록한다.
   - **M3 ② 증권사 성장률은 LLM·유료 API를 쓰지 않는다(D19).** 무료 공개 소스(`industry_growth.yaml > news_search`)로 찾고, `lib/engine/outlook/extract.ts`의 정규식으로 원문 문장에서 뽑고, `adopt.ts`의 등급·교차 규칙으로 자동 채택한다. 사람 확인 단계(버튼·텔레그램 확인)를 만들지 않는다. `status=adopted`가 아닌 값을 판정에 쓰는 코드 경로 금지.
   - 원문은 판정용 문장(quote)만 저장한다. 본문 전체 저장 금지, robots.txt 준수.
6. **외부 소스는 `lib/ingest/<source>.ts` 어댑터 뒤에 둔다.** 예외를 올리지 않고 `{ok:false, reason}`을 반환하며, 누락 컬럼을 견딘다.
7. **링크는 `lib/links.ts`(config/links.yaml)로만 만든다.** 만들 수 없는 링크는 버튼을 생략한다. 텔레그램과 대시보드가 같은 함수를 쓴다.
8. **텔레그램은 @Tonny_JARVIS_bot 토큰만 쓴다.** 다른 봇 토큰으로 getUpdates·setWebhook 호출 금지. HTML 모드에서 동적 텍스트는 escape한다.
9. **환경변수는 `lib/env.ts`에서만 읽고 `.trim()` 강제.** 비밀에 `NEXT_PUBLIC_` 접두사 금지.
10. **공개 저장소다.** 데이터·키·개인 금액·`.env*` 커밋 금지.
11. PostgREST 조회는 1,000행 제한 → `range()` 페이징.
12. 모든 시각은 KST로 저장하고 시장 날짜(KR/US)를 별도 컬럼에 둔다. 거래일 계산은 시장별 캘린더를 쓴다.
13. 배치 잡은 멱등이다. 같은 슬롯이 이미 성공했으면 즉시 종료한다.

## 디렉터리
```
app/                    / · /portfolio · /stock/[id] · /entry · /radar · /growth · /weekly · /scorecard · /taxonomy · /health
app/api/telegram/       webhook
app/api/public/         taxonomy · holdings-lite · industry-heat · catalyst-watch (토큰)
lib/taxonomy/           match.ts (참조 구현과 동일 결과, 커버리지 100%)
lib/links.ts            링크 빌더 (순수 함수 + naver_us 코드 해석 어댑터 분리)
lib/ingest/             flywheel · sage · hermescall · heimdallr · snowball · market · notion
lib/engine/             normalize · axes · regime · industry-growth(M3 ①) · outlook/(M3 ② search · fetch · extract · adopt — 무료·LLM 없음) · catalysts(M4) · entry(🟢/🟡/🔵) · queues · gate · pri-us-lite
lib/outcomes/           ledger · returns · scorecard
lib/memo/               fact-table · prompt · grounding
lib/telegram/           send · templates · commands · keyboards
lib/llm/                router
scripts/                배치 진입점 (npm run job -- <name>)
supabase/migrations/    jarvis 스키마 + pg_cron dispatch
config/                 위 표
docs/                   START_HERE.md(사용자 체크리스트) · INTEGRATION_TASKS.md · DECISIONS.md · SNOWBALL_SETUP_GUIDE.md · snowball/ · reference/
```

## 명령
```bash
npm run dev
npm run typecheck && npm run test && npm run build
npm run job -- ingest_all | holdings_sync | industry_growth_realized | industry_outlook_collect | catalysts | entry_eval --market KR|US | axes | queues | gate | poll | brief --kind morning|evening | weekly_memo | outcomes_update | calibration_review | taxonomy_sync | entities_sync | link_smoke
```

## 테스트 규칙
- `lib/taxonomy`, `lib/engine`, `lib/links.ts`, `lib/outcomes`, `lib/memo/grounding`은 라인 커버리지 100%.
- `config/taxonomy_expected.json` 스냅샷과 완전 일치해야 한다(오탐 회귀: 인바운드↔파운드리, 의료기기↔미용기기, AI인프라반도체↔전력인프라).
- **SC6**: M1~M5 중 하나라도 false이면 🟢가 생성되지 않음을 32개 조합 전수 테스트로 보장한다.
- M1·M2·M5 판정 근거는 원 프로젝트 값을 그대로 사용하되, 필드 누락 시 해당 조건을 false(데이터 없음)로 처리하고 사유를 기록한다.
- 링크 빌더: 국내·미국·SnowBall 자산 유무·HermesCall 분석 유무·네이버 코드 해석 실패의 각 경우를 테스트한다.
- M3 ② 추출·채택: `docs/reference/outlook_extract_fixtures.yaml`의 정탐·오탐 예문을 전부 통과해야 한다(네트워크 없이). 목표주가·기업 매출·지수·과거 시제·비미국 증권사·90일 초과·등급 밖 도메인·신디케이션 중복이 각각 탈락/1건 처리되는지, A1·B1·B2 채택과 충돌 표시, 파생 CAGR 계산을 테스트한다.

## 작업 순서
PRD §16 Phase 순서(P0→P5). 각 Phase 종료 시 검증 게이트 결과를 `docs/DECISIONS.md`에 기록한다.
