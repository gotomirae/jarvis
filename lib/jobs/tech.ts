/**
 * 기술적 참고 지표 (판정 미사용 — 표시 전용). 🟢 의 MACD(M2)·수급(M5) 판정은 P3 에서 Heimdallr entry_checks / HermesCall entry_checks_us 로 한다(D13).
 * 우선순위: HermesCall technical_ideas 라벨(사람이 읽는 문장) → Heimdallr 기술 셋업 알림 → Heimdallr 시세 스냅샷 RSI.
 * 국내 종목만 원천이 있다(미국 종목 일봉 지표는 HermesCall 연계 작업 C 이후).
 */
import type { TechRef } from "@/lib/engine/explain";
import { read as heimdallr } from "@/lib/ingest/heimdallr";
import { read as hermes } from "@/lib/ingest/hermescall";

type HdTech = { rsi?: number; rsi_rising?: boolean; histogram?: number; histogram_pct?: number; macd_crossed?: boolean; price_regime?: string; as_of?: string };
type HcTech = { rsi?: number; rsi_label?: string; macd_label?: string; ma_label?: string };

const ymd = (s: string | undefined | null) => (s && /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : s ?? null);

export async function techRefs(entityIds: string[], now = new Date()): Promise<Map<string, TechRef>> {
  const codes = [...new Set(entityIds.filter((id) => id.startsWith("KR:")).map((id) => id.slice(3)))];
  const out = new Map<string, TechRef>();
  if (!codes.length) return out;
  const since = new Date(now.getTime() - 14 * 86400_000).toISOString();
  const [hc, hd, ps] = await Promise.all([
    hermes<{ symbol: string; signal: { technical?: HcTech; price?: { last_date?: string } } | null; sent_at: string }>("technical_ideas", { select: "symbol,signal,sent_at", filters: { market: "eq.KR", sent_at: `gte.${since}` }, order: "sent_at.desc" }),
    heimdallr<{ code: string; payload: { technical?: HdTech } | null; sent_at: string }>("notifications", { select: "code,payload,sent_at", filters: { kind: "eq.technical_setup", sent_at: `gte.${since}`, code: `in.(${codes.join(",")})` }, order: "sent_at.desc" }),
    heimdallr<{ code: string; snap_date: string; rsi_14: number | null }>("price_snapshots", { select: "code,snap_date,rsi_14", filters: { code: `in.(${codes.join(",")})`, snap_date: `gte.${since.slice(0, 10)}` }, order: "snap_date.desc" }),
  ]);
  for (const r of ps.ok ? ps.data : []) {
    const id = `KR:${r.code}`;
    if (!out.has(id) && r.rsi_14 !== null) out.set(id, { source: "Heimdallr 시세", as_of: r.snap_date, rsi: r.rsi_14, rsi_note: null, macd_note: null, price_note: null });
  }
  for (const n of hd.ok ? [...hd.data].reverse() : []) {
    const t = n.payload?.technical;
    if (!t) continue;
    out.set(`KR:${n.code}`, {
      source: "Heimdallr 기술 셋업", as_of: ymd(t.as_of) ?? n.sent_at.slice(0, 10), rsi: t.rsi ?? null, rsi_note: t.rsi_rising === undefined ? null : t.rsi_rising ? "상승" : "상승 아님",
      macd_note: t.macd_crossed ? "상향 교차" : t.histogram !== undefined ? `${t.histogram < 0 ? "시그널 아래" : "시그널 위"}${t.histogram_pct !== undefined ? `(격차 ${Math.abs(t.histogram_pct).toFixed(2)}%)` : ""}` : null,
      price_note: t.price_regime ?? null,
    });
  }
  for (const t of hc.ok ? [...hc.data].reverse() : []) {
    const code = t.symbol.replace(/\.(KS|KQ)$/i, "");
    const x = t.signal?.technical;
    if (!x || !codes.includes(code)) continue;
    out.set(`KR:${code}`, { source: "HermesCall 기술 아이디어", as_of: t.signal?.price?.last_date ?? t.sent_at.slice(0, 10), rsi: x.rsi ?? null, rsi_note: x.rsi_label ?? null, macd_note: x.macd_label ?? null, price_note: x.ma_label ?? null });
  }
  return out;
}
