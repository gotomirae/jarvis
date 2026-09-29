-- P2: M3 ② 수집 기록 · Vercel 라우트 정시 호출 · P2 스케줄 (PRD §14, D32·D33)
-- ▶ 실행: 대시보드 SQL Editor. ③ 의 'JARVIS_URL_HERE'·'CRON_SECRET_HERE' 를 편집기 안에서만 바꿔 실행(파일에 저장·커밋 금지).
--   CRON_SECRET 은 Vercel 환경변수 CRON_SECRET 과 같은 값이어야 한다. 실행 후 쿼리 탭 내용을 지우고 삭제한다.

-- ① M3 ② 이미 처리한 기사 URL (다시 받지 않음, 120일)
create table if not exists jarvis.outlook_seen (
  url           text primary key,
  seen_at       timestamptz not null default now(),
  http_status   int,
  candidates    int not null default 0
);
alter table jarvis.outlook_seen enable row level security;
drop policy if exists read_allowed on jarvis.outlook_seen;
create policy read_allowed on jarvis.outlook_seen for select to authenticated using (jarvis.is_allowed());
grant select on jarvis.outlook_seen to authenticated;
grant all on jarvis.outlook_seen to service_role;

-- ② Vercel 라우트 호출 (가벼운 잡: 30분 폴링·브리핑 — Actions 분 절약, GitHub 대기 없음)
create or replace function jarvis.call_route(job text)
returns bigint
language plpgsql
security definer
set search_path = jarvis, public, extensions
as $$
declare
  base text; sec text; rid bigint;
begin
  select decrypted_secret into base from vault.decrypted_secrets where name = 'jarvis_base_url' limit 1;
  select decrypted_secret into sec from vault.decrypted_secrets where name = 'jarvis_cron_secret' limit 1;
  if base is null or sec is null then
    raise warning 'jarvis_base_url / jarvis_cron_secret 이 Vault 에 없습니다';
    return null;
  end if;
  select net.http_post(
    url := rtrim(base, '/') || '/api/cron/' || job,
    headers := jsonb_build_object('Authorization', 'Bearer ' || sec, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) into rid;
  return rid;
end;
$$;
revoke all on function jarvis.call_route(text) from public, anon, authenticated;

-- ③ Vault (이미 있으면 교체)
do $$
declare sid uuid;
begin
  select id into sid from vault.secrets where name = 'jarvis_base_url';
  if sid is null then perform vault.create_secret('JARVIS_URL_HERE', 'jarvis_base_url', 'JARVIS Vercel 주소');
  else perform vault.update_secret(sid, 'JARVIS_URL_HERE'); end if;
  select id into sid from vault.secrets where name = 'jarvis_cron_secret';
  if sid is null then perform vault.create_secret('CRON_SECRET_HERE', 'jarvis_cron_secret', 'JARVIS /api/cron 호출 비밀값 (= Vercel CRON_SECRET)');
  else perform vault.update_secret(sid, 'CRON_SECRET_HERE'); end if;
end $$;

-- ④ 스케줄 (UTC). 무거운 잡 = Actions(dispatch_job), 가벼운 잡 = Vercel(call_route)
select cron.unschedule(jobid) from cron.job where jobname in (
  'jarvis-outlook-smoke', 'jarvis-outlook', 'jarvis-growth-am', 'jarvis-growth-pm', 'jarvis-pipeline-am', 'jarvis-pipeline-pm',
  'jarvis-brief-am', 'jarvis-brief-pm', 'jarvis-poll');
-- 07:00·19:00 KST — M3 종합 (① 실적 · ② 증권사 · ③ 전망)
select cron.schedule('jarvis-growth-am', '0 22 * * *', $$select jarvis.dispatch_job('industry_growth_realized', '--slot ' || jarvis.kst_slot('am'))$$);
select cron.schedule('jarvis-growth-pm', '0 10 * * *', $$select jarvis.dispatch_job('industry_growth_realized', '--slot ' || jarvis.kst_slot('pm'))$$);
-- 07:12·19:10 KST — ingest_all → catalysts → axes·queues·SnowBall 제출 (holdings_sync 07:10 이후)
select cron.schedule('jarvis-pipeline-am', '12 22 * * *', $$select jarvis.dispatch_job('pipeline', '--slot ' || jarvis.kst_slot('am'))$$);
select cron.schedule('jarvis-pipeline-pm', '10 10 * * *', $$select jarvis.dispatch_job('pipeline', '--slot ' || jarvis.kst_slot('pm'))$$);
-- 07:30·19:20 KST — 브리핑 (Vercel)
select cron.schedule('jarvis-brief-am', '30 22 * * *', $$select jarvis.call_route('brief_morning')$$);
select cron.schedule('jarvis-brief-pm', '20 10 * * *', $$select jarvis.call_route('brief_evening')$$);
-- 30분마다 — 보유 경고 (Vercel)
select cron.schedule('jarvis-poll', '*/30 * * * *', $$select jarvis.call_route('poll')$$);
-- 일·수 04:00 KST — M3 ② 무료 검색 수집 (P0 스모크 대체)
select cron.schedule('jarvis-outlook', '0 19 * * 2,6', $$select jarvis.dispatch_job('industry_outlook_collect', '--slot ' || jarvis.kst_slot('outlook'))$$);
