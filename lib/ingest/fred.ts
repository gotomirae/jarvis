/**
 * FRED (미 연준 세인트루이스) 공개 시계열 — fredgraph.csv 무키·무료. 📡 섹터 핵심 지표(실질금리·산업생산·한국 국채금리 등, D69) 표시 전용.
 * 예외 없이 Result 반환(불변 규칙 6). 결측('.')은 건너뛴다.
 */
import type { Bar } from "./market";
import { fail, ok, safeReason, type Result } from "./types";

/** 순수 함수: "observation_date,ID\n2026-10-07,0.51\n2026-10-08,." → 일봉 형태(날짜 오름차순, 결측 제외) */
export function parseFredCsv(csv: string): Bar[] {
  const out: Bar[] = [];
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const [date, v] = line.split(",");
    const x = Number(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") && v !== "." && v !== "" && Number.isFinite(x)) out.push({ date, close: x });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export async function fredSeries(id: string, from: string, f: typeof fetch = fetch): Promise<Result<Bar[]>> {
  try {
    const res = await f(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}&cosd=${from}`, { headers: { "User-Agent": "Mozilla/5.0 (compatible; JARVIS-research)" }, signal: AbortSignal.timeout(20_000) });
    if (res.status !== 200) return fail(`fred ${id}: HTTP ${res.status}`, res.status);
    const bars = parseFredCsv(await res.text());
    return bars.length ? ok(bars, 200) : fail(`fred ${id}: 데이터 없음`);
  } catch (e) {
    return fail(`fred ${id}: ${safeReason(e)}`);
  }
}
