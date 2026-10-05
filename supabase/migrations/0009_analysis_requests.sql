-- 🔎 Heimdallr 산업·기업 분석 요청 장부 + 🎤 발표자료 (D59)
-- ▶ 실행: 대시보드 SQL Editor 에서 전체 실행 (치환 없음). 재실행 안전.
--   JARVIS 텔레그램 🏭·🏢 버튼 → Heimdallr jarvis_request_analysis RPC 접수 결과를 남기고,
--   poll(30분)이 jarvis_analysis_status 로 완료를 확인해 노션 링크·🎤 버튼을 보낸다. 분석 본문은 저장하지 않는다(노션 링크만).

create table if not exists jarvis.analysis_requests (
  id                  bigint generated always as identity primary key,
  kind                text not null check (kind in ('company', 'industry')),
  entity_id           text references jarvis.entities(id) on delete set null,   -- 기업 요청·산업 요청을 누른 종목
  target_name         text not null,                                              -- 기업명 또는 산업명
  heimdallr_id        bigint,                                                     -- Heimdallr kairos_requests 요청 ID
  status              text not null check (status in ('queued', 'working', 'reused', 'sent', 'failed', 'rejected')),
  notion_url          text,
  error               text,
  deck_status         text check (deck_status in ('queued', 'working', 'sent', 'failed')),
  deck_notion_url     text,
  deck_error          text,
  notified_at         timestamptz,                                                -- 분석 완료/실패를 텔레그램으로 알린 시각
  deck_notified_at    timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists analysis_requests_open_idx on jarvis.analysis_requests (status, deck_status);
create index if not exists analysis_requests_target_idx on jarvis.analysis_requests (kind, target_name, created_at desc);

do $$
begin
  execute 'alter table jarvis.analysis_requests enable row level security';
  execute 'drop policy if exists read_allowed on jarvis.analysis_requests';
  execute 'create policy read_allowed on jarvis.analysis_requests for select to authenticated using (jarvis.is_allowed())';
  execute 'grant select on jarvis.analysis_requests to authenticated';
  execute 'grant all on jarvis.analysis_requests to service_role';
end $$;
grant usage, select on all sequences in schema jarvis to service_role;
