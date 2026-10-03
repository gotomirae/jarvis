-- P4 주간 투자위원회 스케줄 (PRD §10.1·§14, D52)
-- ▶ 실행: 대시보드 SQL Editor 에서 전체 실행 (치환 없음 — Vault 토큰은 0002 에서 저장됨). 재실행 안전.
--   토 09:30 KST 첫 호출. FlyWheel 주간 리포트(토 08:00 전후)가 아직 없으면 잡이 스스로 미루고, 09:45·10:00·10:15·10:30 에 다시 불린다.
--   10:30 호출은 리포트가 없어도 "미도착"으로 발행한다. 이미 발행된 주는 즉시 끝난다(멱등).
--   확인: select jobname, schedule from cron.job where jobname like 'jarvis-weekly%';

-- 토 09:30·09:45 KST = 토 00:30·00:45 UTC / 10:00·10:15·10:30 KST = 01:00·01:15·01:30 UTC
select cron.unschedule(jobid) from cron.job where jobname in ('jarvis-weekly-a', 'jarvis-weekly-b');
select cron.schedule('jarvis-weekly-a', '30,45 0 * * 6', $$select jarvis.dispatch_job('weekly_memo', '')$$);
select cron.schedule('jarvis-weekly-b', '0,15,30 1 * * 6', $$select jarvis.dispatch_job('weekly_memo', '')$$);
