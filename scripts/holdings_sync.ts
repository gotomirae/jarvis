/**
 * holdings_sync (PRD §4.3, 07:10·16:10): SnowBall jarvis_export_positions → jarvis.holdings_cache 스냅샷.
 * 수량·평단·평가액은 저장하지 않는다(sanitizePosition, D26). 보유 종목의 snowball_asset_id 를 entities 에 반영한다.
 * JARVIS 는 SnowBall 에 아무것도 쓰지 않는다(불변 규칙 1).
 */
import { dbInsert, dbUpdate } from "@/lib/db";
import { sanitizePosition } from "@/lib/entities";
import { exportPositions } from "@/lib/ingest/snowball";
import { recordSource, runJob, slotOf } from "@/lib/jobs";

export async function holdingsSyncJob(args: Record<string, string>): Promise<void> {
  await runJob("holdings_sync", slotOf(args), async () => {
    const p = await exportPositions();
    if (!p.ok) {
      const n = await recordSource("snowball", false, p.reason);
      throw new Error(`SnowBall positions 실패(연속 ${n}회): ${p.reason}`);
    }
    await recordSource("snowball", true);
    const positions = p.data.map((x) => sanitizePosition(x as Record<string, unknown>));
    const w = await dbInsert("holdings_cache", [{ payload: { source: "snowball.jarvis_export_positions", count: positions.length, positions } }]);
    if (!w.ok) throw new Error(w.reason);

    let linked = 0;
    for (const x of positions) {
      if (!x.entity_id || !x.asset_id) continue;
      const u = await dbUpdate("entities", `id=eq.${encodeURIComponent(String(x.entity_id))}`, { snowball_asset_id: x.asset_id });
      if (u.ok) linked += u.data;
    }
    const byClass = positions.reduce<Record<string, number>>((m, x) => ((m[String(x.asset_class)] = (m[String(x.asset_class)] ?? 0) + 1), m), {});
    console.log(`holdings_cache 저장: ${positions.length}종목 ${JSON.stringify(byClass)} · entities 연결 ${linked}`);
    return { positions: positions.length, by_asset_class: byClass, entities_linked: linked };
  });
}
