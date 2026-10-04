/**
 * 대시보드 탭 — 묶음·이름·아이콘·활용법 (사용자 지정 2026-10-04·05).
 * 10/5: 시스템 상태 탭 삭제(주소 /health 로만 접근), 산업 레이더 + 산업 성장 근거 통합, "내 보유 종목" → "아이언맨의 포트폴리오"
 */
export type Tab = { href: string; icon: string; label: string; when: string; how: string[] };
export type TabGroup = { name: string; tabs: Tab[] };

export const TAB_GROUPS: TabGroup[] = [
  { name: "매일", tabs: [
    { href: "/", icon: "🏠", label: "오늘", when: "브리핑 직후 하루 2번",
      how: ["🚦 시장 국면 · ⚠️ 보유 경고 먼저", "🎯 지금 사기 좋은 종목: 🏢 기업 → ⏱️ 타이밍 순서로", "📊 주요 지표 그래프로 시장 온도 확인"] },
    { href: "/entry", icon: "🚦", label: "진입 보드", when: "🟢 알림이 왔을 때",
      how: ["필수 조건 5개 모두 ✅ 인지 확인", "주가 · MACD · RSI 그래프로 타이밍 확인", "무효화 가격 · 1차 비중을 SnowBall에 기록"] },
  ] },
  { name: "점검", tabs: [
    { href: "/verify", icon: "✅", label: "사후 검증", when: "주 1회",
      how: ["추천 승률 · 시장 대비 수익 확인", "🚫 자동 제외된 기준 확인", "⭐ 잘 맞은 기준 확인"] },
    { href: "/portfolio", icon: "🦾", label: "아이언맨의 포트폴리오", when: "주 1회",
      how: ["🔴 허용 비중 초과 · ⚠️ 경고 종목부터", "반영도 높음 + 과열 높음 → 익절 검토", "투자 논지는 SnowBall에서 갱신"] },
  ] },
  { name: "탐색", tabs: [
    { href: "/radar", icon: "📡", label: "산업 레이더", when: "새 아이디어를 찾을 때",
      how: ["섹터 그래프: 이번 주 등락 · 12개월 흐름", "🔄 주기: 회복 · 확장 구간 섹터 주목", "고성장 ✅ 근거는 아래 표에서 확인"] },
    { href: "/weekly", icon: "🏛️", label: "주간 투자위원회", when: "토요일 아침",
      how: ["한 주 시장 · 산업 흐름 정리", "시나리오 · 권장 현금 비중 확인", "결정할 것 → SnowBall 결정 기록"] },
  ] },
  { name: "관리", tabs: [
    { href: "/scorecard", icon: "📈", label: "신호 성적표", when: "분기마다",
      how: ["큐별 5 · 20 · 40 · 60거래일 성과", "표본 30건 이상만 신뢰", "보정 제안은 승인한 것만 반영"] },
    { href: "/taxonomy", icon: "🗂️", label: "산업 분류", when: "확인 대기가 있을 때",
      how: ["맞는 산업 골라 확정", "7일 넘은 대기는 빨간 테두리", "노션 산업 목록 변경 알림"] },
  ] },
];

export const TABS: Tab[] = TAB_GROUPS.flatMap((g) => g.tabs);

/** 현재 경로의 탭 (/growth 는 산업 레이더로 통합) */
export const tabOf = (path: string): Tab | undefined =>
  path === "/" ? TABS[0] : path.startsWith("/growth") ? TABS.find((t) => t.href === "/radar") : TABS.find((t) => t.href !== "/" && path.startsWith(t.href));
