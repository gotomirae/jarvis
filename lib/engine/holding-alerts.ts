/**
 * ⚠️ 보유 경고 판정 (PRD §6.4 · §7.5) — 순수 함수. 보유 종목에 대해 다음 원인을 찾는다.
 *  · SnowBall 경보: 규칙·심각도 필터(동적 비중 critical, 드로다운 ≤ −10%), 종목·규칙별 7일 1회
 *  · 주가 위치(D69, 셋 중 하나): 고점 대비 −10% · 5일선이 10일선 하향 돌파 · 5일선이 20일선 하향 돌파 — SnowBall 경보(thesis_breach payload.kind)를 읽는다
 *  · 훼손조건 매칭 트리거(thesis_link=훼손, negative): 새로 생기거나 imminent 로 바뀔 때
 *  · Heimdallr 등급 하락 또는 score_delta ≤ −5 (국내)
 *  · 강세→약세 전환 멘토 ≥ 2 (Sage, 14일)
 * 가이던스 컨센 하회·FlyWheel 불리·무효화선 이탈은 원천 계약(연계 작업 B·C·D, P3)이 생기면 추가한다.
 * 결과의 dedupe_key 는 jarvis.notifications UNIQUE 로 재발송을 막는다.
 */
import type { RiskAlertRow } from "./normalize";

export type HoldingRules = {
  heimdallr_score_delta_max: number;
  mentor_flip_min: number;
  mentor_flip_window_days: number;
  setup_invalidation_window_days?: number;
  snowball_risk: { rule_types: Record<string, string[]>; drawdown_max_pct: number; drawdown_step_pct: number; dedupe_days: number; price_kinds?: Record<string, string> };
  thesis_break_trigger: { thesis_link: string; direction: string; alert_on: string[] };
};

export type Held = { asset_id: string; entity_id: string | null; name: string; ticker: string; weight: number | null; allowed_weight: number | null; heat_score: number | null; invalidation: string[] };
export type TriggerRow = { trigger_id: string; asset_id: string; direction: string; status: string; thesis_link: string | null; one_line: string; source_url?: string | null; category?: string | null };
export type ScreenPair = { code: string; prev_grade: string | null; grade: string | null; score_delta: number | null; fiscal: string };
export type MentorStance = { mentor_id: string; entity_id: string; stance: string; published_at: string };

export type AlertCause = "snowball_risk" | "price_signal" | "thesis_trigger" | "grade_down" | "mentor_flip";
export type HoldingAlert = {
  asset_id: string; entity_id: string | null; name: string; cause: AlertCause; summary: string; source: string;
  fired_at: string; dedupe_key: string; detail: Record<string, unknown>;
};

export const GRADE_RANK: Record<string, number> = { "★": 4, "○": 3, "△": 2, "·": 1, "✕": 0 };

/** 드로다운 값 정규화: −0.23 과 −23 을 모두 % 로 */
export function pct(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.abs(n) <= 1 ? n * 100 : n;
}

export function holdingAlerts(
  inp: {
    held: Held[];
    riskAlerts: (RiskAlertRow & { payload?: Record<string, unknown> })[];
    triggers: TriggerRow[];
    knownTriggerIds: Set<string>;        // 이전 실행에서 본 훼손 트리거 — 처음 보는 것만 "new"
    screens: ScreenPair[];
    stances: MentorStance[];
  },
  r: HoldingRules,
  now: Date,
): HoldingAlert[] {
  const out: HoldingAlert[] = [];
  const byAsset = new Map(inp.held.map((h) => [h.asset_id, h]));
  const byEntity = new Map(inp.held.filter((h) => h.entity_id).map((h) => [h.entity_id as string, h]));
  const bucket = (iso: string) => Math.floor(new Date(iso).getTime() / (r.snowball_risk.dedupe_days * 86400_000));

  for (const a of inp.riskAlerts) {
    const h = a.asset_id ? byAsset.get(a.asset_id) : undefined;
    const sev = r.snowball_risk.rule_types[a.rule_type];
    if (!h || !sev?.includes(a.severity)) continue;
    let summary = a.title;
    let key = `hold:risk:${h.asset_id}:${a.rule_type}:${bucket(a.fired_at)}`;
    if (a.rule_type === "thesis_breach") {
      // 이동평균 하향 돌파(D69)만 — 뉴스 훼손은 트리거 경로(thesis_trigger)가 맡는다. 같은 봉은 한 번만. SnowBall D-76: 한 경보에 kinds 여러 개(10·20일선 동시)
      const kinds = Array.isArray(a.payload?.kinds) ? (a.payload.kinds as unknown[]).map(String) : [String(a.payload?.kind ?? "")];
      const bar = String(a.payload?.bar_date ?? a.fired_at.slice(0, 10));
      for (const kind of kinds) {
        const label = r.snowball_risk.price_kinds?.[kind];
        if (!label) continue;
        out.push({ asset_id: h.asset_id, entity_id: h.entity_id, name: h.name, cause: "price_signal", summary: `📉 ${label}(${bar.slice(5).replace("-", "/")}) — 단기 추세 이탈, 재검토`, source: "SnowBall 시세",
          fired_at: a.fired_at, dedupe_key: `hold:ma:${h.asset_id}:${kind}:${bar}`, detail: { alert_id: a.alert_id, rule_type: a.rule_type, payload: a.payload ?? {} } });
      }
      continue;
    }
    if (a.rule_type === "drawdown") {
      const dd = pct(a.payload?.drawdown);
      if (dd === null || dd > r.snowball_risk.drawdown_max_pct) continue;
      const level = Math.floor(dd / r.snowball_risk.drawdown_step_pct) * r.snowball_risk.drawdown_step_pct;   // −23 → −25 단계
      summary = `고점 대비 ${dd.toFixed(1)}% (≤ ${r.snowball_risk.drawdown_max_pct}%) — 재검토`;
      key = `hold:dd:${h.asset_id}:${level}`;          // 더 깊은 단계로 내려갈 때만 새 경고
    }
    out.push({ asset_id: h.asset_id, entity_id: h.entity_id, name: h.name, cause: "snowball_risk", summary, source: `SnowBall ${a.rule_type}/${a.severity}`,
      fired_at: a.fired_at, dedupe_key: key, detail: { alert_id: a.alert_id, rule_type: a.rule_type, payload: a.payload ?? {} } });
  }

  const tb = r.thesis_break_trigger;
  for (const t of inp.triggers) {
    const h = byAsset.get(t.asset_id);
    if (!h || t.thesis_link !== tb.thesis_link || t.direction !== tb.direction) continue;
    const isNew = !inp.knownTriggerIds.has(t.trigger_id);
    const kind = t.status === "imminent" && tb.alert_on.includes("imminent") ? "imminent" : isNew && tb.alert_on.includes("new") ? "new" : null;
    if (!kind) continue;
    out.push({ asset_id: h.asset_id, entity_id: h.entity_id, name: h.name, cause: "thesis_trigger",
      summary: `훼손조건 연결 트리거${kind === "imminent" ? " 임박" : " 신규"}: ${t.one_line}`, source: "SnowBall 트리거",
      fired_at: now.toISOString(), dedupe_key: `hold:trigger:${t.trigger_id}:${kind}`, detail: { trigger_id: t.trigger_id, category: t.category ?? null, url: t.source_url ?? null } });
  }

  for (const s of inp.screens) {
    const h = byEntity.get(`KR:${s.code}`);
    if (!h) continue;
    const down = s.prev_grade !== null && s.grade !== null && (GRADE_RANK[s.grade] ?? 0) < (GRADE_RANK[s.prev_grade] ?? 0);
    const drop = s.score_delta !== null && s.score_delta <= r.heimdallr_score_delta_max;
    if (!down && !drop) continue;
    const parts = [down && `등급 ${s.prev_grade}→${s.grade}`, drop && `점수 ${s.score_delta}`].filter(Boolean).join(" · ");
    out.push({ asset_id: h.asset_id, entity_id: h.entity_id, name: h.name, cause: "grade_down", summary: `Heimdallr ${parts} (${s.fiscal})`, source: "Heimdallr",
      fired_at: now.toISOString(), dedupe_key: `hold:grade:${s.code}:${s.fiscal}:${s.grade}:${s.score_delta}`, detail: { ...s } });
  }

  // 멘토 전환: 창 안에서 같은 멘토의 가장 이른 언급이 강세이고 가장 늦은 언급이 약세
  const since = now.getTime() - r.mentor_flip_window_days * 86400_000;
  const seq = new Map<string, MentorStance[]>();
  for (const m of inp.stances) {
    if (!byEntity.has(m.entity_id) || new Date(m.published_at).getTime() < since) continue;
    const k = `${m.entity_id}|${m.mentor_id}`;
    (seq.get(k) ?? seq.set(k, []).get(k)!).push(m);
  }
  const flips = new Map<string, string[]>();
  for (const [k, xs] of seq) {
    xs.sort((a, b) => a.published_at.localeCompare(b.published_at));
    if (xs[0].stance === "강세" && xs[xs.length - 1].stance === "약세") {
      const [eid, mid] = k.split("|");
      (flips.get(eid) ?? flips.set(eid, []).get(eid)!).push(mid);
    }
  }
  for (const [eid, mentors] of flips) {
    if (mentors.length < r.mentor_flip_min) continue;
    const h = byEntity.get(eid)!;
    const who = mentors.sort();
    out.push({ asset_id: h.asset_id, entity_id: eid, name: h.name, cause: "mentor_flip", summary: `강세→약세 전환 멘토 ${who.length}명`, source: "Sage",
      fired_at: now.toISOString(), dedupe_key: `hold:flip:${eid}:${who.join(",")}`, detail: { mentors: who } });   // 같은 멘토 조합은 1번만
  }
  return out;
}
