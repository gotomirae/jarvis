/** KST 표시 헬퍼 (불변 규칙 12: 저장은 timestamptz, 표시는 KST) */
export function kstString(d: Date = new Date()): string {
  const k = new Date(d.getTime() + 9 * 3600_000);
  return k.toISOString().slice(0, 16).replace("T", " ");
}

/** KST 기준 날짜 (YYYY-MM-DD) */
export function kstDate(d: Date = new Date()): string {
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

/**
 * 브리핑이 속한 날짜 — 저녁 브리핑은 정오 전(자정 넘어 수동 실행 등)이면 전날 저녁분이다.
 * 10/1 01:30 수동 실행이 10/1 저녁 슬롯을 차지해 19:20 정시 발송이 빠진 사례(D48).
 */
export function briefDate(kind: "morning" | "evening", d: Date = new Date()): string {
  return kind === "evening" ? kstDate(new Date(d.getTime() - 12 * 3600_000)) : kstDate(d);
}

/**
 * 브리핑 슬롯(YYYY-MM-DD)이 지금 실행이 속한 브리핑 날짜와 같은지. 다르면 몇 시간 늦게 시작된 예비 실행이다
 * (10/2 02:08 — 19:45 예비가 6시간 지연돼 "10-02" 슬롯으로 돌며 그날 저녁 정시 발송을 막음, D48). 날짜 모양이 아니면 검사 안 함.
 */
export function briefSlotOk(kind: "morning" | "evening", slot: string, d: Date = new Date()): boolean {
  return !/^\d{4}-\d{2}-\d{2}$/.test(slot) || slot === briefDate(kind, d);
}

/**
 * 정시 슬롯 이름(YYYY-MM-DD-am|pm)이 실행 시각과 맞는지 — 오전 슬롯은 KST 05~12시, 오후 슬롯은 12~24시·같은 날짜.
 * 다른 슬롯 이름(daily·weekly·manual-…)은 검사하지 않는다. 엉뚱한 시각의 수동 실행이 정시 슬롯을 먼저 차지하면
 * 정시 잡이 "이미 성공"으로 건너뛰어진다(D48).
 */
export function slotTimeOk(slot: string, d: Date = new Date()): boolean {
  const m = /^(\d{4}-\d{2}-\d{2})-(am|pm)$/.exec(slot);
  if (!m) return true;
  const hour = Number(kstString(d).slice(11, 13));
  return m[1] === kstDate(d) && (m[2] === "am" ? hour >= 5 && hour < 12 : hour >= 12);
}

/** 분기 첫 토요일(KST) — 신호원 성적표·보정 제안 (PRD §14 분기 첫 토 10:30) */
export function isFirstSaturdayOfQuarter(d: Date = new Date()): boolean {
  const k = new Date(d.getTime() + 9 * 3600_000);
  return [0, 3, 6, 9].includes(k.getUTCMonth()) && k.getUTCDate() <= 7 && k.getUTCDay() === 6;
}

/**
 * 주간 메모가 다루는 주(월~금, KST) — 토·일에 돌면 이번 주, 평일에 돌면 지난주. 라벨은 ISO 주차("2026-W40").
 */
export function memoWeek(d: Date = new Date()): { week: string; start: string; end: string } {
  const k = new Date(`${kstDate(d)}T00:00:00Z`);
  const dow = k.getUTCDay();                                   // 0=일 … 6=토
  const back = dow === 6 ? 1 : dow === 0 ? 2 : dow + 2;        // 가장 가까운 지난 금요일까지
  const end = new Date(k.getTime() - back * 86400_000);
  const start = new Date(end.getTime() - 4 * 86400_000);
  const thu = new Date(end.getTime() - 86400_000);             // ISO 주차 = 목요일이 속한 해
  const jan1 = Date.UTC(thu.getUTCFullYear(), 0, 1);
  const wk = Math.floor((thu.getTime() - jan1) / 86400_000 / 7) + 1;
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return { week: `${thu.getUTCFullYear()}-W${String(wk).padStart(2, "0")}`, start: iso(start), end: iso(end) };
}
