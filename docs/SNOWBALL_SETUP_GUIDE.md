# SnowBall Heritage ↔ JARVIS 연결 작업 가이드 (INTEGRATION_TASKS §A)

> **왜 먼저 해야 하나**: JARVIS는 포트폴리오를 SnowBall에서만 읽는다(장부 단일화). 이 연결이 없으면 JARVIS의 보유 경고·익절 검토·비중 계산·M4(보유 종목 트리거)가 동작하지 않는다.
> **걸리는 시간**: 약 40~60분.
> - Claude Code 작업 20~30분
> - SQL 실행·검증 15분
> - 배포 5분
>
> **결과물**: SnowBall DB에 "토큰이 맞아야만 열리는 전용 창구" 7개가 생긴다.
> - 읽기 6개: 보유, 관심종목, 트리거, 매크로, 경보, 성과
> - 쓰기 1개: 아이디어 초안 제출
>
> JARVIS는 이 창구로만 접근하며, 거래·논지·원가는 절대 쓰지 않는다.

**SQL 검증 상태**: `docs/snowball/0019_jarvis_contract.sql`은 2026-09-27에 로컬 PostgreSQL 16에서 검증했다. SnowBall 실제 마이그레이션 0001·0004·0017 위에 적용했고, Supabase의 auth·vault는 모의 객체로 대체했다.
- 통과
  - 재실행 안전
  - 아이언맨 보유만 반환(다른 구성원 제외)
  - 180일 트리거 필터
  - 아이디어 신규 생성과 버전 갱신
  - 미국 종목 제출
- 거부 확인
  - 잘못된 토큰
  - anon의 테이블 직접 접근
  - 내부 함수 호출
  - 모르는 종목

---

## 0단계. 준비물 확인 (5분)

| 항목 | 위치 |
|---|---|
| SnowBall 폴더 | `C:\Claude\dev\SnowBall Heritage` |
| Supabase 프로젝트 | `https://vnlvntknkapjicxrvlao.supabase.co` (SnowBall `.env.local`의 `NEXT_PUBLIC_SUPABASE_URL`) |
| anon 키 | SnowBall `.env.local`의 `NEXT_PUBLIC_SUPABASE_ANON_KEY` (원래 공개용 키. JARVIS가 이 키 + 토큰으로 접근) |
| SQL 초안 | `C:\Claude\dev\JARVIS\docs\snowball\0019_jarvis_contract.sql` |
| Supabase 대시보드 로그인 | SQL Editor 사용 권한 |

---

## 1단계. SnowBall 작업 트리 정리 (5분) — ⚠️ 반드시 먼저

2026-09-27 확인 결과, SnowBall 저장소에 **커밋되지 않은 변경이 많이 남아 있다**(`CLAUDE.md`, `README.md`, 로그인·자산 화면 등). 이 상태에서 새 작업을 시작하면 어떤 변경이 JARVIS 작업인지 구분할 수 없고 되돌리기도 어렵다.

PowerShell:
```powershell
cd "C:\Claude\dev\SnowBall Heritage"
git status
```
- 진행 중이던 작업이 완성된 것이면 **커밋**한다.
  ```powershell
  git add -A
  git commit -m "wip: 9/26 작업분 정리"
  git push
  ```
- 아직 미완성이면 **임시 보관**한다.
  ```powershell
  git stash push -m "9/26 진행 중 작업"
  ```
  JARVIS 작업이 끝난 뒤 `git stash pop`으로 되살린다.

`git status`가 "nothing to commit, working tree clean"이면 다음 단계로 간다.

---

## 2단계. Claude Code로 SnowBall 코드 작업 (20~30분)

1. `C:\Claude\dev\SnowBall Heritage` 폴더에서 Claude Code를 연다.
2. 아래 프롬프트를 **그대로** 붙여 넣는다.

```
JARVIS 연계 작업(D-xx)을 한다. 먼저 CLAUDE.md와 docs/PRD.md, docs/SCHEMA.md, docs/DECISIONS.md를 읽고 불변 규칙을 지켜라.
참고 문서: C:\Claude\dev\JARVIS\docs\INTEGRATION_TASKS.md §A, C:\Claude\dev\JARVIS\PRD.md §5.1

작업:
1) C:\Claude\dev\JARVIS\docs\snowball\0019_jarvis_contract.sql 을 읽고, 실제 스키마(supabase/migrations 0001~0018, types/index.ts)와
   컬럼·enum·함수 이름이 모두 맞는지 대조한 뒤 supabase/migrations/0019_jarvis_contract.sql 로 추가해라.
   - 불일치가 있으면 고치고, 고친 내용을 보고해라.
   - 파일 안의 'JARVIS_TOKEN_HERE' 는 그대로 둔다(토큰은 절대 커밋하지 않는다).
   - 테이블 권한·RLS는 바꾸지 않는다. anon 에는 jarvis_* 공개 함수 EXECUTE 만 준다.
2) types/index.ts 에 JARVIS 계약 타입(JarvisPosition, JarvisTrigger, JarvisIdeaPayload 등)을 추가한다(타입부터 수정 규칙).
3) /[member]/ideas 카드: payload.source === 'jarvis' 이면 "JARVIS" 배지, payload.jarvis_url 링크,
   payload.jarvis_entry(M1~M5 요약)가 있으면 5개 체크 표시를 보여준다. 기존 채택/기각 흐름은 그대로.
4) jarvis_submit_idea 로 생긴 관심 자산(assets.watch_only=true)의 sector 가 lib/utils/sectors.ts 의 SECTORS 에 없으면,
   기존 분류 규칙(sectors.ts 우선순위)으로 재분류하는 단계를 기존 slot 잡(또는 master 잡)에 추가한다.
5) lib/utils/sectors.ts 에 sectorToIndustryL1(sector) 를 추가한다(노션 L1 매핑, JARVIS PRD 부록 A.3):
   반도체 IDM·장비·소재·부품→반도체 / AI 팹리스→AI+반도체 / 전자 부품·광 네트워크·소프트웨어·플랫폼→IT / 양자→양자컴퓨터 /
   전력 인프라·에너지→전력인프라 / 2차전지·전기차→2차 전지 / 로봇→Robot / 자동차→자율주행차 / 조선 / 방산·우주→우주항공방산 /
   바이오 / 의료기기→헬스케어 / 화장품→화장품_미용기기 / 음식류·유통→소비재 / 엔터 / 금융 / 소재·기타→기타.
   lib 커버리지 100% 규칙에 맞게 테스트를 추가한다.
6) docs/SCHEMA.md(함수 목록), docs/DECISIONS.md(D-xx JARVIS 계약: 토큰 RPC, draft만 생성, 매수 강제 규칙 불변)를 갱신한다.
7) npm run typecheck && npm run test:coverage && npm run build 를 통과시킨다.
8) 커밋은 하되 push 는 하지 말고, 변경 파일 목록과 내가 Supabase SQL Editor에서 해야 할 일을 보고하고 멈춰라.

금지: 매수 강제 규칙(논지·훼손조건·확신도) 완화, 거래·논지 자동 생성, 토큰 커밋, 다른 기능 수정.
```

3. Claude Code가 멈추고 보고하면 다음을 확인한다.
   - 불일치 수정 내역이 있으면 읽어 본다(없어야 정상).
   - 변경 파일이 위 1~6번 범위를 벗어나지 않았는지 본다.
   - 테스트와 빌드가 통과했는지 본다.

---

## 3단계. 토큰 만들기 (2분)

토큰은 JARVIS와 SnowBall만 아는 64자리 무작위 문자열이다. PowerShell(Windows 기본 5.1에서도 동작):

```powershell
$b = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
$token = -join ($b | ForEach-Object { $_.ToString('x2') })
$token
```
출력된 64자리 값을 **비밀번호 관리 도구 등 안전한 곳**에 복사해 둔다. 이 토큰은 4단계와 7단계에서 쓴다. 채팅·노션·깃에는 붙여 넣지 않는다.

---

## 4단계. Supabase에서 SQL 실행 (5분)

1. Supabase 대시보드 → SnowBall 프로젝트(`vnlvntknkapjicxrvlao`) → 왼쪽 **SQL Editor** → **New query**
2. `C:\Claude\dev\SnowBall Heritage\supabase\migrations\0019_jarvis_contract.sql` 전체를 붙여 넣는다.
3. 편집기 안에서만 **⑧ 블록의 `'JARVIS_TOKEN_HERE'` 두 곳**을 3단계 토큰으로 바꾼다. 파일 자체는 고치지 않는다.
4. **Run** → 하단에 `Success. No rows returned`가 나오면 성공이다.
5. 이 쿼리 탭은 저장하지 말고 닫는다(토큰이 남지 않게).

> `permission denied for schema vault`가 나오면 SQL Editor가 아닌 다른 경로로 실행한 것이다. 반드시 대시보드 SQL Editor에서 실행한다(SnowBall `0016_cron_dispatch.sql`과 같은 방식).

---

## 5단계. 검증 (5분)

### 5-1. SQL Editor에서
```sql
-- ① 보유 종목이 JSON 배열로 나와야 한다 (아이언맨 보유 종목 수만큼)
select jsonb_array_length(public.jarvis_export_positions('<토큰>'));

-- ② 180일 내 대기·임박 트리거
select jsonb_array_length(public.jarvis_export_triggers('<토큰>', 180));

-- ③ 잘못된 토큰은 오류가 나야 정상
select public.jarvis_export_positions('wrong_token_0123456789abcdef0123456789abcdef');
--   → ERROR: jarvis: invalid token
```

### 5-2. 외부(JARVIS 입장)에서 — PowerShell
```powershell
$url  = "https://vnlvntknkapjicxrvlao.supabase.co/rest/v1/rpc/jarvis_export_positions"
$anon = "<SnowBall .env.local 의 NEXT_PUBLIC_SUPABASE_ANON_KEY>"
$h = @{ apikey = $anon; Authorization = "Bearer $anon"; "Content-Type" = "application/json" }
$res = Invoke-RestMethod -Method Post -Uri $url -Headers $h -Body (@{ p_token = $token } | ConvertTo-Json)
$res | Select-Object ticker, name, qty, weight, allowed_weight, heat_score | Format-Table
```
- 보유 종목 표가 나오면 **연결 성공**이다.
- `$token`은 3단계에서 만든 변수다. 새 창이면 다시 넣는다.

### 5-3. 테이블 직접 접근이 막혔는지 (보안 확인)
```powershell
Invoke-RestMethod -Uri "https://vnlvntknkapjicxrvlao.supabase.co/rest/v1/assets?select=*" -Headers $h
```
빈 배열 `[]` 또는 권한 오류가 나와야 정상이다(RLS가 그대로 작동).

---

## 6단계. SnowBall 배포 (5분)

```powershell
cd "C:\Claude\dev\SnowBall Heritage"
git log --oneline -3     # Claude Code가 만든 커밋 확인
git push                 # main → Vercel 자동 배포
```
- DB 함수는 4단계에서 이미 적용됐다. 배포는 아이디어 화면의 JARVIS 배지·재분류 단계 반영용이다.
- 1단계에서 `git stash`를 했다면 지금 `git stash pop`으로 되살린다.

---

## 7단계. JARVIS에 연결값 넣기 (2분)

`C:\Claude\dev\JARVIS\.env.local`(JARVIS P0에서 생성, 없으면 새로 만든다):
```
SNOWBALL_SUPABASE_URL=https://vnlvntknkapjicxrvlao.supabase.co
SNOWBALL_ANON_KEY=<NEXT_PUBLIC_SUPABASE_ANON_KEY 값>
SNOWBALL_JARVIS_TOKEN=<3단계 토큰>
```
JARVIS 저장소를 GitHub에 올린 뒤에는 같은 3개를 **GitHub → Settings → Secrets and variables → Actions**에, 그리고 **Vercel → Project → Settings → Environment Variables**에 등록한다.

---

## 8단계. 문제 해결

| 증상 | 원인 | 조치 |
|---|---|---|
| `jarvis: invalid token` | 토큰 불일치·공백 포함 | ⑧ 블록을 올바른 토큰으로 다시 실행. JARVIS 값 앞뒤 공백 확인 |
| `jarvis: ironman member count = 2` | 개발용 로그인 등으로 ironman 구성원이 2명 | SQL Editor에서 실제 owner 확인(`select owner_id, created_at from members where member_key='ironman'`) → `select vault.create_secret('<실제 owner_id>','jarvis_owner_id','JARVIS 대상 owner');` |
| `permission denied for function jarvis_...` | 7단계 grant 누락 | 0019 파일의 ⑦ 블록만 다시 실행 |
| `jarvis: unknown asset` | 종목 마스터에 없음(신규 상장·오타) | SnowBall 토요일 06:00 master 잡 이후 재시도, 또는 `npm run job -- master` |
| 보유 종목이 0건 | 거래(transactions)가 다른 구성원에 입력됨 | SnowBall에서 아이언맨 탭의 거래인지 확인 |
| 5-3에서 데이터가 보임 | RLS 비활성 | 즉시 SnowBall 마이그레이션 원본 정책 확인(0019는 RLS를 건드리지 않음) |

## 토큰 교체·폐기
- **교체**: 새 토큰 생성(3단계) → ⑧ 블록 재실행 → JARVIS `.env.local`·GitHub Secrets·Vercel 값을 교체한다.
- **즉시 차단**: SQL Editor에서 `select vault.update_secret((select id from vault.secrets where name='jarvis_token'), '<아무도 모르는 새 값>');`를 실행하면 JARVIS 접근이 곧바로 막힌다.
