/**
 * 텔레그램 HTML 모드 포맷 (PRD §9.1, 불변 규칙 8). 동적 텍스트는 반드시 esc() 를 거친다.
 */
export const NOT_A_BUY_SIGNAL = "⚠️ 매수 확정 신호가 아닙니다. 최종 판단·입력은 SnowBall에서.";

export function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 4,096자 제한 → 줄 경계에서 분할 (한 줄이 너무 길면 강제 분할) */
export function splitMessage(text: string, max = 4096, prefer?: RegExp): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let cur: string[] = [];
  for (const line of text.split("\n")) {
    let pending: string | null = line;
    while (pending !== null) {
      if ([...cur, pending].join("\n").length <= max) { cur.push(pending); pending = null; continue; }
      if (!cur.length) { parts.push(pending.slice(0, max)); pending = pending.slice(max) || null; continue; }
      // 넘침: prefer 에 맞는 줄(예: 종목 카드 시작) 바로 앞에서 자른다 — 카드가 두 메시지로 쪼개지지 않게
      let cut = cur.length;
      if (prefer) for (let i = cur.length - 1; i > 0; i--) if (prefer.test(cur[i])) { cut = i; break; }
      const head = cur.slice(0, cut).join("\n");
      parts.push(prefer ? head.trimEnd() : head);
      cur = cur.slice(cut);
    }
  }
  if (cur.length) parts.push(cur.join("\n"));
  return parts;
}

/** secret_token 비교 (길이·내용 모두 상수 시간에 가깝게) */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
