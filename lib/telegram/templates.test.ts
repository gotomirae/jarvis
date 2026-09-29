import { describe, expect, it } from "vitest";
import { briefText, holdingAlertText, marketLine, systemText, type BriefData } from "./templates";

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

  it("브리핑 (부록 B.2)", () => {
    const d: BriefData = {
      kind: "evening", date: "2026-10-22",
      market: [{ label: "KOSPI", last: 2600, change_pct: 0.8 }, { label: "원/달러", last: 1350.5, change_pct: -0.1, level: true }, { label: "X", last: null, change_pct: null }],
      sectors: [{ label: "A", change_pct: 1 }, { label: "B", change_pct: -2 }, { label: "C", change_pct: null }, { label: "D", change_pct: 0.5 }],
      regime: { risk_off: true, reasons: ["VIX 30 ≥ 25 & KOSPI < 60일선"] },
      counts: { green: 1, yellow: 3, blue: 2, alert: 0 },
      earnings: { title: "오늘 국내 실적", lines: ["★ 리노공업 (058470)"] },
      items: [
        { icon: "🎯", group: "매수 검토", name: "리노공업", code: "058470", conclusion: "매수 검토 후보 — <좋음>", reasons: ["실적 숫자: Heimdallr ★"], links: '🔗 <a href="u">네이버</a>' },
        { icon: "🎯", group: "매수 검토", name: "B", code: "1", conclusion: "c", reasons: [], links: "" },
        { icon: "🔭", group: "선행 레이더", name: "C", code: "2", conclusion: "d", reasons: [], links: "" },
      ],
      holding: ["⚠️ a: b"], schedule: { title: "내일 일정", lines: ["<x>"] }, asOf: "2026-10-22 19:20",
    };
    const t = briefText(d);
    expect(t).toContain("🌙 <b>2026-10-22 저녁 브리핑</b>");
    expect(t).toContain("KOSPI +0.8% · 원/달러 1,350.5 (-0.1%) · X -");
    expect(t).toContain("섹터 ▲ A +1.0%, D +0.5% / ▼ B -2.0%, D +0.5%");
    expect(t).toContain("🔴 시장 국면: 위험 회피 — VIX 30 ≥ 25 &amp; KOSPI &lt; 60일선 (진입 1차 비중 절반)");
    expect(t).toContain('<b>🎯 매수 검토</b>\n\n<b>리노공업</b> (058470)\n결론: 매수 검토 후보 — &lt;좋음&gt;\n · 실적 숫자: Heimdallr ★\n🔗 <a href="u">네이버</a>\n\n<b>B</b> (1)\n결론: c\n\n<b>🔭 선행 레이더</b>');
    expect(t).toContain("&lt;x&gt;");
    const m = briefText({ ...d, kind: "morning", market: [], sectors: [{ label: "A", change_pct: null }], regime: { risk_off: false, reasons: [] }, earnings: { title: "t", lines: [] }, items: [], holding: [], schedule: { title: "s", lines: [] } });
    expect(m).toContain("☀️");
    expect(m).toContain("시세 수집 실패");
    expect(m).toContain("🟢 시장 국면: 정상");
    expect(m).not.toContain("섹터");
    expect(briefText({ ...d, sectors: undefined })).not.toContain("섹터");
    expect(marketLine({ label: "S&P 500", last: 5000, change_pct: Infinity })).toBe("S&amp;P 500 -");
  });

  it("시스템 이상", () => {
    expect(systemText("소스 실패", ["heimdallr 2회 <연속>"])).toContain("🔧 <b>소스 실패</b>\nheimdallr 2회 &lt;연속&gt;");
  });
});
