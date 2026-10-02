-- P3 진입 신호 (PRD §7·§14, D50): entry_eval 재시도 스케줄 + 조회 인덱스
-- ▶ 실행: 대시보드 SQL Editor 에서 전체 실행 (치환 없음). 재실행 안전.
--   entry_eval 은 07:12·19:10 pipeline 안에서도 돈다. 21:40 은 Heimdallr entry_checks(17:37~19:07, GitHub 지연 잦음)가
--   늦게 도착한 날의 재시도 — 같은 날 이미 보낸 🟢 는 dedupe 로 다시 보내지 않는다.
--   확인: select jobname, schedule from cron.job where jobname = 'jarvis-entry-retry';

create index if not exists entry_eval_level_idx on jarvis.entry_eval (level, date desc);
create index if not exists entry_eval_market_date_idx on jarvis.entry_eval (market, date desc);
create index if not exists breakout_watch_armed_idx on jarvis.breakout_watch (armed_until desc);

-- 21:40 KST = 12:40 UTC
select cron.unschedule(jobid) from cron.job where jobname = 'jarvis-entry-retry';
select cron.schedule('jarvis-entry-retry', '40 12 * * *', $$select jarvis.dispatch_job('entry_eval', '--slot ' || jarvis.kst_slot('retry'))$$);
