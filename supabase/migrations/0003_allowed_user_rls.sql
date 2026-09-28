-- P1: 대시보드 로그인(매직링크) 대비 — 읽기 권한을 "허용 이메일 1개(ALLOWED_EMAIL)"로 좁힌다 (PRD §8).
-- 0001 의 정책은 authenticated 전체 허용이었다. Supabase 는 기본적으로 anon 키로 누구나 가입할 수 있으므로,
-- 가입만 하면 JARVIS 데이터를 읽을 수 있는 구멍을 막는다. 이메일은 공개 저장소에 적지 않고 테이블에 둔다.
--
-- ▶ 실행: 대시보드 SQL Editor 에서 이 파일 전체 실행 (토큰·이메일 치환 없음, 재실행 안전)
-- ▶ 허용 이메일 등록: `npm run job -- auth_setup` (ALLOWED_EMAIL 값을 service 키로 넣는다)

-- ① 허용 사용자 (service_role 만 접근)
create table if not exists jarvis.allowed_users (
  email       text primary key,
  created_at  timestamptz not null default now()
);
alter table jarvis.allowed_users enable row level security;
revoke all on jarvis.allowed_users from anon, authenticated, public;
grant all on jarvis.allowed_users to service_role;

-- ② 현재 로그인 사용자가 허용 이메일인가 (security definer: allowed_users 를 직접 노출하지 않는다)
create or replace function jarvis.is_allowed()
returns boolean
language sql
stable
security definer
set search_path = jarvis, public
as $$
  select exists (select 1 from jarvis.allowed_users where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
revoke all on function jarvis.is_allowed() from public, anon;
grant execute on function jarvis.is_allowed() to authenticated;

-- ③ 모든 jarvis 테이블의 읽기 정책을 허용 사용자 전용으로 교체
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'jarvis' and tablename <> 'allowed_users' loop
    execute format('drop policy if exists %I on jarvis.%I', 'read_authenticated', t);
    execute format('drop policy if exists %I on jarvis.%I', 'read_allowed', t);
    execute format('create policy %I on jarvis.%I for select to authenticated using (jarvis.is_allowed())', 'read_allowed', t);
  end loop;
end $$;

-- ④ 종목 L1 결정 근거 (override/snowball/heimdallr/hermescall/products/none) — /taxonomy 표시용
alter table jarvis.entities add column if not exists l1_basis text;
