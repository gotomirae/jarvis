/**
 * P0: 5개 소스 읽기 실측 (PRD §5 · §16 P0). 결과는 상태·행 수·컬럼명만 — 데이터 값·키는 출력/저장하지 않는다.
 */
import fs from "node:fs";
import { ADAPTERS } from "@/lib/ingest";
import { exportPositions } from "@/lib/ingest/snowball";
import type { ProbeRow } from "@/lib/ingest/types";

export async function sourceSmokeJob(args: Record<string, string>): Promise<void> {
  const rows: ProbeRow[] = [];
  for (const a of ADAPTERS) {
    if (args.source && args.source !== a.name) continue;
    rows.push(...(await a.probe()));
  }

  // SnowBall: 보유 종목 반환 여부 + asset_class 분포(개별 종목 신호는 stock 만). 금액·수량은 보지 않는다.
  let snowballSummary: Record<string, unknown> | null = null;
  if (!args.source || args.source === "snowball") {
    const p = await exportPositions();
    snowballSummary = p.ok
      ? { positions: p.data.length, by_asset_class: p.data.reduce<Record<string, number>>((m, x) => ((m[String(x.asset_class)] = (m[String(x.asset_class)] ?? 0) + 1), m), {}),
          by_market: p.data.reduce<Record<string, number>>((m, x) => ((m[String(x.market)] = (m[String(x.market)] ?? 0) + 1), m), {}) }
      : { error: p.reason };
  }

  fs.mkdirSync("smoke-out", { recursive: true });
  const out = { at: new Date().toISOString(), rows, snowball: snowballSummary };
  fs.writeFileSync("smoke-out/source_smoke.json", JSON.stringify(out, null, 2));

  console.log("| 소스 | 객체 | HTTP | 읽기 | 행(limit1) | 비고 |");
  console.log("|---|---|---|---|---|---|");
  for (const r of rows) {
    console.log(`| ${r.source} | ${r.table} | ${r.status ?? "-"} | ${r.readable ? "✅" : "❌"} | ${r.rows} | ${(r.note ?? "").replace(/\|/g, "/")} |`);
  }
  if (snowballSummary) console.log("\nSnowBall positions:", JSON.stringify(snowballSummary));
}
