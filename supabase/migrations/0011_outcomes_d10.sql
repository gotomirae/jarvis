-- 사후 검증 D+10 추가 (D69, 사용자 지정 2026-10-09 — 기준별 승률을 10거래일 · 20거래일 뒤로 나눠 본다)
-- ▶ 실행: 대시보드 SQL Editor 에서 전체 실행 (치환 없음). 재실행 안전.
--   실행 전에도 outcomes_update 는 멈추지 않는다 — D+10 은 저장하지 않고 그날 집계(perf_stats)에만 쓴다.
--   확인: select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'jarvis.outcomes'::regclass and contype = 'c';

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
alter table jarvis.outcomes add constraint outcomes_horizon_days_check check (horizon_days in (5, 10, 20, 40, 60));
