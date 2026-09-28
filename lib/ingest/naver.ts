/**
 * 네이버 해외 종목 코드 해석 어댑터 (PRD §9.4, T18). links.yaml naver.us_resolve_api 를 us_suffixes 순(.O → .K → 없음)으로 확인한다.
 * 200 이고 StockConflict 가 없으면 채택하고, 응답의 reutersCode 를 우선 쓴다. 모두 실패하면 null → lib/links.ts 가 네이버 검색으로 폴백.
 * 예외를 올리지 않는다(불변 규칙 6).
 */
import { naverUsAccept } from "@/lib/links";

export type NaverRuleCfg = { us_resolve_api: string; us_suffixes: string[] };

export async function resolveNaverUs(symbol: string, cfg: NaverRuleCfg, f: typeof fetch = fetch): Promise<string | null> {
  for (const suffix of cfg.us_suffixes) {
    const url = cfg.us_resolve_api.replace("{symbol}", encodeURIComponent(symbol)).replace("{suffix}", suffix);
    try {
      const res = await f(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; JARVIS-research)" }, signal: AbortSignal.timeout(10_000) });
      const body = await res.text();
      if (!naverUsAccept(res.status, body)) continue;
      let code = `${symbol}${suffix}`;
      try { const j = JSON.parse(body) as { reutersCode?: unknown }; if (typeof j.reutersCode === "string" && j.reutersCode) code = j.reutersCode; } catch { /* 본문이 JSON 이 아니면 조합값 */ }
      return code;
    } catch {
      /* 다음 접미사 */
    }
  }
  return null;
}
