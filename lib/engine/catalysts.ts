/**
 * M4 — 향후 6개월(180일) 내 상승 이벤트 (PRD §7.3). 5개 소스 합집합을 jarvis.catalyst_events 로 모은다. 순수 함수.
 * 인정: 날짜 또는 기간 끝이 오늘+180일 이내 · 출처 있음 · 상승 방향. 기업 이벤트 또는 그 종목 L1 의 산업 이벤트.
 *
 * P2 실측(9/28): SnowBall 트리거 96건 모두 expected_date 가 없고 expected_window(0-1Q·1-2Q·2-4Q·4Q+)만 있다
 *  → 기간 끝 = 트리거 갱신일 + 창 상한(0-1Q 91일, 1-2Q 182일, 2-4Q 365일, 4Q+ 제외). 2-4Q 는 대부분 180일을 넘어 M4 에서 빠진다.
 */
import { addDays } from "./types";

export type CatalystEvent = {
  scope: "company" | "industry" | "macro"; entity_id: string | null; l1: string | null; title: string;
  date: string | null; window_end: string | null; direction: "up" | "down" | "neutral";
  source: string; url: string | null; origin: "snowball" | "hermes" | "heimdallr" | "earnings" | "yaml"; dedupe_key: string;
};

export const WINDOW_DAYS: Record<string, number | null> = { "0-1Q": 91, "1-2Q": 182, "2-4Q": 365, "4Q+": null };
const day = (iso: string) => iso.slice(0, 10);

export type SbTrigger = { trigger_id: string; asset_id: string; direction: string; status: string; expected_date: string | null; expected_window: string | null; one_line: string; source_url: string | null; updated_at: string; category?: string | null };

export function fromSnowball(ts: SbTrigger[], assetToEntity: (assetId: string) => string | null): CatalystEvent[] {
  const out: CatalystEvent[] = [];
  for (const t of ts) {
    const eid = assetToEntity(t.asset_id);
    if (!eid || t.direction !== "positive" || !["waiting", "imminent"].includes(t.status)) continue;
    const w = t.expected_window ? WINDOW_DAYS[t.expected_window] : null;
    const windowEnd = t.expected_date ? null : w ? day(addDays(t.updated_at, w)) : null;
    if (!t.expected_date && !windowEnd) continue;
    out.push({ scope: "company", entity_id: eid, l1: null, title: t.one_line, date: t.expected_date ? day(t.expected_date) : null, window_end: windowEnd,
      direction: "up", source: `SnowBall 트리거(${t.category ?? "-"}${t.expected_window ? `·${t.expected_window}` : ""})`, url: t.source_url, origin: "snowball", dedupe_key: `sb:${t.trigger_id}` });
  }
  return out;
}

/** HermesCall triggers_timeline: {within_3m:[…], within_6m:[…]} 또는 구형 {"1Q_내":[…], "2Q_내":[…]} → 분석일 + 90/180일 */
export type HermesTimeline = { analysis_id: number; beneficiary_id: number; entity_id: string | null; created_at: string; timeline: Record<string, unknown> | null; direction?: string | null };
const TIMELINE_DAYS: Record<string, number> = { within_3m: 90, within_6m: 180, "1Q_내": 90, "2Q_내": 180 };

export function fromHermes(rows: HermesTimeline[]): CatalystEvent[] {
  const out: CatalystEvent[] = [];
  for (const r of rows) {
    if (!r.entity_id || !r.timeline || r.direction === "하향") continue;
    for (const [k, days] of Object.entries(TIMELINE_DAYS)) {
      const items = r.timeline[k];
      if (!Array.isArray(items)) continue;
      items.forEach((it, i) => {
        const title = typeof it === "string" ? it : typeof it === "object" && it ? String((it as Record<string, unknown>).event ?? (it as Record<string, unknown>).title ?? "") : "";
        const by = typeof it === "object" && it ? (it as Record<string, unknown>).expected_by : undefined;
        if (!title) return;
        out.push({ scope: "company", entity_id: r.entity_id, l1: null, title, date: typeof by === "string" ? day(by) : null, window_end: typeof by === "string" ? null : day(addDays(r.created_at, days)),
          direction: "up", source: `HermesCall 분석 #${r.analysis_id}`, url: null, origin: "hermes", dedupe_key: `hc:${r.beneficiary_id}:${k}:${i}` });
      });
    }
  }
  return out;
}

/** Heimdallr ★○ 분석의 트리거 (payload.triggers.within_3m[].expected_date "2026-11" → 월말) */
export type HdAnalysis = { id: number; code: string; created_at: string; grade: string | null; triggers: Record<string, unknown> | null };
export function monthEnd(ym: string): string | null {
  const m = ym.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (!m) return null;
  if (m[3]) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0));
  return d.toISOString().slice(0, 10);
}

export function fromHeimdallr(rows: HdAnalysis[], grades: string[]): CatalystEvent[] {
  const out: CatalystEvent[] = [];
  for (const a of rows) {
    if (!a.grade || !grades.includes(a.grade) || !a.triggers) continue;
    const items = a.triggers.within_3m;
    if (!Array.isArray(items)) continue;
    items.forEach((it: Record<string, unknown>, i) => {
      if (!it || typeof it.event !== "string") return;
      const d = typeof it.expected_date === "string" ? monthEnd(it.expected_date) : null;
      out.push({ scope: "company", entity_id: `KR:${a.code}`, l1: null, title: it.event.slice(0, 200), date: d, window_end: d ? null : day(addDays(a.created_at, 90)),
        direction: "up", source: `Heimdallr 분석 ${a.grade}`, url: null, origin: "heimdallr", dedupe_key: `hd:${a.id}:${i}` });
    });
  }
  return out;
}

/** 실적 일정 + 30일 컨센서스 상향 (국내 consensus_snapshots op_est 비교, 미국 earnings_events 예정일) */
export type EarningsHint = { entity_id: string; next_date: string | null; estimated: boolean; consensus_change_30d_pct: number | null; source: string };
export function fromEarnings(xs: EarningsHint[], minChangePct: number): CatalystEvent[] {
  return xs.filter((x) => x.next_date && x.consensus_change_30d_pct !== null && x.consensus_change_30d_pct > minChangePct).map((x) => ({
    scope: "company" as const, entity_id: x.entity_id, l1: null,
    title: `다음 실적${x.estimated ? "(예상일)" : ""} · 30일 컨센 ${x.consensus_change_30d_pct! > 0 ? "+" : ""}${Math.round(x.consensus_change_30d_pct! * 10) / 10}%`,
    date: x.next_date, window_end: null, direction: "up" as const, source: x.source, url: null, origin: "earnings" as const, dedupe_key: `er:${x.entity_id}:${x.next_date}`,
  }));
}

/** config/catalyst_calendar.yaml (날짜·기간 끝·출처 없는 항목은 무효) */
export type YamlEvent = { scope: string; l1?: string; entity?: string; title: string; date?: string; window_end?: string; direction: string; source?: string; url?: string };
export function fromYaml(evs: YamlEvent[]): CatalystEvent[] {
  return evs.filter((e) => (e.date || e.window_end) && e.source && ["company", "industry", "macro"].includes(e.scope)).map((e, i) => ({
    scope: e.scope as CatalystEvent["scope"], entity_id: e.entity ?? null, l1: e.l1 ?? null, title: e.title, date: e.date ?? null, window_end: e.window_end ?? null,
    direction: (["up", "down"].includes(e.direction) ? e.direction : "neutral") as CatalystEvent["direction"], source: e.source!, url: e.url || null, origin: "yaml" as const,
    dedupe_key: `yaml:${i}:${e.title}`.slice(0, 200),
  }));
}

/** 종목 M4: 기업 또는 L1 산업 상승 이벤트가 오늘~+horizon 안에 있으면 통과, 가까운 순 2개 */
export function m4ForEntity(entityId: string, l1Codes: string[], events: CatalystEvent[], today: string, horizonDays: number): { pass: boolean; nearest: CatalystEvent[] } {
  const end = day(addDays(`${today}T00:00:00Z`, horizonDays));
  const when = (e: CatalystEvent) => e.date ?? e.window_end ?? "";
  const hits = events.filter((e) => e.direction === "up" && e.source && when(e) >= today && when(e) <= end
    && ((e.scope === "company" && e.entity_id === entityId) || (e.scope === "industry" && e.l1 !== null && l1Codes.includes(e.l1))));
  hits.sort((a, b) => when(a).localeCompare(when(b)));
  return { pass: hits.length > 0, nearest: hits.slice(0, 2) };
}
