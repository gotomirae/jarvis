/**
 * link_smoke (PRD §9.4, 매일 03:30): 링크 규칙별 대표 URL 을 GET 해 404·빈 화면을 잡는다 → jarvis.link_checks.
 * 대표 종목은 links.yaml smoke.samples, SnowBall 자산·HermesCall 분석 id 는 entities 에서 채운다.
 * P1 통과 조건: 링크 규칙 전부 200/3xx(로그인 필요 규칙).
 */
import fs from "node:fs";
import { linksConfig, taxonomyConfig } from "@/lib/config/load";
import { dbConfigured, dbInsert, dbSelect } from "@/lib/db";
import { env } from "@/lib/env";
import { resolveNaverUs } from "@/lib/ingest/naver";
import { runJob, slotOf } from "@/lib/jobs";
import { evaluateLink, fillTemplate, stockUrl, type LinkCtx, type LinkEntity } from "@/lib/links";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UA = "Mozilla/5.0 (compatible; JARVIS-link-smoke)";

async function fetchOnce(url: string, timeoutSec: number): Promise<{ status: number | null; body: string; location?: string }> {
  try {
    const res = await fetch(url, { redirect: "manual", headers: { "User-Agent": UA, Accept: "text/html,application/json;q=0.9,*/*;q=0.8" }, signal: AbortSignal.timeout(timeoutSec * 1000) });
    return { status: res.status, body: res.status >= 300 && res.status < 400 ? "" : await res.text(), location: res.headers.get("location") ?? undefined };
  } catch (e) {
    return { status: null, body: e instanceof Error ? e.message : String(e) };
  }
}

export async function linkSmokeJob(args: Record<string, string>): Promise<void> {
  await runJob("link_smoke", slotOf(args), async () => {
    const lc = linksConfig();
    const ctx: LinkCtx = { links: lc, taxonomy: taxonomyConfig(), jarvisUrl: env().JARVIS_URL };
    const s = lc.smoke;

    const sample = async (m: "KR" | "US"): Promise<LinkEntity> => {
      const base = s.samples[m];
      const e: LinkEntity = { id: `${m}:${base.symbol}`, market: m, symbol: base.symbol, name: base.name, primary_l1: base.primary_l1 };
      if (dbConfigured()) {
        const r = await dbSelect<{ snowball_asset_id: string | null; hermes_analysis_id: string | null; naver_us_code: string | null }>("entities", `select=snowball_asset_id,hermes_analysis_id,naver_us_code&id=eq.${encodeURIComponent(e.id)}`);
        if (r.ok && r.data[0]) Object.assign(e, r.data[0]);
      }
      if (m === "US" && !e.naver_us_code) e.naver_us_code = await resolveNaverUs(e.symbol, lc.stock.naver as unknown as { us_resolve_api: string; us_suffixes: string[] });
      return e;
    };
    const kr = await sample("KR");
    const us = await sample("US");

    const targets = new Map<string, string>();   // url → rule
    const add = (rule: string, url: string | null) => { if (url && !targets.has(url)) targets.set(url, rule); };
    for (const [k, d] of Object.entries(lc.dashboards)) add(`dashboard.${k}`, fillTemplate(d.url, { JARVIS_URL: ctx.jarvisUrl?.replace(/\/$/, "") }));
    for (const k of Object.keys(lc.stock)) { add(`kr.${k}`, stockUrl(k, kr, ctx)); add(`us.${k}`, stockUrl(k, us, ctx)); }
    // 폴백 경로도 한 번씩
    add("fallback.hermescall", stockUrl("hermescall", { ...us, hermes_analysis_id: null }, ctx));
    add("fallback.snowball", stockUrl("snowball", { ...us, snowball_asset_id: null }, ctx));
    add("fallback.flywheel:l1", stockUrl("flywheel", { ...kr, primary_l1: "1l" }, ctx));
    add("fallback.naver:us_search", stockUrl("naver", { ...us, naver_us_code: null }, ctx));
    const nav = lc.stock.naver as unknown as { us_resolve_api: string };
    add("naver:us_resolve_api", nav.us_resolve_api.replace("{symbol}", us.symbol).replace("{suffix}", ".O"));

    const rows: { rule: string; sample_url: string; status: number | null; ok: boolean; note: string }[] = [];
    const lastHost = new Map<string, number>();
    for (const [url, rule] of targets) {
      const host = new URL(url).host;
      const wait = 1000 - (Date.now() - (lastHost.get(host) ?? 0));
      if (wait > 0) await sleep(wait);
      let r = await fetchOnce(url, s.timeout_sec);
      lastHost.set(host, Date.now());
      let ev = evaluateLink(rule, r.status, r.body, s);
      // 로그인 규칙이 아닌 3xx 는 최대 max_redirects 번 따라가서 최종 페이지로 판정 (예: notion.so → app.notion.com)
      let cur = url;
      const hops: string[] = [];
      for (let i = 0; i < s.max_redirects && !ev.ok && r.status && r.status >= 300 && r.status < 400 && r.location; i++) {
        cur = new URL(r.location, cur).toString();
        hops.push(new URL(cur).host);
        r = await fetchOnce(cur, s.timeout_sec);
        ev = evaluateLink(rule, r.status, r.body, s);
      }
      if (hops.length) ev.note = `→ ${hops.join(" → ")} · ${ev.note}`;
      rows.push({ rule, sample_url: url, status: r.status, ok: ev.ok, note: ev.note });
    }

    if (dbConfigured()) await dbInsert("link_checks", rows);
    fs.mkdirSync("smoke-out", { recursive: true });
    fs.writeFileSync("smoke-out/link_smoke.json", JSON.stringify({ at: new Date().toISOString(), rows }, null, 2));
    const md = ["| 규칙 | HTTP | 결과 | 비고 |", "|---|---|---|---|", ...rows.map((x) => `| ${x.rule} | ${x.status ?? "-"} | ${x.ok ? "✅" : "❌"} | ${x.note} |`)];
    console.log(md.join("\n"));
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## 링크 스모크\n\n${md.join("\n")}\n`);
    const failed = rows.filter((x) => !x.ok);
    const detail = { checked: rows.length, failed: failed.map((x) => x.rule) };
    if (failed.length) throw new Error(`링크 스모크 실패 ${failed.length}/${rows.length}: ${failed.map((x) => x.rule).join(", ")}`);
    return detail;
  });
}
