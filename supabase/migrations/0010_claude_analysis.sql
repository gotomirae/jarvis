-- 🧠 Claude 심층 분석 단계 (D60): Codex 분석 완료 → Heimdallr 가 자동으로 Claude Code kairos-deck(analysis 모드) 실행
--    → JARVIS 가 완료를 알리고 🎤 발표자료는 그다음에만 제공한다.
-- ▶ 실행: 대시보드 SQL Editor 에서 전체 실행 (치환 없음). 재실행 안전.

alter table jarvis.analysis_requests
  add column if not exists claude_status      text check (claude_status in ('queued', 'working', 'sent', 'failed', 'none')),
  add column if not exists claude_notion_url  text,
  add column if not exists claude_error       text,
  add column if not exists claude_notified_at timestamptz,
  add column if not exists top_pick           jsonb;          -- 산업 분석: Claude 2단계 선별 최고 기업 {name, market, code}
