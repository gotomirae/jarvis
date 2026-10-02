import { describe, expect, it } from "vitest";
import { BRIEF_SPLIT, briefText, calibrationText, greenText, holdingAlertText, ideaBlock, marketLine, systemText, type BriefData } from "./templates";

describe("telegram templates", () => {
  it("보유 경고 (부록 B.3) — escape·비중 %·매수 확정 아님", () => {
    const t = holdingAlertText({ market: "KR", name: "이수<페타시스>", code: "007660", causes: [{ summary: "고점 대비 -23.0%", source: "SnowBall drawdown/warn" }],
      thesisLink: "SnowBall 훼손조건: AI 가속기 CAPEX 둔화", weight: 0.078, allowed: 0.085, heat: 62, pri: 58 });
    expect(t).toContain("🇰🇷 <b>이수&lt;페타시스&gt;</b> (007660)");
    expect(t).toContain("결론: 투자 논지를 다시 확인할 때입니다 — 고점 대비 -23.0%");
    expect(t).toContain(" · 비중 7.8% (허용 비중 8.5%) · 과열 점수 62 · 주가 반영도 58");
    expect(t).toContain("연결된 투자 논지: SnowBall 훼손조건");
    expect(t).toContain("매수 확정 신호가 아닙니다");
    const u = holdingAlertText({ market: "US", name: "X", code: "X", causes: [], thesisLink: null, weight: null, allowed: null, heat: null, pri: null });
    expect(u).toContain("🇺🇸 <b>X</b>");
    expect(u).toContain("비중 - (허용 비중 -) · 과열 점수 - · 주가 반영도 -");
    expect(u).toContain("결론: 투자 논지를 다시 확인할 때입니다\n");
    expect(holdingAlertText({ market: null, name: "펀드", code: "F", causes: [], thesisLink: null, weight: 0, allowed: 0, heat: 0, pri: 0 })).toContain("<b>보유 경고</b> ·  <b>펀드</b>");
  });

  it("브리핑 (부록 B.2) — 🎯 추천 카드 최대 5개·그 밖의 관찰 요약", () => {
    const card = {
      rank: 1, name: "저스템", code: "417840", industry: "반도체", flag: "🇰🇷",
      thesis: "습도제어 <과점>", reasons: ["① 실적 가속: 매출 +159%", "② 주가 덜 반영: 33/100"],
      events: ["~11/30 3Q 실적 (Heimdallr 분석)"], risk: "일회성 가능성 → 확인: 3Q 매출", tech: "RSI 55(중립)", links: '🔗 <a href="u">네이버</a>',
    };
    const d: BriefData = {
      kind: "evening", date: "2026-10-22",
      market: [{ label: "KOSPI", last: 2600, change_pct: 0.8 }, { label: "원/달러", last: 1350.5, change_pct: -0.1, level: true }, { label: "X", last: null, change_pct: null }],
      sectors: [{ label: "A", change_pct: 1 }, { label: "B", change_pct: -2 }, { label: "C", change_pct: null }, { label: "D", change_pct: 0.5 }],
      regime: { risk_off: true, reasons: ["VIX 30 ≥ 25 & KOSPI < 60일선"] },
      counts: { green: 1, yellow: 3, blue: 2, alert: 0 }, alertsPaused: true,
      earnings: { title: "오늘 국내 실적", lines: ["★ 리노공업 (058470)"] },
      focus: "KR", buyTotal: 8,
      ideas: [card, { ...card, rank: 2, name: "B", code: "1", industry: "", thesis: null, reasons: [], events: [], risk: null, tech: null, links: "" }, { ...card, rank: 7 }],
      others: [{ icon: "🔭", label: "선행 레이더", names: ["a", "b", "c", "d", "e", "f", "g"] }, { icon: "⏳", label: "눌림 대기", names: [] }],
      holding: ["⚠️ a: b"], schedule: { title: "내일 일정", lines: ["<x>"] }, asOf: "2026-10-22 19:20",
    };
    const t = briefText(d);
    expect(t).toContain("🌙 <b>2026-10-22 저녁 브리핑</b>");
    expect(t).toContain("📈 KOSPI +0.8% · 원/달러 1,350.5 (-0.1%) · X -");
    expect(t).toContain("🏭 섹터 ▲ A +1.0%, D +0.5% / ▼ B -2.0%, D +0.5%");
    expect(t).toContain("🔴 시장 국면: 위험 회피 — VIX 30 ≥ 25 &amp; KOSPI &lt; 60일선 (진입 1차 비중 절반)");
    expect(t).toContain("보유 경고 0 (⏸ 알림 정지 중)");
    expect(t).toContain("🎯 <b>매수 검토 추천</b> (🇰🇷 국내 우선) TOP 3 / 전체 8");
    expect(t).toContain('1️⃣ 🇰🇷 <b>저스템</b> (417840) · 반도체\n\n💡 <b>투자 아이디어</b>\n습도제어 &lt;과점&gt;\n\n📈 <b>매수 근거</b>\n① 실적 가속: 매출 +159%\n② 주가 덜 반영: 33/100\n\n⏰ 다음 확인: ~11/30 3Q 실적 (Heimdallr 분석)\n⚠️ 리스크: 일회성 가능성 → 확인: 3Q 매출\n📊 기술적 참고(판정 미사용): RSI 55(중립)\n🔗 <a href="u">네이버</a>');
    expect(t).toContain("2️⃣ 🇰🇷 <b>B</b> (1)\n");
    expect(t).toContain("7. 🇰🇷 <b>저스템</b>");
    expect(t).toContain("🔭 선행 레이더 7: a · b · c · d · e · f 외");
    expect(t).not.toContain("눌림 대기");
    expect(t).toContain("📣 <b>오늘 국내 실적</b>\n· ★ 리노공업 (058470)");
    expect(t).toContain("📅 <b>내일 일정</b>\n· &lt;x&gt;");
    const m = briefText({ ...d, kind: "morning", focus: "US", market: [], sectors: [{ label: "A", change_pct: null }], regime: { risk_off: false, reasons: [] }, alertsPaused: false, earnings: { title: "t", lines: [] }, ideas: [], buyTotal: 0, others: [], holding: [], schedule: { title: "s", lines: [] } });
    expect(m).toContain("☀️");
    expect(m).toContain("시세 수집 실패");
    expect(m).toContain("🟢 시장 국면: 정상");
    expect(m).toContain("🎯 <b>매수 검토 추천</b> (🇺🇸 미국 우선) — 오늘 없음");
    expect(m).not.toContain("섹터");
    expect(m).not.toContain("그 밖의");
    expect(briefText({ ...d, sectors: undefined, buyTotal: 3 })).toContain("TOP 3\n");
    expect(marketLine({ label: "S&P 500", last: 5000, change_pct: Infinity })).toBe("S&amp;P 500 -");
    expect(["1️⃣ 🇰🇷 x", "7. x", "━━", "👀 x", "📣 x", "💼 x", "📅 x"].every((l) => BRIEF_SPLIT.test(l))).toBe(true);
    expect(["💡 x", "📈 x", "① x", "2026 x"].some((l) => BRIEF_SPLIT.test(l))).toBe(false);
  });

  it("시스템 이상", () => {
    expect(systemText("소스 실패", ["heimdallr 2회 <연속>"])).toContain("🔧 <b>소스 실패</b>\nheimdallr 2회 &lt;연속&gt;");
  });
});

describe("성과 피드백 표시 (D49)", () => {
  const card = { rank: 1, name: "A", code: "1", industry: "", flag: "🇰🇷", thesis: null, reasons: ["r"], events: [], risk: null, tech: null, links: "" };
  it("카드에 과거 성과 줄 — 있을 때만", () => {
    expect(ideaBlock({ ...card, perf: "기대 <+1%>" })).toContain("🧾 과거 성과: 기대 &lt;+1%&gt;");
    expect(ideaBlock(card).some((l) => l.includes("과거 성과"))).toBe(false);
  });
  it("분기 성적표 — 큐 성과·제안·링크·매수 확정 아님", () => {
    const t = calibrationText("2027년 1분기", 20,
      [{ label: "🎯 매수 검토", n: 42, median_excess: 1.234, hit_rate: 0.55, ranking_active: true }, { label: "🔭 선행 레이더", n: 8, median_excess: null, hit_rate: null, ranking_active: false }],
      [{ kind: "threshold", title: "상한", rule: "axes.P.buy_max", current: 40, suggested: 30, evidence: "e<1>" }, { kind: "info", title: "정보", evidence: "e2" }], "https://j/scorecard");
    expect(t).toContain("🎯 매수 검토: +1.23% · 이긴 비율 55% (42건 · 추천 순위 반영 중)");
    expect(t).toContain("🔭 선행 레이더: - (8건 · 표본 부족)");
    expect(t).toContain("1. 🔧 상한 — 40 → 30");
    expect(t).toContain("   근거: e&lt;1&gt;");
    expect(t).toContain("2. ℹ️ 정보\n");
    expect(t).toContain('<a href="https://j/scorecard">');
    expect(t).toContain("매수 확정 신호가 아닙니다");
    const empty = calibrationText("p", 20, [], []);
    expect(empty).toContain("아직 측정이 끝난 신호가 없습니다.");
    expect(empty).toContain("바꿀 근거가 충분하지 않습니다");
    expect(empty).not.toContain("<a href");
  });
});

describe("🟢 진입 신호 메시지 (부록 B.1)", () => {
  const v = { market: "KR" as const, name: "리노<공업>", code: "058470", tag: "PB" as const, families: ["heimdallr", "sage", "x"], p: 31.4, lines: ["✅ ① a", "✅ ② b"], invalidation: "238,500원 (10일 최저가)", firstWeightPct: 2, riskOff: false };
  it("조건 줄·무효화·1차 비중·escape·매수 확정 아님", () => {
    const t = greenText(v);
    expect(t).toContain("🟢 <b>진입 신호</b> · 눌림 · 🇰🇷 <b>리노&lt;공업&gt;</b> (058470)");
    expect(t).toContain("합의한 신호: Heimdallr · Sage · x · 주가 반영도 31\n");
    expect(t).toContain("✅ ① a\n✅ ② b");
    expect(t).toContain("무효화: 종가 < 238,500원 (10일 최저가) · 1차 비중 2.0%(허용 비중의 1/3)");
    expect(t).toContain("매수 확정 신호가 아닙니다");
    expect(t).not.toContain("대용 지표");
  });
  it("미국·태그 없음·비중 미상·위험 회피", () => {
    const u = greenText({ ...v, market: "US", tag: null, families: [], p: null, invalidation: null, firstWeightPct: null, riskOff: true });
    expect(u).toContain("🟢 <b>진입 신호</b> · 🇺🇸");
    expect(u).toContain("합의한 신호: - · 주가 반영도 -(간이)");
    expect(u).toContain("무효화: 종가 < - · 1차 비중: SnowBall 허용 비중의 1/3");
    expect(u).toContain("대용 지표");
    expect(greenText({ ...v, riskOff: true })).toContain("위험 회피 국면이라 절반");
  });
  it("브리핑에 🟢🟡🔵 줄", () => {
    const base = { kind: "evening" as const, date: "d", market: [], regime: { risk_off: false, reasons: [] }, counts: { green: 1, yellow: 0, blue: 0, alert: 0 }, earnings: { title: "t", lines: [] }, focus: "KR" as const, ideas: [], buyTotal: 0, others: [], holding: [], schedule: { title: "s", lines: [] }, asOf: "x" };
    expect(briefText({ ...base, entries: ["🟢 <b>A</b> — 눌림"] })).toContain("보유 경고 0\n🟢 <b>A</b> — 눌림");
  });
});
