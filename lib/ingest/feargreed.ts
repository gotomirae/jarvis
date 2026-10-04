/**
 * CNN 공포·탐욕 지수 어댑터 (무료·무키, 대시보드 표시 전용 — D56). 예외 없이 Result(불변 규칙 6).
 * 브라우저 헤더가 없으면 418 로 막힌다(10/5 실측).
 */
import { fail, ok, safeReason, type Result } from "./types";

export type FgPoint = { date: string; value: number; rating: string };

const RATING: Record<string, string> = { "extreme fear": "극단적 공포", fear: "공포", neutral: "중립", greed: "탐욕", "extreme greed": "극단적 탐욕" };
export const ratingKo = (r: string) => RATING[r.toLowerCase()] ?? r;

/** 순수 함수: {fear_and_greed_historical: {data: [{x: ms, y, rating}]}} → 날짜별 값(같은 날은 마지막 값) */
export function parseFearGreed(json: unknown): FgPoint[] {
  const data = (json as { fear_and_greed_historical?: { data?: { x?: number; y?: number; rating?: string }[] } } | null)?.fear_and_greed_historical?.data;
  if (!Array.isArray(data)) return [];
  const m = new Map<string, FgPoint>();
  for (const d of data) {
    if (typeof d?.x !== "number" || typeof d.y !== "number") continue;
    const date = new Date(d.x).toISOString().slice(0, 10);
    m.set(date, { date, value: Math.round(d.y * 10) / 10, rating: ratingKo(d.rating ?? "") });
  }
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export async function fearGreed(from: string, f: typeof fetch = fetch): Promise<Result<FgPoint[]>> {
  try {
    const res = await f(`https://production.dataviz.cnn.io/index/fearandgreed/graphdata/${from}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", Accept: "application/json", Referer: "https://edition.cnn.com/", Origin: "https://edition.cnn.com" },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status !== 200) return fail(`공포·탐욕: HTTP ${res.status}`, res.status);
    const xs = parseFearGreed(await res.json());
    return xs.length ? ok(xs, 200) : fail("공포·탐욕: 데이터 없음");
  } catch (e) {
    return fail(`공포·탐욕: ${safeReason(e)}`);
  }
}
