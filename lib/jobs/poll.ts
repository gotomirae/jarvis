/**
 * poll (PRD §14 30분마다): 보유 경고(⚠️) — SC4 소스 알림 → 발송 ≤ 35분. pg_cron 이 Vercel 라우트를 직접 부른다(Actions 분 절약).
 * 첫 실행은 부트스트랩: 지금까지의 경고는 "본 것"으로만 기록하고 보내지 않는다(과거 250건 폭탄 방지).
 * 긴급(보유 경고)은 /mute·하루 상한과 무관하게 보낸다(PRD §9.2).
 */
import { linksConfig, taxonomyConfig } from "@/lib/config/load";
import { dbInsert, dbSelect } from "@/lib/db";
import { holdingAlerts, type Held, type HoldingAlert, type MentorStance, type ScreenPair, type TriggerRow } from "@/lib/engine/holding-alerts";
import { env } from "@/lib/env";
import { read as heimdallr } from "@/lib/ingest/heimdallr";
import { read as sage } from "@/lib/ingest/sage";
import { exportRiskAlerts, exportTriggers } from "@/lib/ingest/snowball";
import { recordSource } from "@/lib/jobs";
import { stockKeyboard, type LinkEntity } from "@/lib/links";
import { sendMessage } from "@/lib/telegram/send";
import { holdingAlertText } from "@/lib/telegram/templates";
import { latestHoldings, rules, type EntityRow } from "./context";

export async function getState<T>(key: string): Promise<T | null> {
  const r = await dbSelect<{ value: T }>("bot_state", `select=value&key=eq.${encodeURIComponent(key)}`);
  return r.ok && r.data[0] ? r.data[0].value : null;
}
export async function setState(key: string, value: unknown) {
  await dbInsert("bot_state", [{ key, value, updated_at: new Date().toISOString() }], { upsertOn: "key" });
}

/** 보유 종목 엔티티만 읽는다 (폴링은 Vercel 60초 제한 — 종목 마스터 전체를 읽지 않는다) */
async function heldEntities(ids: string[]): Promise<{ byId: Map<string, EntityRow>; resolveName: (n: string) => string | null }> {
  const r = ids.length ? await dbSelect<EntityRow>("entities", `select=id,market,symbol,name,aliases,primary_l1,l1_codes,asset_class,snowball_asset_id,hermes_analysis_id,naver_us_code&id=in.(${ids.map((i) => `"${i}"`).join(",")})`) : { ok: true as const, data: [] as EntityRow[] };
  const rows = r.ok ? r.data : [];
  const key = (x: string) => x.replace(/[\s()㈜·.,]/g, "").toLowerCase();
  const names = new Map<string, string>();
  for (const e of rows) for (const n of [e.name, ...(e.aliases ?? [])]) if (n) names.set(key(n), e.id);
  return { byId: new Map(rows.map((e) => [e.id, e])), resolveName: (n) => names.get(key(n)) ?? null };
}

/** 이미 기록된 dedupe_key — 40개씩 묶어 한 번에 조회 */
async function existingKeys(keys: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < keys.length; i += 40) {
    const chunk = keys.slice(i, i + 40);
    const r = await dbSelect<{ dedupe_key: string }>("notifications", `select=dedupe_key&dedupe_key=in.(${chunk.map((k) => `"${encodeURIComponent(k)}"`).join(",")})`);
    if (r.ok) r.data.forEach((x) => out.add(x.dedupe_key));
    else chunk.forEach((k) => out.add(k));        // 조회 실패 시 보내지 않는다(중복 발송 방지)
  }
  return out;
}

export async function poll(now = new Date(), opts: { dryRun?: boolean } = {}): Promise<Record<string, unknown>> {
  const t0 = Date.now();
  const R = rules().queues.holding_alert;
  const holdings = await latestHoldings();
  const ents = await heldEntities(holdings.positions.map((p) => p.entity_id).filter((x): x is string => !!x));
  const held: Held[] = holdings.positions.filter((p) => p.asset_id).map((p) => ({
    asset_id: p.asset_id, entity_id: p.entity_id, name: p.name, ticker: p.ticker, weight: p.weight, allowed_weight: p.allowed_weight, heat_score: p.heat_score,
    invalidation: [p.invalidation_1, p.invalidation_2, p.invalidation_3].filter((x): x is string => !!x),
  }));
  const krCodes = held.map((h) => h.entity_id).filter((id): id is string => !!id && id.startsWith("KR:")).map((id) => id.slice(3));
  const heldNames = new Map(held.filter((h) => h.entity_id).map((h) => [h.entity_id as string, h]));
  const since14 = new Date(now.getTime() - R.mentor_flip_window_days * 86400_000).toISOString();

  const [ra, tr, sr, mn] = await Promise.all([
    exportRiskAlerts(new Date(now.getTime() - 2 * 86400_000).toISOString()),
    exportTriggers(3650),
    krCodes.length ? heimdallr<{ code: string; fiscal_year: number; fiscal_quarter: number; grade: string | null; score_delta: number | null; pri: number | null; computed_at: string }>(
      "screen_results", { select: "code,fiscal_year,fiscal_quarter,grade,score_delta,pri,computed_at", filters: { code: `in.(${krCodes.join(",")})` } }) : Promise.resolve({ ok: true as const, data: [] }),
    sage<{ mentor_id: string; stance: string; value: string; published_at: string }>("mentions", { select: "mentor_id,stance,value,published_at", filters: { mention_type: "eq.company", published_at: `gte.${since14}` } }),
  ]);
  if (!ra.ok) await recordSource("snowball", false, ra.reason);

  const screens: ScreenPair[] = [];
  const priBy = new Map<string, number | null>();
  if (sr.ok) {
    const by = new Map<string, typeof sr.data>();
    for (const s of sr.data) (by.get(s.code) ?? by.set(s.code, []).get(s.code)!).push(s);
    for (const [code, xs] of by) {
      xs.sort((a, b) => `${b.fiscal_year}${b.fiscal_quarter}${b.computed_at}`.localeCompare(`${a.fiscal_year}${a.fiscal_quarter}${a.computed_at}`));
      screens.push({ code, grade: xs[0].grade, prev_grade: xs[1]?.grade ?? null, score_delta: xs[0].score_delta, fiscal: `${xs[0].fiscal_year}Q${xs[0].fiscal_quarter}` });
      priBy.set(`KR:${code}`, xs[0].pri);
    }
  }
  const stances: MentorStance[] = (mn.ok ? mn.data : []).map((m) => ({ mentor_id: m.mentor_id, stance: m.stance, published_at: m.published_at, entity_id: ents.resolveName(m.value) ?? "" })).filter((m) => heldNames.has(m.entity_id));

  const known = new Set(await getState<string[]>("known_thesis_triggers") ?? []);
  const triggers = (tr.ok ? tr.data : []) as unknown as TriggerRow[];
  const bootstrapped = (await getState<boolean>("holding_alert_bootstrapped")) === true;
  const alerts = holdingAlerts({ held, riskAlerts: (ra.ok ? ra.data : []) as never, triggers, knownTriggerIds: bootstrapped ? known : new Set(triggers.map((t) => t.trigger_id)), screens, stances }, R, now);

  // 이미 기록된 경고 제외 (일괄 조회)
  const seen = await existingKeys([...new Set(alerts.map((a) => a.dedupe_key))]);
  const fresh: HoldingAlert[] = [...new Map(alerts.filter((a) => !seen.has(a.dedupe_key)).map((a) => [a.dedupe_key, a])).values()];
  const tFetch = Date.now() - t0;

  let sent = 0;
  const latencies: number[] = [];
  // 사용자 일시 정지(/alerts off): 계산·기록은 하되 보내지 않는다. 정지 중 쌓인 경고는 다시 켜도 한꺼번에 보내지 않는다.
  const paused = (await getState<{ paused?: boolean }>("holding_alert_pause"))?.paused === true;
  if (!bootstrapped || opts.dryRun || paused) {
    if (!opts.dryRun) {
      await dbInsert("notifications", fresh.map((a) => ({ kind: "holding_alert", dedupe_key: a.dedupe_key, entity_id: a.entity_id && ents.byId.has(a.entity_id) ? a.entity_id : null, payload: { ...a, ...(paused && bootstrapped ? { paused: true } : { bootstrap: true }) } })), { ignoreDuplicates: true, upsertOn: "dedupe_key" });
      if (!bootstrapped) await setState("holding_alert_bootstrapped", true);
    }
  } else {
    const chat = env().TELEGRAM_CHAT_ID;
    const lc = linksConfig(), tx = taxonomyConfig();
    const byAsset = new Map<string, HoldingAlert[]>();
    for (const a of fresh) (byAsset.get(a.asset_id) ?? byAsset.set(a.asset_id, []).get(a.asset_id)!).push(a);
    for (const [assetId, list] of byAsset) {
      const h = held.find((x) => x.asset_id === assetId)!;
      const e = h.entity_id ? ents.byId.get(h.entity_id) : undefined;
      const pri = h.entity_id ? priBy.get(h.entity_id) ?? null : null;
      const text = holdingAlertText({
        market: e?.market ?? null, name: h.name, code: e?.symbol ?? h.ticker,
        causes: list.map((a) => ({ summary: a.summary, source: a.source })),
        thesisLink: list.some((a) => a.cause === "thesis_trigger") && h.invalidation.length ? `SnowBall 훼손조건: ${h.invalidation.join(" / ")}` : null,
        weight: h.weight, allowed: h.allowed_weight, heat: h.heat_score, pri,
      });
      const kb = e ? stockKeyboard(e as unknown as LinkEntity, { links: lc, taxonomy: tx, jarvisUrl: env().JARVIS_URL }) : [];
      const r = chat ? await sendMessage(chat, text, kb) : { ok: false as const, reason: "TELEGRAM_CHAT_ID 미설정" };
      for (const a of list) {
        const lat = (now.getTime() - new Date(a.fired_at).getTime()) / 60000;
        if (a.cause === "snowball_risk") latencies.push(Math.round(lat));
        await dbInsert("notifications", [{ kind: "holding_alert", dedupe_key: a.dedupe_key, entity_id: a.entity_id && ents.byId.has(a.entity_id) ? a.entity_id : null,
          payload: { ...a, latency_min: Math.round(lat), error: r.ok ? undefined : r.reason }, sent_at: r.ok ? new Date().toISOString() : null, telegram_msg_id: r.ok ? r.data[0] : null }], { ignoreDuplicates: true, upsertOn: "dedupe_key" });
      }
      if (r.ok) sent++;
    }
  }
  await setState("known_thesis_triggers", triggers.filter((t) => t.thesis_link === R.thesis_break_trigger.thesis_link).map((t) => t.trigger_id));
  const byCause = fresh.reduce<Record<string, number>>((m, a) => ((m[a.cause] = (m[a.cause] ?? 0) + 1), m), {});
  return { bootstrap: !bootstrapped, paused, candidates: alerts.length, fresh: fresh.length, by_cause: byCause, messages: sent, latency_min: latencies, ms: { collect: tFetch, total: Date.now() - t0 } };
}
