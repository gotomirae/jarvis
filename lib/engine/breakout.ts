/**
 * 🔵 실적 돌파 관찰 (PRD §7.4) — 순수 함수. **진입 신호가 아니다.** D0 이후 60거래일 무장, 그 안에 M1~M5 통과 시 PEAD_PB 🟢.
 *  · K1 국내 = Heimdallr notifications(kind='earnings_breakout', payload.d0·d0_low)
 *  · H1 미국 = HermesCall technical_ideas(setup='H1', signal.d0·d0_low)
 */
import { tradingDaysAhead } from "./gate";

export type Breakout = { entity_id: string; source: "K1" | "H1"; d0: string; d0_low: number | null; armed_until: string; evidence: Record<string, unknown> };

/** "20261001" · "2026-10-01" · ISO 시각 → YYYY-MM-DD, 형식 밖이면 null */
export function ymd(v: unknown): string | null {
  const s = String(v ?? "");
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}`;
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

const low = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function fromK1(rows: { code: string; payload: Record<string, unknown> | null }[], armDays: number): Breakout[] {
  const out: Breakout[] = [];
  for (const r of rows) {
    const p = r.payload ?? {};
    const d0 = ymd(p.d0);
    if (!d0 || p.pass === false) continue;
    out.push({ entity_id: `KR:${r.code}`, source: "K1", d0, d0_low: low(p.d0_low), armed_until: tradingDaysAhead(d0, armDays), evidence: { grade: p.grade ?? null, gap_pct: p.gap_pct ?? null, volume_mult: p.volume_mult ?? null } });
  }
  return out;
}

export function fromH1(rows: { symbol: string; signal: Record<string, unknown> | null; role?: string | null }[], armDays: number): Breakout[] {
  const out: Breakout[] = [];
  for (const r of rows) {
    const s = r.signal ?? {};
    const d0 = ymd(s.d0);
    if (!d0) continue;
    out.push({ entity_id: `US:${r.symbol.toUpperCase()}`, source: "H1", d0, d0_low: low(s.d0_low), armed_until: tradingDaysAhead(d0, armDays), evidence: { role: r.role ?? null, source_symbol: s.source_symbol ?? null, quarter: s.quarter ?? null } });
  }
  return out;
}

/** 오늘 무장 중인 돌파(가장 최근 D0) */
export function armedOn(bs: Breakout[], entityId: string, today: string): Breakout | null {
  return bs.filter((b) => b.entity_id === entityId && b.d0 <= today && today <= b.armed_until).sort((a, b) => b.d0.localeCompare(a.d0))[0] ?? null;
}
