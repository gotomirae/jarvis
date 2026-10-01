-- 성과 원장 D+5·20·40·60 (PRD §12, D47) + outcomes_update 스케줄 (20:00 KST) + 성과 피드백 perf_stats·calibration_reviews (D49)
-- ▶ 실행: 대시보드 SQL Editor 에서 전체 실행 (치환 없음 — Vault 토큰은 0002 에서 저장됨). 재실행 안전.
--   확인: select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'jarvis.outcomes'::regclass;
--         select jobname, schedule from cron.job where jobname = 'jarvis-outcomes';

-- ① 측정 기간에 D+40 추가 (기존 check 제약 이름이 무엇이든 horizon_days 제약을 교체)
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'jarvis.outcomes'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%horizon_days%'
  loop
    execute format('alter table jarvis.outcomes drop constraint %I', c);
  end loop;
end $$;
alter table jarvis.outcomes add constraint outcomes_horizon_days_check check (horizon_days in (5, 20, 40, 60));

-- ② D+N 평가일(거래일) — 주간 메모 "신호 복기"·성적표에서 기간 대조
alter table jarvis.outcomes add column if not exists horizon_date date;

-- ③ 조회 인덱스
create index if not exists signal_ledger_signal_date_idx on jarvis.signal_ledger (signal_date);
create index if not exists signal_ledger_entity_idx on jarvis.signal_ledger (entity_id);

-- ④ 매일 20:00 KST = 11:00 UTC — 원장 동기화 → 성과 측정 (Actions, 예비 20:30)
select cron.unschedule(jobid) from cron.job where jobname = 'jarvis-outcomes';
select cron.schedule('jarvis-outcomes', '0 11 * * *', $$select jarvis.dispatch_job('outcomes_update', '--slot ' || jarvis.kst_slot('daily'))$$);

-- ───────────── 성과 피드백 (D49) ─────────────
-- ⑤ 큐·신호 특징 구간별 성과 스냅샷 (outcomes_update 가 매일 as_of 1벌을 교체 저장) — 브리핑 🎯 순위·카드, /scorecard, 분기 보정이 읽는다
create table if not exists jarvis.perf_stats (
  as_of          date not null,
  scope          text not null,                 -- 큐: buy · radar · pullback_wait · take_profit · holding_alert
  dimension      text not null,                 -- all · families · sources · p_bucket · grade · market · l1
  bucket         text not null,
  horizon_days   int  not null,
  n              int  not null,
  median_excess  numeric(9,3),
  mean_excess    numeric(9,3),
  hit_rate       numeric(5,3),
  median_ret     numeric(9,3),
  enough         boolean not null default false,  -- 표본 ≥ feedback.min_samples
  primary key (as_of, scope, dimension, bucket, horizon_days)
);

-- ⑥ 분기 보정 제안 기록 — 제안만(자동 적용 금지). 사용자가 승인·반려하면 status·decided_at·note 갱신
create table if not exists jarvis.calibration_reviews (
  id                bigint generated always as identity primary key,
  period            text not null,              -- '2027년 1분기'
  review_date       date not null,
  stats_as_of       date,
  proposals         jsonb not null default '[]',
  summary           jsonb not null default '{}',
  status            text not null default 'open' check (status in ('open', 'no_change', 'applied', 'rejected', 'partial')),
  decided_at        timestamptz,
  note              text,
  telegram_sent_at  timestamptz,
  created_at        timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['perf_stats', 'calibration_reviews'] loop
    execute format('alter table jarvis.%I enable row level security', t);
    execute format('drop policy if exists read_allowed on jarvis.%I', t);
    execute format('create policy read_allowed on jarvis.%I for select to authenticated using (jarvis.is_allowed())', t);
    execute format('grant select on jarvis.%I to authenticated', t);
    execute format('grant all on jarvis.%I to service_role', t);
  end loop;
end $$;
grant usage, select on all sequences in schema jarvis to service_role;

-- ⑦ 매주 토 10:30 KST = 01:30 UTC — 분기 첫 토요일에만 실제 실행(잡이 판단)
select cron.unschedule(jobid) from cron.job where jobname = 'jarvis-calibration';
select cron.schedule('jarvis-calibration', '30 1 * * 6', $$select jarvis.dispatch_job('calibration_review', '--slot ' || jarvis.kst_slot('calibration'))$$);
