/**
 * 성과 측정 (PRD §12, D47) — 순수 함수. 진입가 = 신호 다음 첫 거래일 종가, D+N = 진입일부터 N 거래일 뒤 종가.
 * 거래일 캘린더는 종목 자체의 일봉 날짜를 쓴다(휴장일이 자동으로 빠진다, 불변 규칙 12).
 * 수익률은 매번 같은 시세 계열에서 진입가·평가가를 함께 읽는다 — 액면분할로 과거 종가가 조정돼도 왜곡되지 않는다.
 */
export type Bar = { date: string; close: number };
export type Market = "KR" | "US";

export type OutcomeRow = {
  horizon_days: number;
  horizon_date: string;
  price: number;
  ret_pct: number;
  bench_ret_pct: number | null;
  excess_pct: number | null;
};

export type Measured = { entry: { date: string; close: number } | null; outcomes: OutcomeRow[] };

const TZ: Record<Market, string> = { KR: "Asia/Seoul", US: "America/New_York" };
/** 정규장 마감 + 여유(분). 이 시각 전의 당일 봉은 장중 값이라 쓰지 않는다 */
const CLOSE_MIN: Record<Market, number> = { KR: 15 * 60 + 40, US: 16 * 60 + 15 };

const r3 = (x: number) => Math.round(x * 1000) / 1000;

function localParts(at: Date, market: Market): { date: string; minutes: number } {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ[market], year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(at)
    .reduce<Record<string, string>>((m, x) => ((m[x.type] = x.value), m), {});
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** 신호 시각의 거래소 현지 날짜 (예: KST 07:12 의 미국 날짜 = 전날) */
export function marketDate(at: Date, market: Market): string {
  return localParts(at, market).date;
}

/** 확정된 마지막 종가 날짜 상한 — 장 마감 전이면 전날까지만 인정 */
export function lastCompleteDate(now: Date, market: Market): string {
  const { date, minutes } = localParts(now, market);
  if (minutes >= CLOSE_MIN[market]) return date;
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** 날짜 이하 마지막 봉 (벤치마크 휴장일 대응) */
export function closeOnOrBefore(bars: Bar[], date: string): Bar | null {
  let out: Bar | null = null;
  for (const b of bars) {
    if (b.date > date) break;
    out = b;
  }
  return out;
}

/**
 * 신호일(현지) 다음 첫 거래일을 진입일로 잡고 각 기간의 수익률·벤치마크 대비 초과수익을 계산한다.
 * bars 는 날짜 오름차순, upTo(확정 종가 상한) 이후 봉은 버린다. 아직 오지 않은 기간은 결과에 없다.
 */
export function measure(bars: Bar[], bench: Bar[] | null, signalDate: string, horizons: number[], upTo: string): Measured {
  const s = bars.filter((b) => b.date <= upTo && b.close > 0);
  const idx = s.findIndex((b) => b.date > signalDate);
  if (idx < 0) return { entry: null, outcomes: [] };
  const entry = s[idx];
  const bs = (bench ?? []).filter((b) => b.date <= upTo && b.close > 0);
  const b0 = closeOnOrBefore(bs, entry.date);
  const outcomes: OutcomeRow[] = [];
  for (const h of horizons) {
    const at = s[idx + h];
    if (!at) continue;
    const ret = (at.close / entry.close - 1) * 100;
    const b1 = closeOnOrBefore(bs, at.date);
    const bret = b0 && b1 ? (b1.close / b0.close - 1) * 100 : null;
    outcomes.push({
      horizon_days: h, horizon_date: at.date, price: at.close, ret_pct: r3(ret),
      bench_ret_pct: bret === null ? null : r3(bret), excess_pct: bret === null ? null : r3(ret - bret),
    });
  }
  return { entry: { date: entry.date, close: entry.close }, outcomes };
}
