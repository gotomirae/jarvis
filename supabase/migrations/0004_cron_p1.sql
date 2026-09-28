-- P1 스케줄 (PRD §14, D7·D21). pg_cron 은 UTC. 슬롯 이름에 KST 날짜를 넣어 멱등(같은 슬롯 성공 시 건너뜀)을 보장한다.
-- ▶ 실행: 대시보드 SQL Editor 에서 전체 실행 (토큰 치환 없음 — 0002 에서 Vault 에 저장한 토큰을 쓴다). 재실행 안전.
--   확인: select jobname, schedule from cron.job where jobname like 'jarvis-%' order by 1;

create or replace function jarvis.kst_slot(suffix text)
returns text language sql stable as $$
  select to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD') || '-' || suffix
$$;

select cron.unschedule(jobid) from cron.job
 where jobname in ('jarvis-holdings-am', 'jarvis-holdings-pm', 'jarvis-entities', 'jarvis-taxonomy', 'jarvis-link-smoke');

-- 07:10 KST = 22:10 UTC(전날) / 16:10 KST = 07:10 UTC — 보유 캐시 (PRD §4.3)
select cron.schedule('jarvis-holdings-am', '10 22 * * *', $$select jarvis.dispatch_job('holdings_sync', '--slot ' || jarvis.kst_slot('am'))$$);
select cron.schedule('jarvis-holdings-pm', '10 7 * * *',  $$select jarvis.dispatch_job('holdings_sync', '--slot ' || jarvis.kst_slot('pm'))$$);
-- 일 03:00 KST = 토 18:00 UTC — 종목 마스터 · 산업 매핑 (taxonomy 가 먼저 돌아 확정 overrides 를 entities 가 쓰도록 5분 간격)
select cron.schedule('jarvis-taxonomy', '0 18 * * 6', $$select jarvis.dispatch_job('taxonomy_sync', '--slot ' || jarvis.kst_slot('weekly'))$$);
select cron.schedule('jarvis-entities', '5 18 * * 6', $$select jarvis.dispatch_job('entities_sync', '--slot ' || jarvis.kst_slot('weekly'))$$);
-- 매일 03:30 KST = 18:30 UTC — 링크 스모크 (PRD §9.4)
select cron.schedule('jarvis-link-smoke', '30 18 * * *', $$select jarvis.dispatch_job('link_smoke', '--slot ' || jarvis.kst_slot('daily'))$$);
