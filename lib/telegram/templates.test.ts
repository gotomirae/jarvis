import { describe, expect, it } from "vitest";
import { BRIEF_SPLIT, briefText, calibrationText, greenText, weeklyText, holdingAlertText, ideaBlock, marketLine, systemText, type BriefData } from "./templates";

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

  it("브리핑 (부록 B.2, D53) — 시장 줄마다 이모지·지금 사기 좋은 TOP·대기 목록·사후 검증 요약", () => {
    const card = {
      rank: 1, name: "저스템", code: "417840", industry: "반도체", flag: "🇰🇷",
      thesis: "습도제어 <과점>", reasons: ["① 실적 가속: 매출 +159%"], history: "🔁 3번째 추천 · 첫 추천 09/27 12,000원 → 13,200원 +10.0% 📈",
      verdict: "🔥 지금 매수 매력 높음 (점수 +6)", timing: ["✅ 주가 반영도 33/100", "✅ 기관 2일 연속 순매수"],
      events: ["~11/30 3Q 실적 (Heimdallr 분석)"], risk: "일회성 가능성 → 확인: 3Q 매출", tech: "RSI 55(중립)", links: '🔗 <a href="u">네이버</a>',
    };
    const d: BriefData = {
      kind: "evening", date: "2026-10-22",
      market: [{ label: "KOSPI", last: 2600, change_pct: 0.8 }, { label: "원/달러", last: 1350.5, change_pct: -0.1, level: true }, { label: "X", last: null, change_pct: null }, { label: "Y", last: 1, change_pct: 0 }],
      sectors: [{ label: "A", change_pct: 1 }, { label: "B", change_pct: -2 }, { label: "C", change_pct: null }, { label: "D", change_pct: 0.5 }],
      regime: { risk_off: true, reasons: ["VIX 30 ≥ 25 & KOSPI < 60일선"] },
      counts: { green: 1, yellow: 3, blue: 2, alert: 0 }, alertsPaused: true,
      earnings: { title: "오늘 국내 실적", lines: ["★ 리노공업 (058470)"] },
      focus: "KR", buyTotal: 8, policy: "사후 검증 42건 · 20거래일 뒤 승률 58% — 제외 적용 중: RSI 과열 탈락",
      ideas: [card, { ...card, rank: 2, name: "B", code: "1", industry: "", history: null, verdict: null, timing: [], thesis: null, reasons: [], events: [], risk: null, tech: null, links: "" }, { ...card, rank: 7 }],
      waiting: [{ name: "<W>", why: "기본 기준: ⏸️ 대기" }, ...Array.from({ length: 6 }, (_, i) => ({ name: `w${i}`, why: "" }))],
      others: [{ icon: "🔭", label: "선행 레이더", names: ["a", "b", "c", "d", "e", "f", "g"] }, { icon: "⏳", label: "눌림 대기", names: [] }],
      holding: ["⚠️ a: b"], schedule: { title: "내일 일정", lines: ["<x>"] }, asOf: "2026-10-22 19:20",
    };
    const t = briefText(d);
    expect(t).toContain("🌙 <b>JARVIS 저녁 브리핑</b>\n📆 2026-10-22 (목)\n\n━━━━━━━━━━━━━━\n🌎 <b>오늘 국내 시장</b>\n━━━━━━━━━━━━━━\n📈 KOSPI +0.8%\n📉 원/달러 1,350.5 (-0.1%)\n➖ X -\n➖ Y 0.0%");
    expect(t).toContain("💪 강한 섹터: A +1.0% · D +0.5%\n🥶 약한 섹터: B -2.0% · D +0.5%");
    expect(t).toContain("🔴 <b>시장 국면: 위험 회피</b>\n   ↳ VIX 30 ≥ 25 &amp; KOSPI &lt; 60일선 (진입 1차 비중 절반)");
    expect(t).toContain("🚦 <b>오늘의 신호</b>\n🟢 진입 1 · 🟡 관찰 3 · 🔵 실적 돌파 2 · ⚠️ 보유 경고 0 (⏸ 알림 정지 중)");
    expect(t).toContain("🎯 <b>매수 검토 추천</b> · 🇰🇷 국내 우선\n✨ 지금 사기 좋은 종목 <b>TOP 3</b> (후보 8개 중)\n📐 사후 검증 42건");
    expect(t).toContain('1️⃣ 🇰🇷 <b>저스템</b> (417840) · 반도체\n🔁 3번째 추천 · 첫 추천 09/27 12,000원 → 13,200원 +10.0% 📈\n<b>🔥 지금 매수 매력 높음 (점수 +6)</b>\n\n💡 <b>투자 아이디어</b>\n습도제어 &lt;과점&gt;\n\n🏢 <b>좋은 기업인가</b>\n① 실적 가속: 매출 +159%\n\n⏱️ <b>지금 사기 좋은가</b>\n✅ 주가 반영도 33/100\n✅ 기관 2일 연속 순매수\n\n⏰ 다음 확인: ~11/30 3Q 실적 (Heimdallr 분석)\n⚠️ 리스크: 일회성 가능성 → 확인: 3Q 매출\n📊 기술적 참고(판정 미사용): RSI 55(중립)\n🔗 <a href="u">네이버</a>');
    expect(t).toContain("2️⃣ 🇰🇷 <b>B</b> (1)\n");
    expect(t).toContain("7. 🇰🇷 <b>저스템</b>");
    expect(t).toContain("⏸️ <b>좋은 기업이지만 지금은 대기</b> (7)\n· &lt;W&gt; — 기본 기준: ⏸️ 대기\n· w0\n");
    expect(t).toContain("· 외 1개 (대시보드)");
    expect(t).toContain("🔭 선행 레이더 7: a · b · c · d · e · f 외");
    expect(t).not.toContain("눌림 대기");
    expect(t).toContain("📣 <b>오늘 국내 실적</b>\n· ★ 리노공업 (058470)");
    expect(t).toContain("📅 <b>내일 일정</b>\n· &lt;x&gt;");
    expect(t).toContain("🕒 <i>기준 2026-10-22 19:20 KST</i>");
    const m = briefText({ ...d, kind: "morning", date: "bad", focus: "US", market: [], sectors: [{ label: "A", change_pct: null }], regime: { risk_off: false, reasons: [] }, alertsPaused: false, earnings: { title: "t", lines: [] }, ideas: [], buyTotal: 0, policy: null, waiting: undefined, others: [], holding: [], schedule: { title: "s", lines: [] } });
    expect(m).toContain("☀️ <b>JARVIS 아침 브리핑</b>\n📆 bad\n");
    expect(m).toContain("🌎 <b>밤사이 미국 시장</b>");
    expect(m).toContain("시세 수집 실패");
    expect(m).toContain("🟢 <b>시장 국면: 정상</b>");
    expect(m).toContain("🎯 <b>매수 검토 추천</b> · 🇺🇸 미국 우선\n✨ 오늘은 지금 사기 좋은 종목이 없습니다\n━");
    expect(m).not.toContain("섹터");
    expect(m).not.toContain("그 밖의");
    expect(m).not.toContain("대기");
    expect(briefText({ ...d, ideas: [], buyTotal: 4 })).toContain("✨ 오늘은 지금 사기 좋은 종목이 없습니다 (후보 4개 모두 타이밍 대기)");
    expect(briefText({ ...d, sectors: undefined, buyTotal: 3 })).toContain("(후보 3개 중)");
    expect(marketLine({ label: "S&P 500", last: 5000, change_pct: Infinity })).toBe("S&amp;P 500 -");
    expect(["1️⃣ 🇰🇷 x", "7. x", "━━", "👀 x", "📣 x", "💼 x", "📅 x", "🚦 x", "⏸️ <b>x"].every((l) => BRIEF_SPLIT.test(l))).toBe(true);
    expect(["💡 x", "📈 x", "① x", "2026 x", "⏸️ x"].some((l) => BRIEF_SPLIT.test(l))).toBe(false);
  });

  it("시스템 이상", () => {
    expect(systemText("소스 실패", ["heimdallr 2회 <연속>"])).toContain("🔧 <b>소스 실패</b>\nheimdallr 2회 &lt;연속&gt;");
  });
});

describe("성과 피드백 표시 (D49)", () => {
  const card = { rank: 1, name: "A", code: "1", industry: "", flag: "🇰🇷", thesis: null, reasons: ["r"], events: [], risk: null, tech: null, links: "" };
  it("카드에 과거 성과 줄 — 있을 때만(링크 바로 위)", () => {
    expect(ideaBlock({ ...card, perf: "기대 <+1%>" })).toContain("🧾 과거 성과: 기대 &lt;+1%&gt;");
    expect(ideaBlock(card).some((l) => l.includes("과거 성과"))).toBe(false);
  });
  it("분기 성적표 — 큐 성과·제안·링크·매수 확정 아님", () => {
    const t = calibrationText("2027년 1분기", 20,
      [{ label: "🎯 매수 검토", n: 42, median_excess: 1.234, hit_rate: 0.55, ranking_active: true }, { label: "🔭 선행 레이더", n: 8, median_excess: null, hit_rate: null, ranking_active: false }],
      [{ kind: "threshold", title: "상한", rule: "axes.P.buy_max", current: 40, suggested: 30, evidence: "e<1>" }, { kind: "info", title: "정보", evidence: "e2" }], "https://j/scorecard");
    expect(t).toContain("🎯 매수 검토: +1.23% · 승률 55% (42건 · 추천 순위 반영 중)");
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

describe("🏛️ 주간 투자위원회 요약 (P4)", () => {
  const v = { week: "2026-W40", range: "09-28 ~ 10-02", stance: "정상 · 현금 10~20%", market: ["KOSPI -1.1%", "S&P <500> -0.3%"], krTop: ["반도체 +9.8%"], krBottom: ["여행 -1.8%"], buy: ["🟢 HJ중공업"],
    scenarios: [{ name: "Bull", probability: 30 }], decisions: ["결정1"], grounded: true, note: null, flywheel: "FlyWheel 주간 리포트 도착", url: "https://j/weekly", notionUrl: "https://n" };
  it("서술 통과", () => {
    const t = weeklyText(v);
    expect(t).toContain("🏛️ <b>JARVIS 주간 투자위원회 2026-W40</b>");
    expect(t).toContain("S&amp;P &lt;500&gt; -0.3%");
    expect(t).toContain("🏭 국내 산업 ▲ 반도체 +9.8% / ▼ 여행 -1.8%");
    expect(t).toContain("🔮 시나리오: Bull 30%");
    expect(t).toContain("1. 결정1");
    expect(t).toContain('<a href="https://j/weekly">대시보드 전문</a> · <a href="https://n">노션</a>');
    expect(t).toContain("매수 확정 신호가 아닙니다");
  });
  it("표만·빈 목록·링크 없음", () => {
    const t = weeklyText({ ...v, krTop: [], buy: [], scenarios: [], decisions: [], grounded: false, note: null, url: null, notionUrl: null });
    expect(t).toContain("🎯 매수 검토: 없음");
    expect(t).toContain("⚠️ 서술 없이 표·목록만 발행");
    expect(t).not.toContain("🏭");
    expect(t).not.toContain("🔗");
    expect(weeklyText({ ...v, krBottom: [], grounded: false, note: "검증 실패" })).toContain("▲ 반도체 +9.8%\n");
  });
});
