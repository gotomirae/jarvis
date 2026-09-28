-- JARVIS 스키마 (PRD §13). 새 Supabase 프로젝트 jarvis(서울, D5 A안).
-- 원칙
--   · 모든 테이블 RLS ON. 읽기 = authenticated(대시보드 로그인, ALLOWED_EMAIL 1개), 쓰기 = service_role 배치(RLS 우회).
--   · anon 에는 아무 권한도 주지 않는다. /api/public/* 는 서버 라우트가 service 키로 읽고 토큰으로 보호한다.
--   · 보유 수량·원가·거래를 저장하는 테이블은 없다(불변 규칙 1). holdings_cache 는 SnowBall RPC 응답 스냅샷(읽기 캐시)뿐이다.
--   · 시각은 timestamptz(표시 KST), 시장 날짜는 별도 date 컬럼(market_date, KR/US 거래일)으로 둔다(불변 규칙 12).
--   · 재실행 안전(if not exists / create or replace).
--
-- ▶ 적용 후 대시보드에서 1회: Settings → API(Data API) → Exposed schemas 에 `jarvis` 추가.

alter database postgres set timezone to 'Asia/Seoul';

create schema if not exists jarvis;
grant usage on schema jarvis to authenticated, service_role;

-- ───────────────────────── 공통 기준 ─────────────────────────
create table if not exists jarvis.entities (
  id                  text primary key,                        -- 'KR:000660' / 'US:NVDA'
  market              text not null check (market in ('KR','US')),
  symbol              text not null,
  name                text not null,
  aliases             text[] not null default '{}',
  primary_l1          text,
  l1_codes            text[] not null default '{}',
  asset_class         text,                                    -- SnowBall asset_class (stock/etf/fund …) — 개별 종목 신호는 stock 만
  naver_us_code       text,                                    -- NVDA.O 등 (30일 캐시)
  naver_us_checked_at timestamptz,
  snowball_asset_id   text,
  hermes_analysis_id  text,
  updated_at          timestamptz not null default now(),
  unique (market, symbol)
);

create table if not exists jarvis.taxonomy_l1 (
  code        text primary key,                                -- '1a' … '3c'
  name        text not null,
  l2          text[] not null default '{}',
  synonyms    text[] not null default '{}',
  notion_url  text,
  synced_at   timestamptz not null default now()
);

create table if not exists jarvis.taxonomy_labels (
  project     text not null,                                   -- flywheel/sage/hermescall/heimdallr/snowball/*
  label       text not null,
  l1_codes    text[] not null default '{}',
  primary_l1  text,
  method      text not null,                                   -- override/special/contains/partial/unmatched
  updated_at  timestamptz not null default now(),
  primary key (project, label)
);

create table if not exists jarvis.taxonomy_pending (
  id            bigint generated always as identity primary key,
  project       text not null,
  label         text not null,
  suggested_l1  text[] not null default '{}',
  method        text not null,
  status        text not null default 'pending' check (status in ('pending','confirmed','rejected')),
  resolved_l1   text[],
  first_seen    timestamptz not null default now(),
  resolved_at   timestamptz,
  unique (project, label)
);

-- ───────────────────────── 신호·축·큐 ─────────────────────────
create table if not exists jarvis.signals (
  id           bigint generated always as identity primary key,
  source       text not null,                                  -- flywheel/sage/hermescall/heimdallr/snowball
  source_ref   text not null,
  kind         text not null,                                  -- PRD §6.1 kind
  entity_id    text references jarvis.entities(id) on delete set null,   -- null = 산업 신호
  l1_codes     text[] not null default '{}',
  direction    smallint not null check (direction in (-1,0,1)),
  strength     numeric(5,2) not null check (strength between 0 and 10),
  observed_at  timestamptz not null,
  market_date  date,
  expires_at   timestamptz,
  evidence     jsonb not null default '{}',
  dedupe_key   text not null unique,
  created_at   timestamptz not null default now()
);
create index if not exists signals_entity_idx on jarvis.signals (entity_id, observed_at desc);
create index if not exists signals_kind_idx on jarvis.signals (kind, observed_at desc);
create index if not exists signals_l1_idx on jarvis.signals using gin (l1_codes);

create table if not exists jarvis.axes_daily (
  date        date not null,
  entity_id   text not null references jarvis.entities(id) on delete cascade,
  n_on        boolean not null default false,
  c_on        boolean not null default false,
  f_on        boolean not null default false,
  p_value     numeric(6,2),                                    -- 국내 PRI / 미국 pri_us_lite
  h_held      boolean not null default false,
  evidence    jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  primary key (date, entity_id)
);

-- 🟢 판정 결과. level='green' 행은 lib/engine/entry.ts 단일 함수만 만든다(불변 규칙 4, SC6).
create table if not exists jarvis.entry_eval (
  date                date not null,                           -- 시장 거래일
  entity_id           text not null references jarvis.entities(id) on delete cascade,
  market              text not null check (market in ('KR','US')),
  m1                  boolean not null default false,
  m2                  boolean not null default false,
  m3                  boolean not null default false,
  m4                  boolean not null default false,
  m5                  boolean not null default false,
  evidence            jsonb not null default '{}',             -- 조건별 수치·경로·이벤트·누락 사유
  level               text not null default 'none' check (level in ('green','yellow','none')),
  tag                 text check (tag in ('PB','SW','CU','PEAD_PB')),
  invalidation_price  numeric,
  first_weight_pct    numeric(6,3),
  gate_result         jsonb not null default '{}',
  created_at          timestamptz not null default now(),
  primary key (date, entity_id),
  -- DB 차원의 SC6 이중 안전장치: green 이면 M1~M5 모두 true
  constraint entry_eval_green_requires_all check (level <> 'green' or (m1 and m2 and m3 and m4 and m5))
);

create table if not exists jarvis.breakout_watch (
  id           bigint generated always as identity primary key,
  entity_id    text not null references jarvis.entities(id) on delete cascade,
  source       text not null check (source in ('K1','H1')),
  d0           date not null,
  d0_low       numeric,
  armed_until  date not null,
  promoted_at  timestamptz,
  evidence     jsonb not null default '{}',
  unique (entity_id, source, d0)
);

create table if not exists jarvis.queue_items (
  id          bigint generated always as identity primary key,
  date        date not null,
  entity_id   text not null references jarvis.entities(id) on delete cascade,
  queue       text not null check (queue in ('holding_alert','take_profit','buy','radar','pullback_wait')),
  reason      jsonb not null default '{}',
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  status      text not null default 'open' check (status in ('open','ignored','submitted','closed')),
  unique (date, entity_id)
);

-- ───────────────────────── M3 · M4 ─────────────────────────
create table if not exists jarvis.industry_heat (
  date                    date not null,
  l1                      text not null,
  n_score                 numeric(5,2),
  c_score                 numeric(5,2),
  sentiment               numeric(6,2),
  m3_median_rev_yoy_q0    numeric(8,2),
  m3_median_rev_yoy_q1    numeric(8,2),
  m3_median_op_yoy        numeric(8,2),
  m3_members              int,
  m3_pass                 boolean,
  m3_basis                jsonb not null default '{}',         -- realized/us_major_broker/outlook + 증권사·값·발표일
  basket_ret_1w           numeric(8,3),
  basket_ret_1m           numeric(8,3),
  created_at              timestamptz not null default now(),
  primary key (date, l1)
);

create table if not exists jarvis.industry_outlooks (
  id                  bigint generated always as identity primary key,
  l1                  text,                                    -- 문장 기준 매칭 결과. null/모호 = unverified
  source_type         text not null check (source_type in ('broker','research','company','government')),
  broker              text,
  segment             text,
  metric              text not null check (metric in ('CAGR','CAGR_DERIVED','NEXT_YEAR')),
  value_pct           numeric(7,2) not null,
  horizon             text,
  published_date      date not null,
  date_basis          text check (date_basis in ('meta','list')),
  publisher           text,
  domain              text,
  tier                text check (tier in ('A','B','other')),
  url                 text not null,
  quote               text not null,                           -- 원문 문장 그대로 (본문 전체 저장 금지)
  origin              text not null check (origin in ('google_news','bing_news','gdelt','broker_site','yaml')),
  adoption_rule       text check (adoption_rule in ('A1','B1','B2','manual')),
  corroborating_urls  text[] not null default '{}',
  conflict            boolean not null default false,
  status              text not null default 'unverified' check (status in ('adopted','unverified','excluded','expired')),
  match_detail        jsonb not null default '{}',
  adopted_at          timestamptz,
  expires_at          timestamptz,
  created_at          timestamptz not null default now(),
  unique (url, broker, l1, metric, value_pct)
);
create index if not exists industry_outlooks_l1_status_idx on jarvis.industry_outlooks (l1, status, published_date desc);

create table if not exists jarvis.outlook_fetch_log (
  id                bigint generated always as identity primary key,
  run_id            text not null,
  source            text not null,                             -- google_news/bing_news/gdelt/broker_site
  l1                text,
  query             text,
  http_status       int,
  result_count      int,
  articles_fetched  int,
  candidates        int,
  adopted           int,
  note              text,
  fetched_at        timestamptz not null default now()
);
create index if not exists outlook_fetch_log_run_idx on jarvis.outlook_fetch_log (run_id);

create table if not exists jarvis.catalyst_events (
  id          bigint generated always as identity primary key,
  scope       text not null check (scope in ('company','industry','macro')),
  entity_id   text references jarvis.entities(id) on delete cascade,
  l1          text,
  title       text not null,
  date        date,
  window_end  date,
  direction   text not null check (direction in ('up','down','neutral')),
  source      text not null,
  url         text,
  origin      text not null check (origin in ('snowball','hermes','heimdallr','earnings','yaml')),
  expires_at  timestamptz,
  dedupe_key  text not null unique,
  created_at  timestamptz not null default now(),
  constraint catalyst_has_date check (date is not null or window_end is not null),
  constraint catalyst_scope_target check (
    (scope = 'company' and entity_id is not null) or (scope = 'industry' and l1 is not null) or scope = 'macro')
);

-- ───────────────────────── 보유 캐시 (SnowBall 읽기 전용 스냅샷) ─────────────────────────
create table if not exists jarvis.holdings_cache (
  id           bigint generated always as identity primary key,
  snapshot_at  timestamptz not null default now(),
  payload      jsonb not null
);
create index if not exists holdings_cache_at_idx on jarvis.holdings_cache (snapshot_at desc);

-- ───────────────────────── 전달 ─────────────────────────
create table if not exists jarvis.notifications (
  id               bigint generated always as identity primary key,
  kind             text not null,                              -- green/urgent/brief_morning/brief_evening/weekly/scorecard/system
  dedupe_key       text not null unique,
  entity_id        text references jarvis.entities(id) on delete set null,
  payload          jsonb not null default '{}',
  sent_at          timestamptz,
  telegram_msg_id  bigint,
  created_at       timestamptz not null default now()
);

create table if not exists jarvis.inbox_log (
  source_ref      text primary key,
  notion_page_id  text,
  created_at      timestamptz not null default now()
);

-- ───────────────────────── 성과 (재생성 불가 → 주기 내보내기 대상) ─────────────────────────
create table if not exists jarvis.signal_ledger (
  id            bigint generated always as identity primary key,
  event_type    text not null,                                 -- queue/green/yellow/blue/inbox/ignore/snowball_submit
  entity_id     text references jarvis.entities(id) on delete set null,
  market        text check (market in ('KR','US')),
  tag           text,
  level         text,
  signal_date   date not null,                                 -- 시장 거래일
  entry_date    date,                                          -- 신호 다음 첫 거래일
  entry_price   numeric,
  benchmark     text,
  payload       jsonb not null default '{}',
  dedupe_key    text not null unique,
  created_at    timestamptz not null default now()
);

create table if not exists jarvis.outcomes (
  ledger_id      bigint not null references jarvis.signal_ledger(id) on delete cascade,
  horizon_days   int not null check (horizon_days in (5,20,60)),
  price          numeric,
  ret_pct        numeric(9,3),
  bench_ret_pct  numeric(9,3),
  excess_pct     numeric(9,3),
  measured_at    timestamptz not null default now(),
  primary key (ledger_id, horizon_days)
);

create table if not exists jarvis.weekly_memos (
  week              text primary key,                          -- '2026-W40'
  fact_table        jsonb not null default '{}',
  body_md           text,
  grounding_ok      boolean,
  notion_url        text,
  telegram_sent_at  timestamptz,
  created_at        timestamptz not null default now()
);

-- ───────────────────────── 운영 ─────────────────────────
create table if not exists jarvis.link_checks (
  id          bigint generated always as identity primary key,
  rule        text not null,
  sample_url  text not null,
  status      int,
  ok          boolean not null,
  note        text,
  checked_at  timestamptz not null default now()
);

-- 멱등(불변 규칙 13): 같은 (job, slot) 이 ok=true 로 있으면 즉시 종료
create table if not exists jarvis.job_runs (
  id           bigint generated always as identity primary key,
  job          text not null,
  slot         text not null,                                  -- 예: '2026-09-27T07:10' 또는 'manual-<uuid>'
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  ok           boolean,
  detail       jsonb not null default '{}'
);
create unique index if not exists job_runs_ok_once on jarvis.job_runs (job, slot) where ok is true;
create index if not exists job_runs_job_idx on jarvis.job_runs (job, started_at desc);

create table if not exists jarvis.cost_log (
  id             bigint generated always as identity primary key,
  at             timestamptz not null default now(),
  provider       text not null,
  model          text not null,
  purpose        text not null,
  input_tokens   int not null default 0,
  output_tokens  int not null default 0,
  usd            numeric(10,5) not null default 0
);

-- 소스별 마지막 수집 상태 (2회 연속 실패 → 🔧 알림, /health)
create table if not exists jarvis.source_health (
  source                text primary key,
  last_ok_at            timestamptz,
  last_error            text,
  consecutive_failures  int not null default 0,
  updated_at            timestamptz not null default now()
);

-- 봇 상태 (/mute 등 작은 키-값)
create table if not exists jarvis.bot_state (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- ───────────────────────── RLS · 권한 ─────────────────────────
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'jarvis' loop
    execute format('alter table jarvis.%I enable row level security', t);
    execute format('drop policy if exists %I on jarvis.%I', 'read_authenticated', t);
    execute format('create policy %I on jarvis.%I for select to authenticated using (true)', 'read_authenticated', t);
  end loop;
end $$;

revoke all on all tables in schema jarvis from anon, public;
grant select on all tables in schema jarvis to authenticated;
grant all on all tables in schema jarvis to service_role;
grant usage, select on all sequences in schema jarvis to service_role;
alter default privileges in schema jarvis grant select on tables to authenticated;
alter default privileges in schema jarvis grant all on tables to service_role;
alter default privileges in schema jarvis grant usage, select on sequences to service_role;
