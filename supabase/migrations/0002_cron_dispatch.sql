-- D7: 정시 실행 = pg_cron → GitHub workflow_dispatch (SnowBall 0016_cron_dispatch.sql 패턴).
-- GitHub schedule 은 실측 수 시간 지연 → .github/workflows/jobs.yml 의 schedule 은 30분 뒤 예비로만 둔다.
--
-- ▶ 실행 방법 (사용자, 대시보드 SQL Editor에서만 — vault 권한):
--   1) GitHub Fine-grained PAT: 저장소 gotomirae/jarvis 만, Permissions → Actions: Read and write
--   2) 아래 ③의 'GITHUB_TOKEN_HERE' 두 곳을 편집기 안에서만 토큰으로 바꿔 전체 실행 (파일에는 저장·커밋 금지)
--   3) 확인: select jobname, schedule from cron.job where jobname like 'jarvis-%';
--            select status_code, created from net._http_response order by created desc limit 5;  -- 204 = 성공
--
-- 스케줄은 Phase 별로 해당 잡이 구현된 뒤 추가한다(없는 잡을 부르면 Actions 분만 소모). P0 에서는 outlook_smoke 만 등록.
-- pg_cron 은 UTC 기준이다(KST = UTC+9).

-- ① 확장
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ② workflow_dispatch 호출 (토큰은 Vault 에서 읽는다)
create or replace function jarvis.dispatch_job(job text, args text default '')
returns bigint
language plpgsql
security definer
set search_path = jarvis, public, extensions
as $$
declare
  tok text;
  rid bigint;
begin
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'jarvis_github_dispatch_token' limit 1;
  if tok is null then
    raise warning 'jarvis_github_dispatch_token 이 Vault 에 없습니다';
    return null;
  end if;
  select net.http_post(
    url := 'https://api.github.com/repos/gotomirae/jarvis/actions/workflows/jobs.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || tok,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'jarvis-pg-cron',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('ref', 'master', 'inputs', jsonb_build_object('job', job, 'args', args))
  ) into rid;
  return rid;
end;
$$;
revoke all on function jarvis.dispatch_job(text, text) from public, anon, authenticated;

-- ③ 토큰 저장 (이미 있으면 교체). 'GITHUB_TOKEN_HERE' 를 편집기 안에서만 실제 토큰으로 바꿔 실행
do $$
declare sid uuid;
begin
  select id into sid from vault.secrets where name = 'jarvis_github_dispatch_token';
  if sid is null then
    perform vault.create_secret('GITHUB_TOKEN_HERE', 'jarvis_github_dispatch_token', 'GitHub fine-grained PAT (gotomirae/jarvis Actions RW) — pg_cron 정시 시작 (D7)');
  else
    perform vault.update_secret(sid, 'GITHUB_TOKEN_HERE');
  end if;
end $$;

-- ④ 스케줄 (P0). 이후 Phase 마이그레이션이 jarvis-* 잡을 추가한다.
--    04:00 KST 일·수 = 19:00 UTC 토·화 — M3 ② 무료 소스 스모크 (P2 부터 industry_outlook_collect 로 교체)
select cron.unschedule(jobid) from cron.job where jobname in ('jarvis-outlook-smoke');
select cron.schedule('jarvis-outlook-smoke', '0 19 * * 2,6', $$select jarvis.dispatch_job('outlook_smoke', '')$$);
