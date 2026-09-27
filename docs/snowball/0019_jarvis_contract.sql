-- ============================================================================
-- 0019_jarvis_contract.sql — JARVIS 계약 (JARVIS PRD v1.2 §5.1, SnowBall D-xx)
-- ----------------------------------------------------------------------------
-- 목적: JARVIS 가 service_role 키 없이 아이언맨(member_key='ironman') 포트폴리오를
--       "읽기"만 하고, 발굴 후보를 investment_ideas 의 draft 로 "제출"만 하게 한다.
-- 방식: SECURITY DEFINER 함수 + Vault 공유 토큰(jarvis_token). anon 에는 EXECUTE 만 준다.
--       테이블 권한·RLS 는 건드리지 않는다.
-- 원칙: 매수 강제 규칙(논지·훼손조건·확신도)은 우회하지 않는다 — JARVIS 는 draft 만 만든다.
--
-- ▶ 실행 방법 (사용자)
--   1) 아래 ⑥ 의 'JARVIS_TOKEN_HERE' 를 새로 만든 긴 무작위 문자열로 바꾼다 (가이드 3단계).
--   2) Supabase → SQL Editor → New query → 이 파일 전체 붙여넣기 → Run.
--   3) 저장소에 커밋되는 파일에는 'JARVIS_TOKEN_HERE' 그대로 둔다 (토큰 커밋 금지).
--   4) 재실행해도 안전하다 (create or replace / 조건부 secret 갱신).
--
-- 스키마 근거(2026-09-27 실측): members(member_key enum), v_positions, holdings_snapshot,
--   factor_log.allowed_weight, indicators.heat_score/heat_breakdown, theses(invalidation_3 nullable, 0004),
--   triggers(direction positive|negative, status waiting|imminent|...), risk_alerts, macro_indicators,
--   net_worth_daily, benchmark_prices, investment_ideas(status_changed_at 0017), assets(watch_only), assets_master.
-- ============================================================================

-- ① 소유자 확인 + 토큰 검증 (내부 전용)
create or replace function public._jarvis_owner(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  tok text;
  fixed_owner text;
  v_owner uuid;
  n int;
begin
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'jarvis_token' limit 1;
  if tok is null or p_token is null or length(p_token) < 32 or p_token <> tok then
    raise exception 'jarvis: invalid token' using errcode = '28000';
  end if;

  -- 선택: 소유자 고정(jarvis_owner_id). 없으면 ironman 구성원이 정확히 1명일 때만 허용.
  select decrypted_secret into fixed_owner from vault.decrypted_secrets where name = 'jarvis_owner_id' limit 1;
  if fixed_owner is not null then
    return fixed_owner::uuid;
  end if;
  select count(*) into n from public.members where member_key = 'ironman';
  if n <> 1 then
    raise exception 'jarvis: ironman member count = % (set vault secret jarvis_owner_id)', n;
  end if;
  select owner_id into v_owner from public.members where member_key = 'ironman' limit 1;
  return v_owner;
end;
$$;
revoke all on function public._jarvis_owner(text) from public, anon, authenticated;

-- ② 보유 종목 (거래 기반 v_positions + 최신 스냅샷·허용비중·과열·논지·트리거·결정)
create or replace function public.jarvis_export_positions(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner uuid := public._jarvis_owner(p_token);
begin
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.weight desc nulls last)
    from (
      select
        a.id                         as asset_id,
        a.ticker, a.name, a.market::text as market, a.region::text as region,
        a.currency, a.sector, a.asset_class::text as asset_class,
        p.qty,
        coalesce(hs.avg_cost, case when p.buy_qty > 0 then p.buy_cost_krw / p.buy_qty end) as avg_cost_krw,
        hs.market_value, hs.weight, hs.date as snapshot_date,
        fl.allowed_weight, fl.date as allowed_weight_date,
        ind.heat_score, ind.heat_breakdown, ind.date as indicator_date,
        th.version as thesis_version, th.body as thesis_body, th.conviction,
        th.invalidation_1, th.invalidation_2, th.invalidation_3,
        (select count(*) from public.triggers t
          where t.asset_id = a.id and t.status in ('waiting','imminent')) as open_triggers,
        d.action::text as last_decision_action, d.date as last_decision_date
      from public.members m
      join public.v_positions p on p.member_id = m.id and p.owner_id = v_owner
      join public.assets a on a.id = p.asset_id
      left join lateral (
        select h.avg_cost, h.market_value, h.weight, h.date from public.holdings_snapshot h
        where h.member_id = m.id and h.asset_id = a.id order by h.date desc limit 1) hs on true
      left join lateral (
        select f.allowed_weight, f.date from public.factor_log f
        where f.member_id = m.id and f.asset_id = a.id order by f.date desc, f.created_at desc limit 1) fl on true
      left join lateral (
        select i.heat_score, i.heat_breakdown, i.date from public.indicators i
        where i.asset_id = a.id order by i.date desc limit 1) ind on true
      left join lateral (
        select t.* from public.theses t where t.asset_id = a.id order by t.version desc limit 1) th on true
      left join lateral (
        select dd.action, dd.date from public.decisions dd
        where dd.member_id = m.id and dd.asset_id = a.id order by dd.date desc, dd.created_at desc limit 1) d on true
      where m.owner_id = v_owner and m.member_key = 'ironman' and p.qty > 0
    ) x
  ), '[]'::jsonb);
end;
$$;

-- ③ 관심 종목 + 검토 중 아이디어
create or replace function public.jarvis_export_watchlist(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner uuid := public._jarvis_owner(p_token);
begin
  return jsonb_build_object(
    'watch_assets', coalesce((
      select jsonb_agg(jsonb_build_object('asset_id', a.id, 'ticker', a.ticker, 'name', a.name,
                                          'market', a.market::text, 'sector', a.sector))
      from public.assets a join public.members m on m.id = a.member_id
      where m.owner_id = v_owner and m.member_key = 'ironman' and a.watch_only), '[]'::jsonb),
    'ideas', coalesce((
      select jsonb_agg(jsonb_build_object('idea_id', i.id, 'asset_id', i.asset_id, 'scope', i.scope::text,
                                          'target', i.target, 'status', i.status::text,
                                          'source', i.payload->>'source', 'headline', i.payload->>'headline',
                                          'updated_at', i.updated_at))
      from public.investment_ideas i join public.members m on m.id = i.member_id
      where m.owner_id = v_owner and m.member_key = 'ironman'
        and i.status in ('draft','reviewed','watching')), '[]'::jsonb)
  );
end;
$$;

-- ④ 트리거 (JARVIS M4: 6개월 내 상승 이벤트). 방향은 positive|negative 그대로 반환.
create or replace function public.jarvis_export_triggers(p_token text, p_horizon_days int default 180)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner uuid := public._jarvis_owner(p_token);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'trigger_id', t.id, 'asset_id', a.id, 'ticker', a.ticker, 'market', a.market::text, 'name', a.name,
      'direction', t.direction::text, 'category', t.category::text, 'magnitude', t.magnitude::text,
      'expected_window', t.expected_window::text, 'expected_date', t.expected_date,
      'status', t.status::text, 'thesis_link', t.thesis_link::text,
      'one_line', t.one_line, 'source_url', t.source_url, 'updated_at', t.updated_at))
    from public.triggers t
    join public.assets a on a.id = t.asset_id
    join public.members m on m.id = t.member_id
    where m.owner_id = v_owner and m.member_key = 'ironman'
      and t.status in ('waiting','imminent')
      and (t.expected_date is null or t.expected_date <= current_date + p_horizon_days)
  ), '[]'::jsonb);
end;
$$;

-- ⑤-1 매크로 (레짐 등 키별 최신값)
create or replace function public.jarvis_export_macro(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner uuid := public._jarvis_owner(p_token);
begin
  return coalesce((
    select jsonb_object_agg(k.key, jsonb_build_object('value', k.value, 'date', k.date, 'source', k.source))
    from (select distinct on (key) key, value, date, source
          from public.macro_indicators order by key, date desc) k
  ), '{}'::jsonb);
end;
$$;

-- ⑤-2 미확인 리스크 경보
create or replace function public.jarvis_export_risk_alerts(p_token text, p_since timestamptz default now() - interval '7 days')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner uuid := public._jarvis_owner(p_token);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_id', r.id, 'rule_type', r.rule_type::text, 'asset_id', r.asset_id, 'ticker', a.ticker,
      'fired_at', r.fired_at, 'severity', r.severity::text, 'title', r.title, 'payload', r.payload)
      order by r.fired_at desc)
    from public.risk_alerts r
    join public.members m on m.id = r.member_id
    left join public.assets a on a.id = r.asset_id
    where m.owner_id = v_owner and m.member_key = 'ironman'
      and r.acknowledged = false and r.fired_at >= p_since
  ), '[]'::jsonb);
end;
$$;

-- ⑤-3 성과 (주간 메모용: 순자산 일별 + 벤치마크)
create or replace function public.jarvis_export_performance(p_token text, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner uuid := public._jarvis_owner(p_token);
begin
  return jsonb_build_object(
    'net_worth', coalesce((
      select jsonb_agg(jsonb_build_object('date', n.date, 'equity', n.equity, 'net_worth', n.net_worth) order by n.date)
      from public.net_worth_daily n join public.members m on m.id = n.member_id
      where m.owner_id = v_owner and m.member_key = 'ironman' and n.date between p_from and p_to), '[]'::jsonb),
    'benchmarks', coalesce((
      select jsonb_agg(jsonb_build_object('key', b.key, 'date', b.date, 'close', b.close) order by b.key, b.date)
      from public.benchmark_prices b where b.date between p_from and p_to), '[]'::jsonb)
  );
end;
$$;

-- ⑥ 아이디어 제출 (draft 만 생성·갱신. 매수·논지 생성은 하지 않는다)
--    p_payload = { "ticker": "000660"|"NVDA", "market": "KOSPI"|"NASDAQ"|null,
--                  "idea": { SnowBall PRD §4.3 스키마 필드 + jarvis_signals, jarvis_entry, jarvis_url } }
create or replace function public.jarvis_submit_idea(p_token text, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := public._jarvis_owner(p_token);
  mid uuid;
  am public.assets_master%rowtype;
  aid uuid;
  iid uuid;
  v_ticker text := nullif(trim(p_payload->>'ticker'), '');
  v_market text := nullif(trim(p_payload->>'market'), '');
  v_idea jsonb := coalesce(p_payload->'idea', '{}'::jsonb) || jsonb_build_object('source', 'jarvis');
begin
  if v_ticker is null then
    raise exception 'jarvis: ticker required';
  end if;
  if jsonb_typeof(p_payload->'idea') is distinct from 'object' then
    raise exception 'jarvis: idea object required';
  end if;

  select id into mid from public.members where owner_id = v_owner and member_key = 'ironman';

  if v_market is not null then
    select * into am from public.assets_master
      where ticker = v_ticker and market::text = v_market and active limit 1;
  else
    select * into am from public.assets_master
      where ticker = v_ticker and active order by (region = 'domestic') desc limit 1;
  end if;
  if am.id is null then
    raise exception 'jarvis: unknown asset % %', coalesce(v_market, '?'), v_ticker;
  end if;

  select id into aid from public.assets where member_id = mid and market = am.market and ticker = am.ticker;
  if aid is null then
    insert into public.assets (owner_id, member_id, master_ref, ticker, name, market, sector, asset_class, currency, region, watch_only)
    values (v_owner, mid, am.id, am.ticker, am.name, am.market, am.sector, am.asset_class, am.currency, am.region, true)
    returning id into aid;
  end if;

  -- 7일 내 사용자가 손대지 않은 JARVIS draft 가 있으면 새 버전으로 갱신, 아니면 새로 만든다
  select id into iid from public.investment_ideas
   where member_id = mid and asset_id = aid and status = 'draft' and user_edited = false
     and payload->>'source' = 'jarvis' and created_at > now() - interval '7 days'
   order by created_at desc limit 1;

  if iid is not null then
    update public.investment_ideas
       set payload = v_idea, version = version + 1, updated_at = now()
     where id = iid;
  else
    insert into public.investment_ideas (owner_id, member_id, asset_id, scope, target, payload, original_json, status, model)
    values (v_owner, mid, aid, 'asset', am.ticker, v_idea, v_idea, 'draft', 'jarvis-rules')
    returning id into iid;
  end if;
  return iid;
end;
$$;

-- ⑦ 권한: anon 은 공개 함수 EXECUTE 만. 내부 함수는 막는다.
revoke all on function public.jarvis_export_positions(text)                   from public;
revoke all on function public.jarvis_export_watchlist(text)                   from public;
revoke all on function public.jarvis_export_triggers(text, int)               from public;
revoke all on function public.jarvis_export_macro(text)                       from public;
revoke all on function public.jarvis_export_risk_alerts(text, timestamptz)    from public;
revoke all on function public.jarvis_export_performance(text, date, date)     from public;
revoke all on function public.jarvis_submit_idea(text, jsonb)                 from public;
grant execute on function public.jarvis_export_positions(text)                to anon, authenticated;
grant execute on function public.jarvis_export_watchlist(text)                to anon, authenticated;
grant execute on function public.jarvis_export_triggers(text, int)            to anon, authenticated;
grant execute on function public.jarvis_export_macro(text)                    to anon, authenticated;
grant execute on function public.jarvis_export_risk_alerts(text, timestamptz) to anon, authenticated;
grant execute on function public.jarvis_export_performance(text, date, date)  to anon, authenticated;
grant execute on function public.jarvis_submit_idea(text, jsonb)              to anon, authenticated;

-- ⑧ 토큰 저장 (이미 있으면 교체). 'JARVIS_TOKEN_HERE' 를 실제 토큰으로 바꿔 SQL Editor 에서만 실행.
do $$
declare sid uuid;
begin
  select id into sid from vault.secrets where name = 'jarvis_token';
  if sid is null then
    perform vault.create_secret('JARVIS_TOKEN_HERE', 'jarvis_token', 'JARVIS 읽기/아이디어 제출 공유 토큰 (0019)');
  else
    perform vault.update_secret(sid, 'JARVIS_TOKEN_HERE');
  end if;
end $$;

-- (선택) ironman 구성원이 여러 owner 에 존재하면 소유자를 고정한다:
-- select vault.create_secret('<auth.users.id>', 'jarvis_owner_id', 'JARVIS 대상 owner');

-- ⑨ 확인
-- select public.jarvis_export_positions('<토큰>');           -- 보유 종목 jsonb
-- select public.jarvis_export_positions('wrong-token-xxxxxxxxxxxxxxxxxxxxxxxxxxxx');  -- 오류가 나야 정상
