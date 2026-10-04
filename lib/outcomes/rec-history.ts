/**
 * 🎯 추천 이력 — 텔레그램 브리핑에서 몇 번째 추천인지, 첫 추천 뒤 주가가 얼마나 움직였는지 (사용자 지정 2026-10-04, D55). 순수 함수.
 *  · 원천 = notifications(brief_morning·brief_evening, 발송 성공분) payload.picks(종목·기준가). 옛 브리핑은 ideas(종목 코드)만 있다.
 *  · 기준가 = 추천 시점에 확정된 마지막 종가(국내 네이버 공식 종가 · 미국 야후 — 성과 원장과 같은 출처).
 */
export type BriefPick = { id: string; rank?: number | null; price?: number | null; price_date?: string | null };
export type BriefNote = { sent_at: string | null; payload: { ideas?: string[]; picks?: BriefPick[] } | null };
export type RecHist = { count: number; first_at: string; first_price: number | null; first_price_date: string | null; last_at: string; last_price: number | null; last_price_date: string | null };

/** 브리핑별 추천 종목 (picks 우선, 없으면 옛 ideas 코드 → idOf) */
export function picksOf(n: BriefNote, idOf: (code: string) => string | null): BriefPick[] {
  if (n.payload?.picks) return n.payload.picks;
  return (n.payload?.ideas ?? []).map((c) => idOf(c)).filter((id): id is string => !!id).map((id) => ({ id }));
}

export function recHistory(notes: BriefNote[], idOf: (code: string) => string | null): Map<string, RecHist> {
  const out = new Map<string, RecHist>();
  for (const n of [...notes].filter((x) => x.sent_at).sort((a, b) => String(a.sent_at).localeCompare(String(b.sent_at)))) {
    for (const p of picksOf(n, idOf)) {
      const at = n.sent_at as string;
      const price = p.price ?? null, date = p.price_date ?? null;
      const h = out.get(p.id);
      if (!h) out.set(p.id, { count: 1, first_at: at, first_price: price, first_price_date: date, last_at: at, last_price: price, last_price_date: date });
      else Object.assign(h, { count: h.count + 1, last_at: at, ...(price !== null ? { last_price: price, last_price_date: date } : {}) });
    }
  }
  return out;
}

const kstMd = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(5, 10).replace("-", "/");
export const priceStr = (v: number, cur: "KRW" | "USD") => (cur === "KRW" ? `${Math.round(v).toLocaleString("en-US")}원` : `$${v.toFixed(2)}`);
const signed = (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(1)}%`;

/** 수익률(%) — 둘 중 하나라도 없으면 null */
export const retPct = (from: number | null | undefined, to: number | null | undefined): number | null => (from && to ? (to / from - 1) * 100 : null);

/**
 * 한 줄 요약.
 *  · 브리핑(nth = 과거 횟수 + 1, cur = 지금 기준가): "🆕 첫 추천 · 기준가 …" 또는 "🔁 3번째 추천 · 첫 추천 09/28 12,300원 → 13,330원 (+8.4%)"
 *  · 대시보드(cur = 최근 추천 기준가): 같은 형식
 */
export function recLine(x: { nth: number; first_at: string | null; first_price: number | null; cur_price: number | null; cur_date: string | null; currency: "KRW" | "USD" }): string {
  const cur = x.cur_price === null ? null : `${priceStr(x.cur_price, x.currency)}${x.cur_date ? ` (${x.cur_date.slice(5).replace("-", "/")} 종가)` : ""}`;
  if (x.nth <= 1 || !x.first_at) return `🆕 첫 추천${cur ? ` · 기준가 ${cur}` : ""}`;
  const r = retPct(x.first_price, x.cur_price);
  const from = `첫 추천 ${kstMd(x.first_at)}`;
  if (r === null) return `🔁 ${x.nth}번째 추천 · ${from}${cur ? ` · 현재 ${cur}` : ""}`;
  return `🔁 ${x.nth}번째 추천 · ${from} ${priceStr(x.first_price as number, x.currency)} → ${cur} ${signed(r)} ${r > 0 ? "📈" : r < 0 ? "📉" : "➖"}`;
}
