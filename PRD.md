# JARVIS — 아이언맨 투자 통합 지휘 시스템 PRD v1.3 (FINAL · 구현 기준본)

> 작성일: 2026-09-27 · 구현 도구: Claude Code(본 저장소) · 연계 저장소 변경: `docs/INTEGRATION_TASKS.md`
> **이 문서 하나로 구현이 가능해야 한다.** Claude Code 세션은 `CLAUDE.md` → 이 파일 순서로 읽는다.
> **사용자(아이언맨)가 먼저 할 일**은 `docs/START_HERE.md`(§18 요약)에 순서대로 있다.
> 설정의 단일 출처는 다섯 파일이다. 코드에 임계값·URL·산업명을 하드코딩하지 않는다.
> - `config/taxonomy.yaml` — 산업 분류
> - `config/rules.yaml` — 판정 규칙
> - `config/links.yaml` — 외부 링크
> - `config/industry_growth.yaml` — 산업 성장 근거(② 미국 메이저 증권사 목록·무료 뉴스 검색·추출 패턴·출처 등급, ③ 전망)
> - `config/catalyst_calendar.yaml` — 수동 이벤트
>
> 변경 이력
> - v1.1(2026-09-27)
>   - 노션 `1l. 자율주행차` 추가, 에너지 → 전력인프라, 자동차 → 자율주행차, 그 외 미매칭 → 기타
>   - 🟢 진입 신호에 **필수 조건 M1~M5**(사용자 지정) 적용
>   - 텔레그램에 6개 대시보드 + 네이버 증권 + StockEasy 링크
> - v1.2(2026-09-27)
>   - **M3(산업 고성장) = ① 실제 실적 · ② 미국 메이저 증권사 산업 성장률 전망 · ③ `industry_growth.yaml` 전망 중 하나 이상 충족**(사용자 지정)
>   - ②는 **미국 메이저 증권사 전망치만** 인정하고, 증권사 로그인 자료가 아니라 **웹 검색으로 찾은 최근 3개월 이내 공개 자료**만 쓴다. (수집 방식은 v1.3에서 무료·자동으로 대체)
>   - SnowBall 연결 SQL(`docs/snowball/0019_jarvis_contract.sql`, 로컬 검증 완료)과 단계별 가이드(`docs/SNOWBALL_SETUP_GUIDE.md`) 추가
> - v1.3(2026-09-27)
>   - **M3 ② 수집을 무료·완전 자동으로 전환**(사용자 지정): 유료 Claude API 웹 검색 도구 → 무료·무키 공개 소스(Google News RSS · Bing News RSS · GDELT DOC API · 증권사 공개 인사이트 페이지)
>   - 수치 추출은 **LLM 없이 결정적 규칙(정규식)** 으로 한다. 인용문은 원문 문장 그대로라 수치 환각이 구조적으로 0이다
>   - 사용자 1탭 확인을 없애고 **출처 등급 + 교차 보도 규칙으로 자동 채택**한다. 대시보드·텔레그램 확인 흐름(📑 메시지, 확인 카드)은 삭제
>   - M3 ②의 비용은 $0. 월 LLM 상한은 $15 → $5(주간 메모만)
>   - 사용자 시작 순서 §18 + `docs/START_HERE.md` 추가. 결정·함정·스케줄 표 순서 정리

---

## 목차
0. 한 문장 · 목적 · 성공 기준
1. 시스템 지형 — 6개 구성원의 역할과 경계
2. 확정 결정사항 (ADR)
3. 아키텍처 · 데이터 흐름
4. 공통 기준 — 산업 분류 · 종목 마스터 · 보유 장부
5. 데이터 계약
6. 신호 정규화 · 수렴 엔진 · 행동 큐
7. 진입·청산 타이밍 — 필수 조건 M1~M5와 프로젝트별 역할
8. JARVIS 대시보드
9. 텔레그램 @Tonny_JARVIS_bot (링크 규칙 포함)
10. 주간 투자위원회 (토 09:30)
11. FlyWheel 인박스
12. 성과 귀속 · 규칙 보정
13. DB 스키마 (`jarvis`)
14. 통합 스케줄 (KST)
15. 비용
16. 구현 Phase · 검증 게이트
17. 함정 목록 · 리스크
18. 시작 순서 — 사용자 준비물과 첫 실행
- 부록 A 산업 매핑 결과 · 부록 B 메시지 템플릿 · 부록 C 환경변수

---

## 0. 한 문장 · 목적 · 성공 기준

### 0.1 한 문장
**JARVIS는 FlyWheel·Sage·HermesCall·Heimdallr 네 시스템의 신호를 하나의 언어로 모아, 서로 다른 신호가 한 종목에서 합의하고 필수 조건 M1~M5를 모두 충족하는 순간을 찾아내고, SnowBall Heritage(포트폴리오)와 연결해 하나의 대시보드와 하나의 텔레그램으로 전달하는 지휘 계층이다.**

### 0.2 목적
투자 가치가 높은 산업과 종목을 **더 빨리** 발굴한다. 그다음 세 가지 시점에 행동한다.
- **실적이 숫자로 확인되고 주가가 아직 반영하지 않은 순간**에 매수한다.
- **수급이 붙고 MACD가 돌아서기 직전**에 진입한다.
- **논지 훼손·과열 시점**에 매도한다.

이 흐름으로 투자 수익을 극대화한다. JARVIS는 새 분석을 만들기보다 이미 돌아가는 5개 시스템의 결과를 **결합**하는 데 집중한다.

### 0.3 성공 기준

| # | 기준 | 측정 | 목표 |
|---|---|---|---|
| SC1 | 신호 결합률 | 4개 소스 신호 중 종목 코드 또는 L1 산업으로 매핑된 비율 | ≥ 98% |
| SC2 | 산업 매핑 미확인 | `taxonomy_pending` 7일 이상 방치 | 0건 |
| SC3 | 알림 피로 | 실시간 텔레그램(긴급 제외) 하루 건수 | ≤ 3건 |
| SC4 | 보유 경고 지연 | 소스 알림 → JARVIS 보유 경고 발송 | ≤ 35분 |
| SC5 | 🟢 성과 | 🟢 진입 신호의 D+20 벤치마크 대비 초과수익 중앙값 | > 0% (2시즌 후) |
| SC6 | 🟢 조건 무결성 | M1~M5 중 하나라도 미충족인데 🟢로 발송된 건 | 0건 (테스트로 강제) |
| SC7 | 장부 단일성 | JARVIS가 보유 수량·원가를 쓰는 코드 경로 | 0개 |
| SC8 | 주간 메모 정시성 | 토 09:30 목표, 10:30까지 발행 | 4주 중 4회 |
| SC9 | 숫자 근거 | 주간 메모 숫자 중 fact table에 없는 값 | 0건 |
| SC10 | 링크 무결성 | 발송 링크 중 404·빈 화면 | 0건 (링크 스모크 테스트) |
| SC11 | 월 운영비 | LLM(주간 메모) + 인프라. M3 ② 수집은 $0 | ≤ $5 (추정) |
| SC12 | M3 ② 자동 채택 정확도 | 채택 항목 무작위 10건을 분기 1회 원문과 대조(증권사·산업·수치·발표일 모두 일치) | ≥ 9/10 |

---

## 1. 시스템 지형 — 6개 구성원의 역할과 경계

각 프로젝트는 **단독으로도 계속 사용**한다(자체 대시보드·봇 유지). JARVIS는 그 위의 **오버레이**다.

| 구성원 | 깔때기 단계 | 핵심 산출물 | 선행성 | JARVIS가 쓰는 것 |
|---|---|---|---|---|
| **Compounding FlyWheel** | 산업 서사 누적 | 산업별 연계종합, 신호강도 1~5, 주간 리포트 | 수주~수개월 | N축 신호, 주간 리포트 링크 |
| **Sage** | 멘토 컨센서스 | 멘토 stance, 멘토 수, 스코어카드 | 수주 | N축 신호(스코어카드 가중) |
| **HermesCall** | 미국 실적 → 수혜주 | F1~F4, 수혜강도, 딥분석, 어닝 캘린더 | 수일~수주 | C축, 미국 M1·M2·M5, 캐치업 후보, M4 이벤트 |
| **Heimdallr Call** | 국내 실적 확인 + 가격 | 게이트·점수, PRI, ★○△, 결과 추적, KIS 수급 | 공시 당일 | F·P축, 국내 M1·M2·M5, M3 산업 실측 성장, M4 이벤트 |
| **SnowBall Heritage** | 포트폴리오·결정 | 거래 기반 보유, 논지·훼손조건, 과열 점수, 리스크 경보, 결정 검증 | — | 보유 장부, 허용 비중, 과열, 레짐, M4 트리거 |
| **JARVIS** | 결합·판정·전달 | 행동 큐, 🟢 진입 신호, 브리핑, 주간 투자위원회, 신호원 성적표 | — | — |

### 1.1 JARVIS가 하지 않는 것
1. **보유 수량·원가·거래를 쓰지 않는다.** 장부는 SnowBall 단독이다. 편집은 SnowBall 딥링크로 보낸다.
2. **SnowBall 기능을 재구현하지 않는다.** 논지·훼손조건·결정 검증·과열 점수·리밸런싱은 읽어서 표시만 한다.
3. **자동 매매를 하지 않는다.** 모든 산출물은 알림이며 "매수 확정 신호 아님"을 명시한다.
4. **LLM이 만든 숫자로 판정하지 않는다.** 판정은 결정론적 규칙이다. LLM은 주간 메모 서술에만 쓴다. M3 ② 증권사 성장률도 LLM 없이 원문 문장에서 규칙으로 뽑는다.
5. **기존 프로젝트의 핵심 로직을 바꾸지 않는다.** 연결에 필요한 최소 계약만 요청한다.

---

## 2. 확정 결정사항 (ADR)

| ID | 결정 | 이유 |
|---|---|---|
| **D1** | 포트폴리오 단일 원장 = **SnowBall Heritage**(`/ironman/portfolio`, member_key=`ironman`). 구글 시트·FlyWheel `positions.json` 폐기 | 이중 장부 불일치 실측(`positions.json`은 8/4 1회 사본, 한국 25종목만, 수량 불일치) |
| **D2** | 산업 정본 = **노션 `2_1. 산업 & 종목`의 18개 카테고리(L1)** + `[산업]` 페이지(L2) | 사용자 지정. 2026-09-27 `1l. 자율주행차` 추가 반영 |
| **D3** | 매핑 = 키워드 일부 겹침 = 동일 산업 + 오탐 가드. **에너지 → 전력인프라, 자동차 → 자율주행차, 그 외 미매칭 → 기타** | 사용자 지정 |
| **D4** | Pull + 계약. 쓰기는 SnowBall `jarvis_submit_idea` RPC와 노션 Idea_Generating 행 추가뿐 | 회귀 위험 최소화 |
| **D5** | JARVIS DB = 신규 Supabase 프로젝트 `jarvis`(서울). 슬롯이 없으면 SnowBall DB의 `jarvis` 스키마(P0에서 결정) | Supabase 4개 사용 중 |
| **D6** | 판정은 결정론적, LLM은 주간 메모 서술만 + 숫자 grounding gate | Heimdallr canary 실측: LLM이 단위를 임의 환산해 품질 통과 0/4 |
| **D7** | 정시 실행 = pg_cron → GitHub `workflow_dispatch` | GitHub schedule이 수 시간 지연(FlyWheel·SnowBall 실측) |
| **D8** | 저장소 public, 비밀은 GitHub Secrets | 계정 공유 Actions 무료 분 보호 |
| **D9** | 전달 = **@Tonny_JARVIS_bot**(webhook) + JARVIS 대시보드(Vercel) | 사용자 지정 |
| **D10** | 원 프로젝트의 기술적 알림은 JARVIS 병행 2주 후 **텔레그램 발송만** 중단(DB 기록 유지) | 중복 알림 제거 |
| **D11** | 스택은 SnowBall과 동일(Next.js 15 + TS + Supabase + Tailwind v4 + vitest) | 유지보수 일관성 |
| **D12** | **🟢 진입 신호 = M1∧M2∧M3∧M4∧M5 필수**(사용자 지정). 실적 돌파(K1·H1)는 🔵 관찰로 두고, 이후 M1~M5 통과 시 🟢로 승격 | 돌파 당일에는 "조정·횡보"와 "MACD 교차 직전"이 구조적으로 성립하지 않는다 |
| **D13** | M1·M2·M5(종목 가격·실적·수급)는 **데이터를 가진 원 프로젝트**가 계산(국내 Heimdallr, 미국 HermesCall). M3·M4(교차 프로젝트 조건)와 최종 게이트는 **JARVIS**가 계산 | 한국 MACD·수급은 KIS 데이터를 가진 Heimdallr가 가장 정확하다. 산업 성장·이벤트는 여러 소스를 합쳐야 한다 |
| **D14** | 링크 규칙은 `config/links.yaml` 하나로 관리하고 텔레그램·대시보드가 공유. 만들 수 없는 링크는 버튼을 생략 | Heimdallr 교훈: 규칙이 갈라지면 둘 다 200이라 아무도 모른다 |
| **D15** | 미국 M5는 "매집일 대용"(종가↑ & 거래량 ≥ 20일 평균, 2일 연속) | 미국은 투자자별 일별 수급 미공개. 메시지에 명시하고 성과는 분리 집계 |
| **D16** | **M3 = 근거 3종 중 하나 이상**: ① 실제 실적(L1 매출 YoY 중앙값 ≥ 15% 2분기 연속) ② **미국 메이저 증권사** 산업 성장률 전망 ≥ 15%(발표 90일 이내, 자동 채택 규칙 통과) ③ `industry_growth.yaml` 전망 CAGR ≥ 15%(12개월 이내). 특정 근거를 필수로 바꾸려면 `rules.yaml > M3.required_bases` 한 줄만 수정 | 사용자 지정. 실적이 아직 안 찍힌 초기 고성장 산업도 증권사·전망 근거로 포착 |
| **D17** | ②는 **증권사 로그인·유료 리포트를 쓰지 않고** 무료 공개 검색으로 찾은 공개 자료만 쓴다. 인정 증권사는 **미국 메이저 6곳**(Goldman Sachs·Morgan Stanley·J.P. Morgan·BofA·Citi·Wells Fargo, 확장은 yaml 주석 해제), 발표 90일 이내 | 사용자 지정 |
| **D18** | SnowBall 연결은 검증된 SQL 초안 + 단계별 가이드로 진행하며, JARVIS P0의 선행 조건이다 | 장부 단일화(D1)의 전제 |
| **D19** | ② 수집·추출·채택은 **무료·완전 자동**이다. 검색은 무키 공개 소스(Google News RSS·Bing News RSS·GDELT·증권사 공개 인사이트 페이지), 추출은 **결정적 정규식(LLM·유료 API 금지)**, 채택은 **출처 등급(A 증권사 자체 도메인 / B 주요 경제 매체) + 교차 보도 규칙**으로 사람 확인 없이 한다(§7.3). v1.2의 Claude 웹 검색 도구·1탭 확인은 폐기 | 사용자 지정(무료·무탭). 인용문=원문 문장이라 숫자 환각 0, 대신 재현율 일부 손실은 ①·③이 보완 |

---

## 3. 아키텍처 · 데이터 흐름

```
┌──────────────────────── JARVIS Registry (공통 기준) ────────────────────────┐
│ taxonomy.yaml(노션 18 L1) · entities · rules.yaml(M1~M5) · links.yaml        │
│ industry_growth.yaml · industry_outlooks(무료 뉴스 검색 미국 증권사) · catalyst_cal.│
│ holdings_cache(SnowBall 읽기)                                                │
└──────┬──────────────┬──────────────┬──────────────┬─────────────────────────┘
       │ (JSON API 배포: taxonomy · holdings-lite · industry-heat · catalyst-watch)
┌──────▼─────┐ ┌──────▼─────┐ ┌──────▼──────────┐ ┌──────▼──────────┐ ┌───────────────┐
│ FlyWheel   │ │ Sage       │ │ HermesCall      │ │ Heimdallr       │ │ SnowBall      │
│ 연계종합   │ │ mentions   │ │ analyses·F1~F4  │ │ screen_results  │ │ jarvis_export │
│ 신호강도   │ │ scorecards │ │ entry_checks_us │ │ entry_checks_kr │ │ (보유·논지·   │
│            │ │            │ │ (M1·M2·M5 미국) │ │ (M1·M2·M5 국내) │ │  과열·트리거) │
│            │ │            │ │ catalyst_watch  │ │ 🔵 K1 돌파      │ │               │
└──────┬─────┘ └──────┬─────┘ └──────┬──────────┘ └──────┬──────────┘ └──────┬────────┘
       └──────────── Pull (30분, 미국 실적 창 15분) ──────────────────────────┘
                                   ▼
              ┌──────────────── JARVIS 수렴 엔진 ────────────────┐
              │ ① 수집·정규화 → signals   ② 엔티티·산업 매핑      │
              │ ③ 축 N/C/F/P/H + 레짐     ④ M3 실적·美증권사·전망 │
              │ ⑤ M4 6개월 이벤트 합집합  ⑥ 🟢 = M1∧M2∧M3∧M4∧M5 │
              │ ⑦ 행동 큐 · 게이트 · 중복 제거 · 발송 상한         │
              └──┬─────────────┬───────────────┬──────────────┬─┘
                 ▼             ▼               ▼              ▼
            대시보드    @Tonny_JARVIS_bot   FlyWheel 인박스   SnowBall
                        (6개 대시보드 +      (노션)           jarvis_submit_idea
                         네이버 · StockEasy)
                 └──────► 아이언맨: 판단·매매(SnowBall 입력) ──► 성과 귀속 → rules 보정
```

---

## 4. 공통 기준

### 4.1 산업 분류 (D2·D3)

#### 4.1.1 정본 (노션 실측, 2026-09-27 · 18개)
| L1 | 이름 | L2 (`[산업]` 페이지 = FlyWheel 산업) | 비고 |
|---|---|---|---|
| 1a | AI | AI | |
| 1b | 반도체 | 반도체 | |
| 1c | 전력인프라 | 전력인프라 | **에너지 포함**(사용자 지정) |
| 1d | 바이오 | 바이오 | |
| 1e | 화장품_미용기기 | 화장품, 미용기기 | |
| 1f | 엔터 | 엔터 | |
| 1g | 우주항공방산 | 우주항공, 방산 | |
| 1h | 조선 | 조선 | |
| 1i | 2차 전지 | 배터리 | |
| **1l** | **자율주행차** | (없음) | **신규. 자동차 포함**(사용자 지정) |
| 2a | Robot | Robot | |
| 2b | IT | IT | |
| 2c | 헬스케어 | 의료기기 | |
| 2d | 소비재 | 음식료 | |
| 2e | 여행 | 인바운드 | |
| 2f | 금융 | (없음) | |
| 2g | 건설 | (없음) | |
| 3c | 양자컴퓨터 | 양자컴퓨터 | |

- 특수 라벨(산업 집계 제외, 신호는 보존): `MACRO`(거시경제), `ETF`, `ETC`(기타).
- **기타로 간주**(사용자 지정): 소재, 화학·소재, 철강·금속, 운송·물류, 지주·기타서비스, 그리고 앞으로 어디에도 매핑되지 않는 새 라벨.
- 노션 페이지 ID·URL은 `taxonomy.yaml > notion`에 있다.

#### 4.1.2 내부 키
- 산업 키 = L1 코드(`1a`…`3c`). 이름이 바뀌어도 코드는 유지된다.
- 복수 소속을 허용한다(예: `AI 팹리스` → 1a+1b, `자동차·로봇` → 1l+2a). `primary_l1` = 가장 긴 일치 키워드.
- `taxonomy_sync`(주 1회 + 수동)가 노션 `2_1`의 카테고리 추가·변경을 감지해 `/taxonomy`에 변경 카드를 띄운다.

#### 4.1.3 매핑 알고리즘 — 참조 구현 `docs/reference/taxonomy_match_reference.py`
TS 구현 `lib/taxonomy/match.ts`는 참조 구현과 **동일한 결과**(`config/taxonomy_expected.json` 스냅샷)를 내야 한다.

1. **정규화**: 공백·`_`·`·`·`-`·`.`·`/` 제거, 영문 소문자.
2. **overrides**(정확 일치)가 최우선이다. 사용자 지정 기타 항목이 여기에 있다.
3. **특수 라벨**: 별칭과 정확히 일치하면 MACRO·ETF·ETC.
4. **포함 일치**: 키워드(L1 이름·`_` 조각·L2 이름·동의어, 2자 이상)가 라벨에 포함되거나 라벨이 키워드에 포함되면 일치.
5. **부분 일치**(사용자 규칙): 라벨과 **주 키워드**(L1 이름·조각·L2)의 최장 공통 부분문자열이 2자 이상이면 일치. 단 두 가지 예외가 있다.
   - 동의어에는 부분 일치를 적용하지 않는다(실측 오탐: 인바운드↔파운드리 "운드").
   - 일반어(`인프라, 기기, 부품, 소재, 장비, 산업, 서비스, 기타`)가 공통 부분이면 무시한다(실측 위험: 의료기기↔미용기기 "기기").
6. 어디에도 해당하지 않으면 **ETC**로 두고 `taxonomy_pending`에 올린다. 처음 보는 라벨의 부분 일치도 pending으로 확인받는다. 확정 결과는 overrides로 승격된다.

**결과**: 5개 프로젝트의 현재 라벨 **전부 매핑 완료, 미매칭 0건**(부록 A).

#### 4.1.4 각 프로젝트 산업명 수정 방침 (사용자 수정, `docs/INTEGRATION_TASKS.md`)
| 프로젝트 | 방침 |
|---|---|
| FlyWheel | 변경 없음(이미 L2). 노션에 `[산업] 자율주행차` 페이지를 만들면 `industries.json`에 추가 |
| HermesCall watchlist 13개 | **노션 L1 이름으로 교체**(부록 A.1) |
| Sage `SECTORS` 9개 | **노션 L1 18개 + MACRO + 기타로 교체** |
| Heimdallr Kairos 23개 | **노션 L1로 교체**, 기존 이름은 별칭으로 보존 |
| Heimdallr 투자 섹터 33개 | 이름 유지 + L1 매핑 컬럼(반도체 6단계 등 기능 해상도 보존) |
| SnowBall 섹터 28개 | 이름 유지 + `industry_l1` 파생(섹터 집중도 계산 해상도 보존) |

### 4.2 종목 마스터 (entities)
- 키: 국내 `KR:000660`, 해외 `US:NVDA`.
- 원천 우선순위: SnowBall `assets_master`(별칭·초성) → Heimdallr `krx_universe` → HermesCall watchlist.
- 종목의 L1 결정 순서: overrides → SnowBall `assets.sector` → Heimdallr 투자 섹터 → HermesCall watchlist → 제품 설명 키워드.
- 링크용 보조 필드: `naver_us_code`(NVDA.O 등, 30일 캐시), `snowball_asset_id`, 최신 `hermes_analysis_id`.

### 4.3 보유 장부 (D1)
- 원천은 SnowBall(member `ironman`). `jarvis_export_*` RPC로만 읽는다.
- 캐시는 `jarvis.holdings_cache`이며 07:10·16:10에 갱신한다.
- 다른 프로젝트에 주는 것은 금액 없는 `holdings-lite`뿐이다: entity, 이름, l1, 비중 구간.

---

## 5. 데이터 계약

> 모든 외부 읽기는 `lib/ingest/<source>.ts` 어댑터 뒤에 둔다. 어댑터는 예외를 올리지 않고 `{ok:false, reason}`을 반환하며, 누락 컬럼을 견딘다.
> P0에서 소스별 anon SELECT 가능 여부를 실측하고, 불가하면 해당 프로젝트에 읽기 전용 RPC를 요청한다.

### 5.1 SnowBall Heritage — 토큰 RPC (`0019_jarvis_contract.sql`)
| RPC | 반환 | 용도 |
|---|---|---|
| `jarvis_export_positions(p_token)` | ironman 보유 전 종목. 코드/티커, 시장, 이름, sector, industry_l1, 수량, 평단, 평가액, 비중, allowed_weight, heat_score·breakdown, 최신 논지(버전·본문·확신도·훼손조건 3), 대기 트리거 수, 최근 결정, **asset_id** | 보유 경고·익절·오버레이·링크 |
| `jarvis_export_watchlist(p_token)` | watch_only 자산 + ideas(watching/reviewed) | 관찰 종목 |
| `jarvis_export_triggers(p_token, p_horizon_days)` | triggers(direction·category·expected_date·status·one_line·source_url) | **M4** |
| `jarvis_export_macro(p_token)` | REGIME·USDKRW·US_10Y·HY_SPREAD 등 | 레짐 |
| `jarvis_export_risk_alerts(p_token, p_since)` | 미확인 risk_alerts | 보유 경고 |
| `jarvis_export_performance(p_token, p_from, p_to)` | 주간 수익률·기여 | 주간 메모 |
| **`jarvis_submit_idea(p_token, p_payload)`** | idea id | 🟢·🎯·🔭 후보를 draft로 제출(payload.source=`jarvis`). 자산이 없으면 watch_only 생성 |

> JARVIS는 SnowBall의 **매수 강제 규칙(논지·훼손조건·확신도)을 우회하지 않는다.** draft → 채택 → 논지 승격 → 매수 폼 순서만 탄다.
>
> **구현물**: `docs/snowball/0019_jarvis_contract.sql`(2026-09-27 로컬 PostgreSQL 16에서 SnowBall 0001·0004·0017 위에 적용·기능 검증 완료) · **절차**: `docs/SNOWBALL_SETUP_GUIDE.md`(작업 트리 정리 → Claude Code 작업 → 토큰 생성 → SQL Editor 실행 → 검증 → 배포 → JARVIS 환경변수).
> 응답은 모두 `jsonb`다. 트리거 방향은 SnowBall enum 그대로 `positive`/`negative`이며, 훼손조건 3번은 선택 입력이다(0004).

### 5.2 Heimdallr Call
| 객체 | 용도 |
|---|---|
| `screen_results` (gate·score·delta·pri·grade·base_effect) | F·P축 |
| `price_snapshots` (수익률·52주·RSI·수급·발표 반응) | 게이트·주간 메모 |
| `quarterly_fundamentals` (매출·영업이익 YoY, TTM) | **M3 산업 실측 성장 집계** |
| **신규 `entry_checks`** (국내 M1·M2·M5 판정 + 근거 수치 + 태그 + 무효화가) | **🟢 판정 입력** |
| `notifications` (flash/daily/upgrade + **신규 `earnings_breakout`**) | 🔵 K1, 발송 중복 방지 |
| `analyses` (★○ 트리거·시나리오) | **M4** |
| `outcome_tracking`, `krx_universe`, `index_snapshots`, `dashboard/lib/macro-daily.json` | 성과·마스터·벤치마크·레짐 |

### 5.3 HermesCall
| 객체 | 용도 |
|---|---|
| `analyses`·`beneficiaries` (strength·triggers_timeline·industry_sentiment) | C축, **M4** |
| `quarterly_metrics` (F1~F4, 매출·영업이익 YoY) | F축(미국), **M3 미국 집계** |
| `earnings_events` | 캘린더, 폴링 창, M4(실적일) |
| **신규 `entry_checks_us`** (미국 M1·M2·M5 대용) | **🟢 판정 입력** |
| `technical_ideas` (+ `setup='H1'` 🔵) | 🔵 H1 |
| **신규 `catalyst_watch`** | 태그 CU, **M4** |

### 5.4 Sage — `mentions`, `mentor_scorecards`, `strategy_reports`, `mentors` (N축, 주간 메모)
### 5.5 FlyWheel (노션) — 산업별 모니터링 DB의 최신 연계종합(신호강도), Invest_WiKi 14일(수혜 기업), 주간 리포트 URL / **쓰기: Idea_Generating 인박스**
> P0에서 연계종합 행의 신호강도 속성명·형식을 실측해 어댑터에 고정한다.

### 5.6 무료 공개 검색 — 미국 메이저 증권사 산업 성장률 (M3 근거 ②, D19)
- **비용 $0, API 키 없음.** 유료 검색 API·Claude 웹 검색 도구·증권사 로그인·유료 리포트는 쓰지 않는다. 실행은 JARVIS GitHub Actions(public 저장소, 무료 분)다.
- **소스 4종**(어느 하나가 막혀도 나머지로 진행, 설정은 `industry_growth.yaml > news_search`):

| 소스 | 호출 | 기간 제한 | 비고 |
|---|---|---|---|
| Google News RSS | `https://news.google.com/rss/search?q={q}+when:90d&hl=en-US&gl=US&ceid=US:en` (한국어: `hl=ko&gl=KR&ceid=KR:ko`) | `when:90d` | 항목 링크는 news.google.com 경유 → 원문 URL 해제 필요. 해제 실패 시 제목·매체로 Bing·GDELT에서 원문 URL을 찾는다 |
| Bing News RSS | `https://www.bing.com/news/search?q={q}&format=rss` | pubDate로 90일 필터 | Sage `discovery.py`가 Actions에서 이미 사용 중(실측 동작) |
| GDELT DOC 2.0 API | `https://api.gdeltproject.org/api/v2/doc/doc?query={q}&mode=artlist&format=json&timespan=3m&maxrecords=75` | `timespan=3m` | 5초에 1회 제한 준수, 429면 지수 백오프 후 건너뜀 |
| 증권사 공개 인사이트 페이지 | `broker_sites`(예: morganstanley.com/insights/articles, jpmorgan.com/insights/global-research, goldmansachs.com/insights)의 목록·sitemap | lastmod 90일 | 공개 페이지만. P0에서 목록 URL·sitemap을 실측해 yaml에 고정 |

- **대상 자료**: 최근 90일 이내 발표된 공개 자료. 증권사 자체 공개 페이지(등급 A)와 주요 경제 매체 보도(등급 B)만 채택 후보다. 그 외 도메인(블로그·코인 거래소 뉴스·보도자료 배포처 등)은 채택하지 않는다.
- **예절**: robots.txt 준수, User-Agent에 `JARVIS-research (+저장소 URL)` 명시, 도메인당 2초 간격, 원문은 판정용 문장만 저장(본문 전체 저장 금지).

### 5.7 JARVIS가 배포하는 JSON API (헤더 `X-Jarvis-Token`, 민감정보 없음)
| 경로 | 소비자 | 내용 |
|---|---|---|
| `/api/public/taxonomy` | 전 프로젝트 | L1/L2·동의어·overrides·노션 URL |
| `/api/public/holdings-lite` | FlyWheel | 금액 없는 보유 |
| `/api/public/industry-heat` | Heimdallr·HermesCall | L1별 N·C 점수, **M3 통과 여부와 근거 3종(① 실측 중앙값·표본 ② 채택 증권사·값·발표일 ③ 전망 CAGR)**, 기준일 |
| `/api/public/catalyst-watch` | Heimdallr | 캐치업 후보(태그 CU) |

---

## 6. 신호 정규화 · 수렴 엔진 · 행동 큐

### 6.1 신호 표준 형식 (`jarvis.signals`)
`id, source, source_ref, kind, entity_id(null=산업), l1_codes[], direction(+1/0/−1), strength(0~10), observed_at, expires_at, evidence(jsonb 원문 필드), dedupe_key UNIQUE`

| kind | 소스 | 정규화(rules.yaml `normalize`) | 유효 |
|---|---|---|---|
| industry_narrative | FlyWheel 연계종합 | 신호강도×2 | 14일 |
| company_mention_fw | FlyWheel WiKi | 언급 1·2·3건 → 4·6·8 | 14일 |
| mentor_consensus | Sage | 강세 멘토 수(Sage 점수 ≥ 50만) 2·3·4+ → 6·8·10, 약세는 −1 | 30일 |
| earnings_catalyst | HermesCall 수혜 | strength | 60일 |
| earnings_quality_us | HermesCall F1~F4 | 충족×2.5 | 90일 |
| industry_sentiment | HermesCall | 긍정/부정 순합 | 30일 |
| accel_grade | Heimdallr | ★10 ○7 △5 ·2 (기저효과 −2) | 다음 분기 |
| price_reflection | Heimdallr PRI | 값 | 1일 |
| entry_check | Heimdallr·HermesCall | M1·M2·M5 판정 + 근거 | 1거래일 |
| breakout_watch | Heimdallr K1·HermesCall H1 | 🔵 이벤트 | 60거래일 |
| holding_risk | SnowBall | severity | 확인 시까지 |

### 6.2 종목별 축 (합산하지 않는다)
| 축 | 켜짐 기준(초기값) |
|---|---|
| **N** 서사 | L1 industry_narrative ≥ 8 **또는** company_mention_fw ≥ 6 **또는** mentor_consensus ≥ 6 |
| **C** 촉매 | earnings_catalyst ≥ 7(60일) **또는** 미국 F1 또는 F2 |
| **F** 숫자 | 국내: gate_passed & score ≥ 75 / 미국: F3 & F4 |
| **P** 가격 | 국내 PRI / 미국 `pri_us_lite`(§7.6) |
| **E** 진입 | M1~M5 판정 결과(🟢/🟡/없음) — §7 |
| **H** 보유 | SnowBall 보유·비중·allowed_weight·heat |

### 6.3 레짐 게이트
`risk_off` = SnowBall REGIME = −1 **또는** (VIX ≥ 25 **그리고** KOSPI < 60일선).

risk_off일 때 적용되는 제한:
- 🟢의 1차 비중을 절반으로 줄인다.
- 🟢는 국내 ★ 또는 미국 F1&F3&F4인 종목만 허용한다.

### 6.4 행동 큐 (위에서부터 판정, 한 종목은 가장 높은 큐 1개)
| 큐 | 조건 | 산출 |
|---|---|---|
| ⚠️ 보유 경고 | 보유 **그리고** 다음 중 하나<br>· 훼손조건 매칭 트리거<br>· Heimdallr 등급 하락 또는 score_delta ≤ −5<br>· 해당 종목 또는 미국 대장주 가이던스 컨센 하회<br>· FlyWheel 불리 강도 3<br>· 강세→약세 전환 멘토 ≥ 2<br>· 진입 20거래일 내 무효화선 이탈 | 실시간 + 최상단 |
| 💰 익절 검토 | 보유 **그리고** heat ≥ 76 **그리고** PRI(또는 pri_us_lite) ≥ 75 | SnowBall 익절 사다리 |
| 🎯 매수 검토 | F **그리고** P < 40 **그리고** (N 또는 C) = 서로 다른 계열 2개 이상 합의 | 🟢 진입 신호(§7) 여부 표시 |
| 🔭 선행 레이더 | N **그리고** C **그리고** F 없음 **그리고** 다음 실적 ≤ 45일 | 실적 전 관찰 |
| ⏳ 눌림 대기 | F **그리고** P ≥ 65 **그리고** (N 또는 C) | PRI < 50 또는 승격 시 알림 |

- 🟢는 🎯 안에서만 나오는 것이 아니다. **M1~M5를 모두 충족하면 큐와 무관하게 🟢**다. M1이 F와 P를 사실상 포함한다. 🟢 종목은 🎯 카드 최상단에 표시한다.
- 🎯·🔭·🟢에 처음 진입한 종목은 SnowBall draft로 제출한다(하루 최대 3).

---

## 7. 진입·청산 타이밍 — 필수 조건 M1~M5와 프로젝트별 역할

### 7.1 원칙
1. **🟢 진입 신호 = M1 ∧ M2 ∧ M3 ∧ M4 ∧ M5 + 진입 게이트.** 하나라도 빠지면 🟢가 아니다(SC6, 테스트로 강제).
2. **🟡 관찰** = M1 ∧ M2 그리고 M3·M4·M5 중 2개 이상. 대시보드와 저녁 브리핑 목록에만 올리고 실시간 알림은 보내지 않는다.
3. **🔵 실적 돌파 관찰**(K1 국내·H1 미국)은 **진입 신호가 아니다.** 돌파 당일에는 "조정·횡보"와 "MACD 교차 직전"이 구조적으로 성립하지 않기 때문이다. 60거래일 안에 그 종목이 M1~M5를 통과하면 태그 `PEAD_PB`(실적 돌파 후 눌림)로 🟢가 된다. 실적 발표 후 드리프트와 눌림 진입을 결합하는 구조다.
4. **계산 위치(D13)**
   - 국내 M1·M2·M5 → Heimdallr `entry_checks`
   - 미국 M1·M2·M5 → HermesCall `entry_checks_us`
   - M3·M4·게이트 → JARVIS
5. **분할 진입**: 1차 1/3 → 확인(무효화선 위 5거래일 유지 또는 20일선 회복) 1/3 → 다음 실적 확인 1/3. 상한은 SnowBall `allowed_weight`.
6. **모든 🟢는 무효화선**을 가진다. 이탈하면 ⚠️ 보유 경고로 연결한다.

### 7.2 역할 배정

| 구분 | 국내 | 미국 | 비고 |
|---|---|---|---|
| M1 실적 지속·가속 + 주가 미반영 | Heimdallr | HermesCall | 분기·TTM·(연간 컨센)·PRI |
| M2 MACD 상향 교차 직전 | Heimdallr | HermesCall | 일봉 MACD(12,26,9) |
| M3 산업 고성장 | JARVIS | JARVIS | ① 실제 실적 ② 미국 메이저 증권사 전망(무료 검색·자동 채택) ③ 전망 — 하나 이상 |
| M4 6개월 내 상승 이벤트 | JARVIS | JARVIS | 5개 소스 합집합 |
| M5 매수 수급 2일 연속 | Heimdallr (KIS) | HermesCall (대용) | 미국은 투자자별 일별 수급 미공개 |
| 🔵 실적 돌파 | Heimdallr K1 | HermesCall H1 | 진입 아님, 무장(arm) |
| 태그 CU(캐치업) | HermesCall 후보 → JARVIS 태그 | — | M4 이벤트도 제공 |
| 청산·축소 | SnowBall 과열·훼손조건 + JARVIS 근거 결합 | 동일 | §7.5 |

> 기존 중복 해소: HermesCall `idea_scanner`의 **한국 수혜주 기술적 알림**과 Heimdallr `technical_setup` 알림이 같은 한국 종목에 규칙을 달리해 각각 하루 2건씩 나가던 구조를 정리한다. 한국 종목은 Heimdallr `entry_checks` 한 곳으로 통일하고, HermesCall은 미국 종목 판정과 한국 종목 촉매(CU)만 맡는다.

### 7.3 필수 조건 정의 (임계값은 `rules.yaml > entry_core`)

#### M1 — 실적은 지속 증가·성장 가속, 주가는 미반영(조정 또는 횡보)
모두 충족해야 한다.

1. **분기 지속 증가**: 최근 2개 분기 연속 매출 YoY > 0 **그리고** 영업이익 YoY > 0. 최근 분기 영업이익은 흑자여야 한다(부호 전환 구간 제외).
2. **성장 가속**: 매출 YoY(t) > 매출 YoY(t−1) **그리고** 영업이익 YoY(t) > 영업이익 YoY(t−1).
3. **연간 증가**
   - TTM 매출·영업이익이 4분기 전 TTM보다 크다.
   - 연간 컨센서스가 있으면(국내 네이버 기업실적분석, 미국은 가능한 소스) 올해(E) 매출·영업이익 > 전년 확정.
4. **품질**: Heimdallr `base_effect_warning = false`(국내). 미국은 2년 스택 매출 성장률이 개선 중이어야 한다.
5. **주가 미반영**: 아래 a·b 중 하나 **그리고** c.
   - a. **조정**: 최근 실적 발표 후 고점 대비 ≤ −10% **또는** 52주 고점 대비 ≤ −15%
   - b. **횡보**: 최근 20거래일 종가 범위 ≤ 12% **그리고** |20일 수익률| ≤ 5%
   - c. **반영도 낮음**: 국내 PRI < 50, 미국 `pri_us_lite` < 50

- 태그: a를 충족하면 `PB`(눌림), b를 충족하면 `SW`(횡보).
- 데이터
  - 국내: `quarterly_fundamentals`(revenue_yoy, op_yoy, ttm_*), `consensus_snapshots`, `price_snapshots`, `screen_results.pri`
  - 미국: `quarterly_metrics` 8개 분기(TTM은 합산 계산), 일봉

#### M2 — MACD가 Signal을 아래에서 위로 상향 교차하기 직전
모두 충족해야 한다.
- MACD(12,26,9) < Signal
- 히스토그램(음수)이 **2일 연속 개선**
- 다음 중 하나
  - (Signal − MACD) / 종가 ≤ **0.30%**
  - 최근 히스토그램 기울기로 추정한 교차까지 **≤ 3봉**

당일 교차(어제 히스토그램 < 0, 오늘 ≥ 0)도 허용하되 "크로스 당일"로 표시한다. 교차 후 2일 이상 지난 종목은 제외한다(추격 방지).

#### M3 — 해당 산업이 높은 성장 중 (근거 3종 중 하나 이상, D16)
종목의 L1 산업이 다음 **① ② ③ 중 하나 이상**을 충족하면 통과다. 복수 L1 종목은 어느 L1이든 충족하면 통과로 보고, **충족한 근거를 모두 표시**한다(예: "실적 ✓ · Morgan Stanley 22% ✓").

| 근거 | 기준 | 신선도 | 계산·수집 |
|---|---|---|---|
| **① 실제 실적** | L1 소속 기업 매출 YoY **중앙값 ≥ 15%**, 최근 **2개 분기 연속**, 영업이익 YoY 중앙값 > 0. 표본은 국내 시총 1,000억원 이상 + 미국 HermesCall watchlist, 최소 5개(부족하면 국내+미국 합산, 그래도 부족하면 ①은 "판단 불가") | 최신 확정 분기 | JARVIS `industry_growth_realized`(매일 07:00·19:00). 원천: Heimdallr `quarterly_fundamentals` + HermesCall `quarterly_metrics` + 엔티티 L1 |
| **② 미국 메이저 증권사 산업 성장률 전망** | `us_major_brokers`(Goldman Sachs·Morgan Stanley·J.P. Morgan·BofA·Citi·Wells Fargo)가 제시한 해당 산업·세부시장의 **CAGR(종료 연도 ≤ 올해+5) 또는 내년 성장률**. L1별로 증권사마다 최신 채택값 1개를 고르고 그 **중앙값 ≥ 15%** | 발표일 **90일 이내**(최근 3개월) | 자동: **무료 검색**(§5.6) → 원문 수집 → **정규식 추출** → **자동 채택 규칙** → 90일 만료. 사람 확인 없음. 수동: `industry_growth.yaml`에 `source_type: broker`로 직접 입력(URL·발표일 필수) |
| **③ 성장 전망** | `industry_growth.yaml`의 출처 있는 3년 CAGR ≥ 15%(시장조사기관·기업 IR·정부 등) | 기준월 12개월 이내 | 사용자·Kairos 산업 분석 결과를 입력 |

**② 자동 수집 파이프라인** — `industry_outlook_collect`, 매주 일·수 04:00(무료라 주 2회). **사람 확인 단계 없음, LLM 없음, 비용 $0**
1. **검색**: L1별 `segments_en`·`segments_ko` × 증권사 묶음 쿼리로 §5.6의 4개 소스를 부른다.
   - 쿼리 예: `"AI chips" ("Goldman Sachs" OR "Morgan Stanley" OR "J.P. Morgan" OR "Bank of America" OR Citi OR "Wells Fargo") (CAGR OR "to grow" OR forecast)`
   - 결과는 URL 정규화(추적 파라미터 제거) 후 합치고, 발표일이 90일을 넘는 항목은 버린다.
2. **원문 수집**: 기사 HTML을 직접 받아 `@mozilla/readability`로 본문만 뽑는다. 받을 수 없거나 유료벽·로그인 화면이면 폐기한다.
   - **발표일 확정**: RSS `pubDate`·GDELT `seendate`와 본문 메타(`article:published_time`, JSON-LD `datePublished`, `<time datetime>`)를 대조한다. 3일 넘게 다르면 더 이른 날짜를 쓴다. 본문 메타가 없으면 등급 A만 목록 날짜를 인정하고 등급 B는 폐기한다.
3. **결정적 추출**(`lib/engine/outlook/extract.ts`, 정규식·사전만): 문장 단위로 아래를 **모두** 만족해야 후보다.
   - **증권사**: 같은 문장에 `us_major_brokers` 이름·별칭이 있다. 또는 바로 앞 문장에 있고 이 문장이 지시어(the bank·the firm·its analysts·이 증권사·동사)로 시작한다(최대 1문장 거리).
   - **산업**: 시장 명사(market·industry·sector·spending·demand·capex·TAM·shipments·시장·산업·수요·투자) + L1 키워드(taxonomy 동의어 + `segments_en/ko`)가 같은 문장에 있다.
   - **성장 수치**: `growth_patterns`의 패턴과 %가 있다(CAGR·compound annual·annually·a year·per year·next year·in 20XX·through/by 20XX·연평균·매년·내년·성장). 범위 "20~25%"는 하한, "more than 15%"는 15를 쓴다. 0 < 값 ≤ 200.
   - **파생 CAGR**: "from $A (in YYYY) to $B by YYYY"처럼 두 금액과 두 연도가 **같은 문장**에 있으면 CAGR을 코드로 계산해 `metric=CAGR_DERIVED`로 저장한다.
   - **제외**: 목표주가·주가·shares·EPS·earnings·실적·영업이익, 엔티티 마스터 기업명·티커가 주어인 매출 수치, 지수(S&P 500·KOSPI 등), GDP·인플레이션·금리, 과거 실적("grew", "rose", "증가했다" 등 과거 시제만 있는 문장).
   - **기간**: CAGR 종료 연도 ≤ 올해+5, 내년 성장률은 `NEXT_YEAR`. 기간을 못 읽으면 폐기.
   - **quote = 원문 문장 그대로**다(생성·요약하지 않음). 그래서 수치 환각이 구조적으로 발생하지 않는다.
4. **L1 확정**: 문장 속 산업 구절을 `match.ts`(taxonomy)로 매칭한 결과를 쓴다(검색한 L1이 아니라 **문장 기준**). 매칭 없음·복수 L1 모호면 `unverified`.
5. **자동 채택**(`lib/engine/outlook/adopt.ts`) — 아래 중 하나를 만족하면 `status=adopted`, 아니면 `unverified`(표시만, 판정 미사용):
   - **A1**: 등급 A(증권사 자체 도메인, `domain_tiers.A`) 단독.
   - **B1**: 등급 B(주요 경제 매체, `domain_tiers.B`) **서로 다른 매체 2곳 이상**이 같은 증권사·같은 L1·값 ±2%p로 보도. 통신사 전재·신디케이션(문장 유사도 ≥ 0.9)은 1곳으로 센다.
   - **B2**: 등급 B 단일 매체라도 문장에 증권사 이름 + `CAGR`·`compound annual`·`연평균` + 기간(연도 범위)이 **모두 명시**된 경우.
   - **충돌**: 같은 증권사·L1의 채택값이 5%p 이상 다르면 최신값을 쓰고 `conflict` 표시.
   - **수동 제외(선택, 탭 아님)**: `industry_growth.yaml > excluded_outlooks`에 URL을 적으면 다음 실행부터 `excluded`. 안 적어도 전 과정이 자동으로 돈다.
6. **집계**: L1별로 증권사마다 최신 adopted 값 1개 → 중앙값 ≥ 15%면 ② 통과. `industry_heat.m3_basis`에 사용 증권사·값·발표일을 남긴다.
7. **만료**: 발표일이 90일을 넘으면 자동 `expired`. 다음 수집이 최신 자료로 대체한다.
8. **사후 감사(정보용)**: 새로 채택·만료된 근거는 토요일 주간 메모 Ⅱ-3에 원문 문장·링크와 함께 나열한다. 분기 1회 채택 10건 무작위 대조(SC12).
9. **실패 처리**: 한 소스가 실패해도 나머지로 진행한다. 4개 소스가 모두 2회 연속 실패하면 🔧 시스템 이상 알림. 이때 기존 adopted 값은 90일 만료 전까지 유지된다.

- ①·②·③이 모두 없거나 만료된 산업은 `/growth`와 주간 메모에 **"성장 근거 없음"** 목록으로 표시해 자료 보강을 요청한다.
- 현재 `industry_growth.yaml`의 ③ 초기값은 반도체(30%)·AI(15.7%)·전력인프라(27%) 3개다. 나머지는 ①과 ②로 판단된다.

#### M4 — 산업 또는 기업의 주가 상승 이벤트가 향후 6개월(180일) 내
아래 소스 중 **날짜 또는 기간 끝이 오늘+180일 이내**이고 **출처가 있는** 상승 방향 이벤트가 1개 이상 있어야 한다.

| 소스 | 이벤트 |
|---|---|
| SnowBall `triggers` | direction 상승, status waiting/imminent, expected_date ≤ 180일 |
| HermesCall `beneficiaries.triggers_timeline` | `1Q_내`·`2Q_내` 항목(분석일 기준 90·180일로 환산) |
| HermesCall `catalyst_watch` | 대장주 이벤트 후속(캐치업 기간) |
| Heimdallr `analyses` | ★○ 분석의 트리거 목록(3개월 내 트리거) |
| 실적 일정 | 다음 실적 발표 ≤ 180일 **그리고** 최근 30일 컨센서스(영업이익·EPS) 상향 |
| `config/catalyst_calendar.yaml` | 산업·기업 이벤트(수동) |

기업 이벤트 또는 그 종목 L1의 산업 이벤트 어느 쪽이든 인정한다. 메시지에는 **가장 가까운 이벤트 1~2개**(날짜·내용·출처)를 표시한다.

#### M5 — 외국인 또는 기관 매수 우위 최소 2거래일 연속
- **국내**(KIS 투자자별 매매)는 다음 중 하나를 충족해야 한다.
  - 외국인 2일 연속 순매수
  - 기관 2일 연속 순매수
  - 외국인+기관 합산 2일 연속 순매수

  어떤 경로로 통과했는지 표시한다(예: "외국인 3일 연속").
- **미국**: 투자자별 일별 수급이 공개되지 않으므로 **매집일 대용**을 쓴다. 매집일 = 종가 상승 **그리고** 거래량 ≥ 20일 평균. 2일 연속이면 통과로 보고 "수급 대용(미국)"으로 표시한다.

#### 진입 게이트 (M1~M5 통과 후)
1. PRI(또는 pri_us_lite) < 50을 재확인한다.
2. 레짐 제한(§6.3)을 적용한다.
3. SnowBall allowed_weight 여유가 없으면 🟢 대신 "비중 한도"로 표시한다.
4. 같은 종목은 14거래일 내 재발송하지 않는다.
5. 하루 🟢 상한은 한국 2건 + 미국 1건이다. 초과분은 대시보드에만 둔다.
6. 우선순위: 신호 계열 수 → 낮은 PRI → M3 충족 근거 수·성장률 → 가장 가까운 M4 이벤트. 태그별 표본이 30건을 넘으면 성과 순위로 교체한다.

#### 무효화선
| 태그 | 무효화 |
|---|---|
| PB | 10일 최저가 |
| SW | 20일 최저가 |
| CU | 신호일 저가, 또는 대장주가 이벤트일 종가 하회 |
| PEAD_PB | 돌파일(D0) 저가 |

### 7.4 🔵 실적 돌파 관찰 (진입 아님)
- **K1 국내(Heimdallr)**
  - 대상: 잠정실적 공시로 ★·○, 기저효과 경고 없음
  - D0(공시 후 첫 정규장) 조건: (시가 ≥ 전일종가×1.03 **또는** 종가수익률 ≥ +5%) **그리고** 거래량 ≥ 20일 평균×2.5 **그리고** 종가위치 ≥ 0.7
  - 기록: `notifications.kind='earnings_breakout'`
- **H1 미국(HermesCall)**
  - 대상: F1(EPS 서프라이즈 ≥ +3%) **그리고** F2(가이던스 > 컨센)
  - D0 조건: 갭 ≥ +4%(시총 $200B+는 +3%) **그리고** 거래량 ≥ 20일 평균×2 **그리고** 종가위치 ≥ 0.7
  - 기록: `technical_ideas.setup='H1'`
- 🔵는 저녁(국내)·아침(미국) 브리핑에 1줄로 알리고 60거래일 동안 무장한다. 이후 M1~M5가 통과하면 `PEAD_PB` 🟢가 된다.

### 7.5 청산·축소 (SnowBall 신호 + JARVIS 근거 결합)
| 조건 | 대응 |
|---|---|
| heat ≥ 76 + PRI ≥ 75 | 💰 1/3 익절 검토 |
| heat ≥ 76 + 서사 약화(N OFF 전환) | 💰 1/2 익절 검토 |
| 훼손조건 매칭 | ⚠️ 논지 재검토 → SnowBall 결정 기록 |
| 🟢 진입 20거래일 내 무효화선 이탈 | ⚠️ 손절 검토 |
| 드로다운 −20%(SnowBall 규칙) | ⚠️ 재검토 |
| 미국 대장주 가이던스 컨센 하회(공급망 보유 종목) | ⚠️ 체인 리스크 |

### 7.6 미국 가격 위치 `pri_us_lite` (JARVIS 계산, "간이" 표시)
가중치: 52주 위치 30% · 3M S&P 500 대비 초과수익 백분위 25% · RSI(14) 20% · 50일선 이격 15% · 발표 후 반응 10%.

---

## 8. JARVIS 대시보드 (Vercel, 모바일 우선)

- **인증**: Supabase Auth 매직링크, 허용 이메일 1개(`ALLOWED_EMAIL`). `/api/public/*`는 토큰으로, webhook은 `secret_token`으로 보호한다.
- **링크**: 모든 종목 카드와 상세 화면에 `config/links.yaml`의 종목 링크 세트(§9.4)를 텔레그램과 **같은 함수**로 표시한다.

| 경로 | 이름 | 내용 |
|---|---|---|
| `/` | 오늘 | 레짐 띠 → ⚠️ → 💰 → 🟢(M1~M5 체크 표시) → 🎯 → 🟡 → 🔭 → ⏳ → 🔵 |
| `/portfolio` | 포트폴리오 × 신호 | SnowBall 보유(읽기 전용) + 종목별 Heimdallr 등급·PRI, HermesCall 최근 이벤트, FlyWheel 산업 신호, Sage 컨센서스, 과열·논지, 비중 vs 허용, M1~M5 현황 |
| `/stock/[id]` | 종목 통합 | 5개 소스 신호 타임라인, 가격 차트(MACD·무효화선), **M1~M5 체크리스트와 근거 수치**, M4 이벤트 목록, 링크 버튼 전체, [SnowBall 아이디어로 보내기] |
| `/entry` | 진입 보드 | 🟢·🟡·🔵 목록. 조건별 ✔/✘, 무효화선, 1차 비중, 진입 후 경과 |
| `/radar` | 산업 레이더 | L1 18개 히트맵: M3 근거 3종 통과 여부(실적 중앙값·미국 증권사 전망·전망 CAGR), FlyWheel 신호강도, Sage 멘토, HermesCall 센티먼트, ★○ 수, 바스켓 1W/1M |
| `/weekly` | 주간 투자위원회 | 메모 아카이브, 지난주 결정 리뷰 |
| `/scorecard` | 신호원 성적표 | 소스·태그·멘토·등급별 적중률, D+5/20/60 초과수익, 내 결정 vs 시스템 |
| `/growth` | 산업 성장 근거(보기 전용) | L1 18개 × 근거 3종(①실적 중앙값·표본 ②미국 증권사·수치·발표일·**원문 문장**·출처 링크·등급·채택 규칙(A1/B1/B2) ③전망) 매트릭스, `unverified` 후보(참고용), 만료·근거 없음 목록, 소스별 최근 수집 결과. **확인 버튼 없음**(자동 채택) |
| `/taxonomy` | 산업 매핑 | pending 1탭 확정, 노션 변경 감지 |
| `/health` | 시스템 상태 | 6개 파이프라인 실행·실패·비용, 소스별 마지막 수집, 링크 스모크 테스트 결과 |

구현 규칙은 다섯 가지다.
- 페이지는 JARVIS DB만 읽는다(외부 호출은 배치 전용).
- 부분 결측은 필드 단위로 방어한다.
- 모든 카드에 기준 시각을 표시한다.
- 목록은 `range()` 페이징한다.
- 숫자는 공용 포맷터로 표시한다.

---

## 9. 텔레그램 @Tonny_JARVIS_bot

### 9.1 원칙
- webhook `/api/telegram/webhook`, `secret_token`을 검증한다. 허용 chat_id 1개 외 메시지는 무시한다. **다른 프로젝트 봇 토큰은 절대 쓰지 않는다.**
- 발송 간격 1초, 429 `retry_after`를 존중한다. 4,096자를 넘으면 분할한다. 실패해도 파이프라인은 계속한다.
- parse_mode는 HTML이다. 사용자 입력·종목명은 escape한다.

### 9.2 메시지 종류
| 종류 | 시각(KST) | 내용 |
|---|---|---|
| ☀️ 아침 브리핑 | 07:30 | 미국 마감(지수·VIX·섹터), 밤사이 HermesCall 실적, **미국 🟢/🟡/🔵**, 보유 영향, 오늘 한국 일정 |
| 🌙 저녁 브리핑 | 19:20 | 한국 마감(지수·수급), Heimdallr ★○, **국내 🟢/🟡/🔵**, 보유 경고 요약, 내일 일정 |
| 🟢 진입 신호 | 즉시(판정 직후) | 종목 1개당 1메시지, M1~M5 근거, 무효화선, 1차 비중, 종목 링크 세트 |
| ⚠️ 긴급 | 폴링 주기 내 | 보유 경고 |
| 🏛️ 주간 투자위원회 | 토 09:30 | §10 요약 + 전문 링크 |
| 📊 신호원 성적표 | 분기 첫 토 | §12 |
| 🔧 시스템 이상 | 즉시 | 소스 2회 연속 실패(M3 ② 검색 소스 4종 전부 실패 포함), 비용 80%, 링크 스모크 실패 |

### 9.3 명령어
| 명령 | 동작 |
|---|---|
| `/today` | 오늘 큐 요약 |
| `/hold` | 보유 종목 신호(경고 우선) |
| `/s <종목명·코드·티커>` | 종목 통합 카드(축·M1~M5·최근 신호 5·**전체 링크 버튼**) |
| `/entry` | 🟢·🟡·🔵 현황 |
| `/radar` | 산업 L1 상위 5 / 하위 3 (M3 통과 여부) |
| `/growth [산업]` | 산업 성장 근거 3종 현황(② 채택 근거의 원문 문장·링크 포함). 보기 전용 |
| `/links` | 6개 대시보드 홈 버튼 |
| `/week` | 최신 주간 메모 |
| `/idea <종목>` | SnowBall draft 제출 |
| `/mute <시간>` | 긴급 외 알림 중지 |
| `/status` | 시스템 상태 |

### 9.4 링크 규칙 (`config/links.yaml`, `lib/links.ts` 순수 함수)

**종목 링크 세트** — 🟢·⚠️·💰·`/s` 카드에는 인라인 버튼으로 붙인다.

| 버튼 | 국내 | 미국 | URL |
|---|---|---|---|
| 📊 JARVIS | ✔ | ✔ | `{JARVIS_URL}/stock/{entity_id}` |
| 🛡️ Heimdallr | ✔ | — | `https://heimdallr-call.vercel.app/stock/{code}` |
| ⚡ HermesCall | ✔ | ✔ | `https://hermes-call-psi.vercel.app/analysis/{id}` (관련 최신 분석), 없으면 `/screener` |
| ❄️ SnowBall | ✔ | ✔ | `https://snowball-heritage.vercel.app/ironman/asset/{asset_id}`, 자산이 없으면 `/ironman/ideas` |
| 🧙 Sage | ✔ | ✔ | `https://sage-gotomiraes-projects.vercel.app/?q={종목명}&date=30d` |
| 🔄 FlyWheel | ✔ | ✔ | 종목 L1의 노션 `[산업]` 페이지. L2 페이지가 없으면 L1 카테고리 페이지 |
| 🟢 네이버증권 | ✔ | ✔ | 국내 `https://m.stock.naver.com/domestic/stock/{code}/total` / 미국 `https://m.stock.naver.com/worldstock/stock/{NVDA.O}/total` |
| 📈 StockEasy | ✔ | — | `https://stockeasy.intellio.kr/stock-analysis/stock-info/{code}` (국내 전용, 로그인 필요) |

- 배치: `[JARVIS][Heimdallr][HermesCall]` / `[SnowBall][Sage][FlyWheel]` / `[네이버증권][StockEasy]` / 액션행 `[SnowBall 아이디어로][무시 7일]`.
- **미국 네이버 코드**: `https://api.stock.naver.com/stock/{symbol}.O/basic` → `.K` 순으로 확인한다. 200이고 `StockConflict`가 없으면 채택하고 30일 캐시한다. 둘 다 실패하면 `https://search.naver.com/search.naver?query={symbol}`로 보낸다(HermesCall 실측 규칙, MDT 미수록 사례).
- **만들 수 없는 링크는 버튼을 생략한다.** 빈 화면으로 보내지 않는다.
- **여러 종목 메시지**(브리핑): 종목명 옆에 텍스트 링크를 붙인다. 형식: `SK하이닉스 · <a>네이버</a> · <a>StockEasy</a> · <a>Heimdallr</a> · <a>JARVIS</a>`. 메시지 하단에는 **대시보드 홈 버튼 6개**를 둔다.
  - 📊 JARVIS · 🛡️ Heimdallr `https://heimdallr-call.vercel.app/` · ⚡ HermesCall `https://hermes-call-psi.vercel.app/`
  - ❄️ SnowBall `https://snowball-heritage.vercel.app/ironman/portfolio` · 🧙 Sage `https://sage-gotomiraes-projects.vercel.app/` · 🔄 FlyWheel(노션 `2_1. 산업 & 종목`)
- **링크 스모크 테스트**: 매일 03:30에 링크 규칙별 대표 URL 1개씩 HEAD/GET을 보낸다. 4xx·5xx·빈 화면 패턴이면 🔧 알림과 `/health`에 표시한다. 로그인 필요 페이지(StockEasy·Sage·SnowBall)는 3xx를 정상으로 본다.

---

## 10. 주간 투자위원회 (토 09:30) — 이번 주 증시 분석 + 다음 주 투자 전략 (필수)

### 10.1 순서
금 17:00 Sage 스코어카드 → **금 18:00 Sage 전략 리포트(이동)** → 토 08:00 FlyWheel 주간 리포트 → 토 09:00 JARVIS 데이터 확정 → **09:30 발행**. FlyWheel 리포트가 없으면 10:30까지 15분 간격으로 재확인한 뒤 "미도착"으로 표기한다.

### 10.2 구성 (고정 순서)

**Ⅰ. 이번 주 증시 분석**
1. 시장 요약표: KOSPI·KOSDAQ·S&P 500·NASDAQ·필라델피아 반도체·Russell 2000 주간 수익률, 거래대금 변화, VIX, 미 10년물, 달러인덱스, 원/달러, WTI
2. 수급: KOSPI·KOSDAQ 외국인·기관·개인 주간 순매수
3. 산업 성과 순위: L1 18개 바스켓(동일가중, 한국·미국 분리) 주간·1개월. 상위·하위 3의 **원인**을 FlyWheel·HermesCall·Heimdallr 근거로 연결
4. 이번 주 실적 결과: HermesCall 발표 기업(F1~F4·가이던스), Heimdallr 신규 ★○, 🔵 실적 돌파
5. 매크로 이벤트 결과와 시장 반응
6. 멘토 컨센서스 변화(Sage)
7. 내 포트폴리오: 주간 수익률 vs KOSPI·S&P 500, 기여 상위·하위 3, 레짐 변화(SnowBall)
8. 신호 복기: 지난 🟢의 현재 수익률, 무효화된 신호, M1~M5 탈락 사유 분포

**Ⅱ. 다음 주 투자 전략**
1. 기본 스탠스: 레짐, 권장 현금 비중 밴드
2. 캘린더: 미국 실적, 한국 잠정실적 예상, 매크로, **보유 종목 관련 일정 우선**
3. 산업 오버/언더웨이트: L1별 판단 + M3 근거(실적·미국 메이저 증권사 전망·전망) + **성장 근거 없음·만료 산업 목록** + 이번 주 새로 자동 채택·만료된 증권사 근거(원문 문장·링크)
4. 매수 검토 리스트: 🟢·🟡·🎯 상위 5. 조건 충족 현황(M1~M5), 진입 가격대, 무효화선, 1차 비중
5. 보유 대응: ⚠️·💰 종목별 행동(유지/축소/재검토)과 근거
6. 시나리오: Bull / Base / Bear 확률과 **다음 주 안에 숫자로 확인할 트리거**
7. 내가 틀릴 수 있는 이유 3가지
8. 결정할 것 3가지 + 지난주 결정 리뷰(SnowBall decisions)

### 10.3 데이터 소스
- 지수·금리·환율·원자재: Yahoo chart·네이버 차트 API(HermesCall `price_history` 실측 무료 소스)를 어댑터로 사용한다.
- 한국 투자자별 수급: 네이버 금융 또는 KRX(P0에서 Actions 환경 접근을 실측).
- 매크로 캘린더: FlyWheel `fomc_dates.json` + `config/catalyst_calendar.yaml`(scope macro).
- 바스켓: 엔티티 primary_l1(국내 시총 1,000억 이상, 미국 HermesCall watchlist).

### 10.4 생성 — 숫자 grounding gate (D6)
1. 결정론적 잡이 fact table(JSON, 수치마다 `F###` ID)을 만든다.
2. LLM(`MEMO_MODEL`, 기본 `claude-sonnet-5`, 선택 `claude-opus-5-5`)은 서술·시나리오·확률만 쓰고, 숫자는 `[[F012]]` 표식으로만 인용한다.
3. 저장 전에 모든 숫자가 fact table과 일치하는지 확인한다(단위 환산 금지). 불일치가 있으면 1회 재생성하고, 그래도 실패하면 **서술 없이 표·목록만** 발행한다.
4. 산출은 세 곳에 둔다: `/weekly`, 텔레그램 요약(하단 대시보드 6버튼), 노션 `2. 주식 자본 > 2_3. 투자 아이디어 > JARVIS 주간 투자위원회` 하위 페이지.

---

## 11. FlyWheel 인박스
FlyWheel STEP2는 Idea_Generating에서 `created_time` 창(전일 16:00~당일 16:00)의 행을 **출처와 무관하게** 처리한다(코드 실측). JARVIS가 행을 추가하면 FlyWheel 코드 변경 없이 연계종합에 반영된다.

| 투입 | 조건 | 제목 |
|---|---|---|
| HermesCall 최종 딥분석 | Stage 2 + (수혜강도 ≥ 7 또는 F1~F4 중 2개 이상) | `[HermesCall] NVDA 2Q FY27 — 수혜: SK하이닉스 9, …` |
| Heimdallr ★ | LLM 3단계 완료 | `[Heimdallr] 종목 분기 — ★ 점수/PRI` |
| Sage 컨센서스 변화 | 멘토 2명 이상 새로 합류 또는 방향 전환 | `[Sage] 산업 — 멘토 N명 강세 합류` |
| Sage 주간 전략 | 금 18:00 발행 후 | `[Sage 주간] 2026-W40` |

- `관련산업`은 L1의 L2 이름으로 넣는다(FlyWheel 허용 목록). L2가 둘이면 라벨 키워드로 고르고, 모호하면 둘 다 넣는다. **L2 페이지가 없는 L1(1l·2f·2g)은 비워 두고** 본문 첫 줄에 L1 이름을 적는다.
- 본문은 원문 전체와 원 프로젝트 링크다. **하루 5건 상한**(FlyWheel 비용 보호)이다. 노션 API는 초당 3회 제한을 지키고, 같은 `source_ref`는 재투입하지 않는다.

---

## 12. 성과 귀속 · 규칙 보정
- **원장 `signal_ledger`**: 큐 진입, 🟢(태그 PB/SW/CU/PEAD_PB), 🟡, 🔵, 인박스, 무시, SnowBall 제출을 기록한다.
  - 진입가 = **신호 다음 첫 거래일 종가**
  - 벤치마크: KOSPI(코스닥 종목은 KOSDAQ) / S&P 500
  - 측정: D+5·20·40·60 (거래일, D47 — 40 추가). 국내 시세는 거래소 공식 종가(네이버 일봉), 미국은 야후
- **가져오기(재계산 금지)**: Heimdallr `outcome_tracking`, Sage `mentor_scorecards`, SnowBall `decision_reviews`.
- **새로 계산**
  - 🟢 태그별 성과
  - **M1~M5 조건별 기여**(예: M5 경로 "외국인 연속" vs "합산 연속", M2 "직전" vs "당일")
  - 🟡에서 🟢로 승격된 비율
  - FlyWheel 산업 신호의 L1 바스켓 성과. FlyWheel `signal_lessons.txt`에 제안문으로 전달한다(수동 반영).
  - HermesCall 수혜강도 구간별 성과
- **피드백 루프(D49)**: 신호 시점 특징을 원장에 고정 저장 → 큐·특징 구간별 성과(`perf_stats`, 매일) → 표본 ≥ 30 구간이 생기면 🎯 추천 순위의 첫 기준(§7.3 게이트 6, 후보 자격은 불변) → 분기 보정 제안(`calibration_reviews`, 자동 적용 없음) → `/scorecard`.
- **보정**: 분기 1회. 표본 30건 미만 항목은 변경 금지. `rules.yaml` 변경은 PR로 하고 `docs/DECISIONS.md`에 근거를 기록한다(자동 적용 금지). **M1~M5의 "필수" 여부 자체는 사용자 결정 사항이므로 보정 대상이 아니다.** 임계값만 조정한다.

---

## 13. DB 스키마 (`jarvis`)
모든 테이블 RLS를 켠다. 읽기는 인증 사용자, 쓰기는 service_role 배치다.

| 테이블 | 핵심 컬럼 |
|---|---|
| `entities` | id, market, symbol, name, aliases[], primary_l1, l1_codes[], naver_us_code, snowball_asset_id, hermes_analysis_id, updated_at |
| `taxonomy_l1` / `taxonomy_labels` / `taxonomy_pending` | 노션 동기화 / 프로젝트별 매핑 결과 / 확인 대기 |
| `signals` | §6.1 |
| `axes_daily` | (date, entity_id) N·C·F·P·H + 근거 |
| `entry_eval` | (date, entity_id) m1..m5 bool + 근거 jsonb(각 수치·경로·이벤트), level(green/yellow/none), tag, invalidation_price, first_weight_pct, gate_result |
| `breakout_watch` | entity_id, source(K1/H1), d0, d0_low, armed_until, promoted_at |
| `queue_items` | date, entity_id, queue, reason, first_seen, last_seen, status |
| `industry_heat` | (date, l1) n_score, c_score, sentiment, m3_median_rev_yoy_q0/q1, m3_median_op_yoy, m3_members, m3_pass, m3_basis(realized/us_major_broker/outlook + 사용 증권사·값·발표일), basket_ret_1w/1m |
| `industry_outlooks` | id, l1, source_type(broker/research/company/government), broker, segment, metric(CAGR/CAGR_DERIVED/NEXT_YEAR), value_pct, horizon, published_date, date_basis(meta/list), publisher, domain, tier(A/B/other), url, quote(원문 문장), origin(google_news/bing_news/gdelt/broker_site/yaml), adoption_rule(A1/B1/B2/manual), corroborating_urls[], conflict bool, status(adopted/unverified/excluded/expired), match_detail jsonb, adopted_at, expires_at |
| `outlook_fetch_log` | run_id, source, l1, query, http_status, result_count, articles_fetched, candidates, adopted, fetched_at |
| `catalyst_events` | entity_id 또는 l1, title, date 또는 window_end, direction, source, url, origin(snowball/hermes/heimdallr/earnings/yaml), expires_at |
| `holdings_cache` | snapshot_at, payload |
| `notifications` | kind, dedupe_key UNIQUE, entity_id, payload, sent_at, telegram_msg_id |
| `signal_ledger` / `outcomes` | §12 (outcomes.horizon_days ∈ 5·20·40·60, horizon_date — 0006) |
| `perf_stats` / `calibration_reviews` | §12 피드백 루프 (D49, 0006) |
| `weekly_memos` | week, fact_table, body_md, grounding_ok, notion_url, telegram_sent_at |
| `inbox_log` | source_ref UNIQUE, notion_page_id |
| `link_checks` | rule, sample_url, status, checked_at |
| `job_runs` / `cost_log` | 운영 |

---

## 14. 통합 스케줄 (KST)
> 정시 시작은 JARVIS pg_cron → `workflow_dispatch`. 잡은 멱등이며, GitHub schedule은 30분 뒤 백업으로 둔다.

| 시각 | 주체 | 작업 |
|---|---|---|
| 06:00 | Heimdallr | 유니버스·시세·PRI (기존) |
| **06:40** | HermesCall | **미국 `entry_checks_us`(M1·M2·M5 대용) + 🔵 H1** (신규 잡, 미국 정규장 마감 후) |
| 07:00 | SnowBall | am 슬롯 (기존) |
| 07:00 | JARVIS | `industry_growth_realized`(M3) |
| 07:10 | JARVIS | `ingest_all` → `holdings_sync` → `axes` → `catalysts`(M4) → `entry_eval`(미국) → `queues` → `gate` |
| **07:30** | JARVIS | ☀️ 아침 브리핑 + 미국 🟢 개별 메시지 |
| 30분마다 | JARVIS | `poll` — 증분 수집 → 보유 경고 |
| 미국 실적 창 | JARVIS | 15분 폴링(HermesCall `earnings_events` −15~+90분) |
| 16:00 | SnowBall · FlyWheel | pm 슬롯 · 일간 파이프라인 (기존) |
| 17:37 / 18:17 / 19:07 | Heimdallr | 일일 요약 + **국내 `entry_checks`(M1·M2·M5) + 🔵 K1** (개편) |
| 18:30 | HermesCall | idea_scanner 개편 — 한국 수혜주는 `catalyst_watch` 기록만(기술적 판정·발송 중단), 미국 판정은 06:40 `entry_checks_us`로 이관 |
| 19:00 | JARVIS | `industry_growth_realized`(M3) |
| 19:10 | JARVIS | `ingest_all` → `axes` → `catalysts` → `entry_eval`(국내) → `queues` → `gate` |
| **19:20** | JARVIS | 🌙 저녁 브리핑 + 국내 🟢 개별 메시지 |
| 20:00 | JARVIS | `outcomes_update` |
| 03:00 일 | JARVIS | `taxonomy_sync`(노션) · `entities_sync` |
| 03:30 매일 | JARVIS | `link_smoke` |
| 04:00 일·수 | JARVIS | `industry_outlook_collect`(무료 검색 → 정규식 추출 → 자동 채택, M3 ②. 확인 요청 없음) |
| 금 17:00 / **금 18:00** | Sage | 스코어카드 / **전략 리포트(토 08:00에서 이동)** |
| 토 08:00 | FlyWheel | 주간 리포트 |
| **토 09:30** | JARVIS | 🏛️ 주간 투자위원회 |
| 분기 첫 토 10:30 | JARVIS | 📊 신호원 성적표 |

---

## 15. 비용 (추정)
| 항목 | 월 |
|---|---|
| 주간 메모 LLM(Sonnet 5 기준 주 1~2회) | ~$1~2 |
| 증권사 성장률 수집(무료 RSS·GDELT·공개 페이지 + 정규식, Actions public) | $0 |
| 브리핑·🟢·링크 | $0 (템플릿) |
| FlyWheel 인박스 | FlyWheel 한도 내(≤5행/일) |
| 인프라(Vercel Hobby·Supabase·Actions public) | $0 |
| **합계** | **≤ $3 (하드 상한 $5)** |

---

## 16. 구현 Phase · 검증 게이트
3분기 실적 시즌(미국 10월 중순, 한국 잠정실적 10월 중순~11월 중순) 전에 P2를 완료한다.

| Phase | 기한 | 범위 | 통과 조건 |
|---|---|---|---|
| **P(-1) SnowBall 연결** | P0 전 | `docs/SNOWBALL_SETUP_GUIDE.md` 1~7단계(사용자) | 가이드 5단계 검증 3개 통과 |
| **P0 준비** | ~9/30 | 저장소·Supabase(D5)·Vercel·봇 webhook·pg_cron. 소스별 anon SELECT 실측. FlyWheel 신호강도 속성 실측. **M3 ② 무료 소스 4종 스모크(Actions에서)**: 각 소스 1쿼리 → 결과 수·HTTP 상태, Google News 원문 URL 해제, 증권사 인사이트 목록·sitemap URL 실측 후 yaml 고정 | 5개 소스 읽기 + 무료 검색 소스 3종 이상 응답, 봇 `/status`, `/links` 응답 |
| **P1 공통 기준** | ~10/3 | `taxonomy.yaml` 로더·`match.ts`(스냅샷 일치, 커버리지 100%), `entities_sync`, `holdings_sync`, `links.ts` + 링크 스모크, `/taxonomy`. 각 프로젝트 산업명 수정(사용자) | 부록 A 재현, 링크 규칙 전부 200/3xx |
| **P2 수렴·전달** | ~10/12 | signals·axes·queues, **M3(① `industry_growth_realized` · ② `industry_outlook_collect` 자동 채택 + `/growth` 보기 · ③ yaml), M4 `catalysts`**, 대시보드 `/`·`/portfolio`·`/stock`, 브리핑, 보유 경고, 인박스, SnowBall 제출 | 7일 연속 정시 브리핑, 보유 경고 ≤ 35분 |
| **P3 진입 신호** | 10/13~10/31 | 연계 작업(Heimdallr `entry_checks`·K1, HermesCall `entry_checks_us`·H1·`catalyst_watch`) 완료 후 `entry_eval`·🟢/🟡/🔵·`/entry`. 2주 병행 후 원 프로젝트 기술적 알림 텔레그램 중단(D10) | SC6 테스트 통과, 🟢 메시지 링크 버튼 전부 정상 |
| **P4 시즌 운영** | 11월 | 주간 투자위원회, 성과 원장, `/radar`·`/health`·`/weekly` | 주간 메모 4회 정시, grounding 실패 0 |
| **P5 보정** | 2027년 1분기~ | `/scorecard`, 분기 보정 PR | 표본 ≥ 30 항목만 |

각 Phase 종료 시 `npm run typecheck && npm run test && npm run build`를 통과하고 `docs/DECISIONS.md`에 기록한다.

---

## 17. 함정 목록 · 리스크
| # | 함정 | 대응 |
|---|---|---|
| T1 | GitHub schedule 지연 | pg_cron 디스패치, 멱등 |
| T2 | 봇당 webhook 1개·getUpdates 충돌 | JARVIS 전용 봇만 |
| T3 | PostgREST 1,000행 | `range()` 페이징 |
| T4 | LLM 숫자 오류 | grounding gate, 판정에 LLM 금지 |
| T5 | 서비스 키 확산 | SnowBall 토큰 RPC, 나머지 anon 우선 |
| T6 | 이중 장부 | 쓰기 경로 0, FlyWheel `/매수` 폐기 |
| T7 | 산업 매핑 오탐 | 동의어 부분일치 금지, 일반어 무시, pending 확인 |
| T8 | 휴장일·시차 | 시장별 거래일 캘린더, KST 저장 + 시장 날짜 병기 |
| T9 | 노션 API 제한 | 초당 3회, 큐잉 |
| T10 | 원 프로젝트 스키마 변경 | 어댑터가 누락 컬럼을 견디고 `/health` 경고 |
| T11 | 알림 피로 | 🟢 하루 3건, 🟡는 목록만, `/mute` |
| T12 | 과최적화 | 표본 30 미만 보정 금지, PR·기록 |
| T13 | 로그인 필요 링크(StockEasy·Sage·SnowBall) | 본인 사용 전제. 스모크에서 3xx 정상 처리 |
| T14 | 공개 저장소 | 데이터·키·개인 금액 커밋 금지, 비밀 스캔 |
| T15 | **M1~M5가 엄격해 🟢가 드물 수 있음** | 설계 의도다(사용자 지정 필수 조건). 대신 🟡와 조건별 탈락 사유를 보여 준다. 몇 주간 🟢가 0건이면 주간 메모에 "조건별 탈락 분포"를 제시해 사용자가 판단하게 한다(자동 완화 금지) |
| T16 | M3 근거 부족 산업(양자컴퓨터·여행 등) | ① 표본 부족이면 ②(증권사)·③(전망)으로 판단. 셋 다 없으면 탈락 + `/growth`·주간 메모에 "성장 근거 없음" 표시 |
| T17 | 미국 M5는 대용 지표 | 메시지에 "수급 대용(미국)" 명시, 성과 귀속에서 국내와 분리 집계 |
| T18 | 네이버 해외 코드 접미사 | API 확인 + 캐시 + 검색 폴백 |
| T19 | 증권사 성장률 자동 추출 오류(산업 오귀속·기업 수치 혼입·재인용 왜곡·과거 수치) | LLM 미사용(원문 문장 그대로) + 문장 기준 L1 매칭 + 제외어·과거 시제 필터 + 등급 A/B 도메인만 + 교차 보도(B1)·명시 조건(B2) + 90일 + fixture 테스트(정탐·오탐 예문) + SC12 분기 대조(D19) |
| T20 | 증권사 원문이 유료·로그인 전용 | 채택하지 않음(로그인 자료 미사용 원칙). 공개 보도·공개 인사이트 페이지만 사용 |
| T21 | 무료 소스 차단·형식 변경(429·403·RSS 스키마 변경·Google News 링크 해제 실패) | 4개 소스 병렬·독립, 소스별 실패 격리, 백오프, 전부 실패 2회면 🔧 알림. 기존 채택값은 만료 전까지 유지 |
| T22 | 규칙 추출의 재현율 한계(표·차트·PDF 속 수치, 우회 표현 미포착) | 의도된 트레이드오프(무료·환각 0). ①·③이 보완, 놓친 표현은 `growth_patterns`에 추가. 필요하면 수동 `source_type: broker` 입력 |

---

## 18. 시작 순서 — 사용자 준비물과 첫 실행
상세 절차와 체크박스는 `docs/START_HERE.md`에 있다. 요약은 다음과 같다.

| 순서 | 누가 | 할 일 | 시간 |
|---|---|---|---|
| 1 | 사용자 | 결정 2개: D5(JARVIS용 새 Supabase 프로젝트를 만들 수 있는가), 저장소 이름·public 확정 | 10분 |
| 2 | 사용자 + SnowBall Claude Code | `docs/SNOWBALL_SETUP_GUIDE.md` 1~7단계(P(-1)) | 40~60분 |
| 3 | 사용자 | 계정·키 준비: 텔레그램 봇 토큰·chat_id, Supabase(JARVIS), GitHub 빈 저장소·PAT 2개, Vercel, 노션 통합, 연계 4개 프로젝트 URL·anon 키, (P4 전까지) Anthropic 키 | 30~40분 |
| 4 | JARVIS Claude Code | `KICKOFF_PROMPT.md` 블록 실행 → P0 → 보고 후 멈춤 | 2~4시간 |
| 5 | 사용자 | P0 보고서의 "사용자 할 일"(GitHub Secrets·Vercel 환경변수·webhook 확인) 처리 | 20분 |
| 6 | 각 저장소 Claude Code/Codex | 연계 작업 E(Sage) → C(HermesCall 산업명) — JARVIS P1과 병행 | 각 30~60분 |
| 7 | JARVIS Claude Code | P1 → P2(10/12까지, 3분기 실적 시즌 전) | — |
| 8 | Heimdallr Codex · HermesCall Claude Code | 연계 작업 B·C(진입 조건 `entry_checks`·`entry_checks_us`) → JARVIS P3 | — |

---

## 부록 A. 산업 매핑 결과 (참조 구현 실행, 2026-09-27 · 미매칭 0건)
스냅샷: `config/taxonomy_expected.json`

### A.1 HermesCall watchlist → **노션 L1로 교체**
AI인프라반도체 → AI + 반도체 / Beauty미용기기 → 화장품_미용기기 / 라면 → 소비재 / 로봇휴머노이드 → Robot / 바이오제약 → 바이오 / 방산·우주항공 → 우주항공방산 / 배터리 → 2차 전지 / 양자컴퓨터 → 양자컴퓨터 / 의료기기 → 헬스케어 / 인바운드 → 여행 / 전력인프라 → 전력인프라 / 조선 → 조선

### A.2 Sage SECTORS → **노션 L1 18개 + MACRO + 기타로 교체**
반도체 → 반도체 / 자동차·로봇 → 자율주행차 + Robot / 거시경제 → MACRO / 플랫폼 → IT / 바이오 → 바이오 / 전력·에너지 → 전력인프라 / 뷰티 → 화장품_미용기기 / 부동산 → 건설 / 기타 → 기타

### A.3 SnowBall sectors.ts → **이름 유지 + L1 파생**
- 반도체 IDM·장비·소재·부품 → 반도체
- AI 팹리스 → AI + 반도체
- 전자 부품·광 네트워크·소프트웨어·플랫폼 → IT
- 양자 → 양자컴퓨터
- 전력 인프라·**에너지** → 전력인프라
- 2차전지·전기차 → 2차 전지
- 로봇 → Robot
- **자동차 → 자율주행차**
- 조선 → 조선
- 방산·우주 → 우주항공방산
- 바이오 → 바이오
- 의료기기 → 헬스케어
- 화장품 → 화장품_미용기기
- 음식류·유통 → 소비재
- 엔터 → 엔터
- 금융 → 금융
- **소재·기타 → 기타**

### A.4 Heimdallr Kairos → **노션 L1로 교체(기존 이름은 별칭)**
- AI → AI
- AI 반도체 → AI + 반도체
- 반도체 → 반도체
- 전력인프라 → 전력인프라
- 바이오 → 바이오
- 화장품·미용기기 → 화장품_미용기기
- 엔터 → 엔터
- 우주항공방산 → 우주항공방산
- 조선 → 조선
- 2차전지 → 2차 전지
- 로봇 → Robot
- IT·네트워크·OLED → IT
- 헬스케어 → 헬스케어
- 소비재·음식료·의류 → 소비재
- 양자컴퓨터 → 양자컴퓨터
- **자율주행차 → 자율주행차**
- 건설 → 건설
- ETF → ETF(특수)

### A.5 Heimdallr 투자 섹터 → **이름 유지 + L1 매핑**
- 반도체 6단계 → 반도체
- 원전·신재생에너지·전력인프라 → 전력인프라
- 방산·우주 → 우주항공방산
- 2차전지 → 2차 전지
- 전자부품·디스플레이·인터넷·플랫폼·소프트웨어·IT·통신·네트워크 → IT
- 조선·해운 → 조선
- **자동차 → 자율주행차**
- 바이오·제약 → 바이오
- 의료기기 → 헬스케어
- 엔터·미디어·게임 → 엔터
- 건설·건자재·부동산·리츠 → 건설
- 기계·로봇 → Robot
- 식음료·유통·소비재 → 소비재
- 금융 → 금융
- **철강·금속·화학·소재·운송·물류·지주·기타서비스 → 기타**

### A.6 FlyWheel → 변경 없음 (17개 전부 L2 일치)

---

## 부록 B. 메시지 템플릿

### B.1 🟢 진입 신호 (종목 1개)
```
🟢 진입 신호 · 눌림(PB) · 🇰🇷 리노공업 (058470)
신호 계열: F★82 · N(반도체 신호강도 4) · C(NVDA 수혜 8) · PRI 31
───────────── 필수 조건 ─────────────
✅ M1 실적↑·가속·미반영  매출 YoY +18→+34% · 영업이익 YoY +22→+59% · TTM↑ · 발표후 고점 −12%
✅ M2 MACD 교차 직전      Signal−MACD 0.18% · 히스토그램 3일 개선 · 추정 2봉
✅ M3 산업 고성장         ①실적 반도체 매출 YoY 중앙값 +24%·+21% (표본 38) · ②Morgan Stanley HBM CAGR 30% (9/12 발표)
✅ M4 6개월 내 이벤트     11/20 NVDA 실적 (HermesCall) · 4Q HBM4 양산 (SnowBall 트리거)
✅ M5 수급 2일+           기관 3일 연속 순매수
─────────────
무효화: 종가 < 238,500원 (10일 최저) · 1차 비중: 허용 6.0% 중 1/3 = 2.0%
⚠️ 매수 확정 신호가 아닙니다. 최종 판단·입력은 SnowBall에서.
[📊 JARVIS] [🛡️ Heimdallr] [⚡ HermesCall]
[❄️ SnowBall] [🧙 Sage] [🔄 FlyWheel]
[🟢 네이버증권] [📈 StockEasy]
[SnowBall 아이디어로] [무시 7일]
```
(값은 레이아웃 설명용 가상 예시)

### B.2 🌙 저녁 브리핑 (여러 종목)
```
🌙 2026-10-22 저녁 브리핑
KOSPI +0.8% · KOSDAQ +1.2% · 외국인 +3,210억
🟢 진입 1 · 🟡 관찰 3 · 🔵 돌파 2 · ⚠️ 보유 경고 0
🟢 리노공업 — 눌림 · PRI 31  네이버 · StockEasy · Heimdallr · JARVIS
🟡 ○○테크 — M4 없음          네이버 · StockEasy · Heimdallr · JARVIS
🔵 △△전자 — 잠정 ★ 갭+5.2%   네이버 · StockEasy · Heimdallr · JARVIS
[📊 JARVIS] [🛡️ Heimdallr] [⚡ HermesCall]
[❄️ SnowBall] [🧙 Sage] [🔄 FlyWheel]
```

### B.3 ⚠️ 보유 경고
```
⚠️ 보유 경고 · 🇰🇷 이수페타시스 (007660)
원인: 미국 대장주 AVGO 가이던스 컨센 하회 (HermesCall 🔬)
연결 논지: SnowBall 훼손조건 #2 "AI 가속기 고객 CAPEX 둔화"
비중 7.8% (허용 8.5%) · 과열 62 · PRI 58
권장: 논지 재검토 → SnowBall 결정 기록
[종목 링크 세트 3행]
```

---

## 부록 C. 환경변수 (`.env.example`)
```
NEXT_PUBLIC_SUPABASE_URL= / NEXT_PUBLIC_SUPABASE_ANON_KEY= / SUPABASE_SERVICE_KEY=
JARVIS_URL=                     # 배포 후 Vercel URL (links.yaml 치환)
ALLOWED_EMAIL=
JARVIS_PUBLIC_TOKEN=
TELEGRAM_BOT_TOKEN=             # @Tonny_JARVIS_bot 전용
TELEGRAM_CHAT_ID=
TELEGRAM_WEBHOOK_SECRET=
GITHUB_DISPATCH_TOKEN=          # 이 저장소 Actions RW
GITHUB_READ_TOKEN=              # 6개 저장소 Actions 읽기(/health)
ANTHROPIC_API_KEY=               # 주간 메모 서술 전용 (M3 ②는 LLM·유료 API 미사용)
MEMO_MODEL=claude-sonnet-5
MONTHLY_LLM_CAP_USD=5
NOTION_API_KEY=
NOTION_IDEA_DB_ID= / NOTION_WEEKLY_PARENT_PAGE_ID=
HEIMDALLR_SUPABASE_URL= / HEIMDALLR_ANON_KEY=
HERMES_SUPABASE_URL= / HERMES_ANON_KEY=
SAGE_SUPABASE_URL= / SAGE_READ_KEY=
SNOWBALL_SUPABASE_URL= / SNOWBALL_ANON_KEY= / SNOWBALL_JARVIS_TOKEN=
```
환경변수는 `lib/env.ts` 한 곳에서만 읽고 `.trim()`을 강제한다.
