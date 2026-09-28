/**
 * taxonomy DB 헬퍼 (서버·배치 전용). 대시보드에서 확정한 매핑(taxonomy_pending confirmed)은 yaml overrides 보다 먼저 적용되는
 * 런타임 overrides 로 쓴다(PRD §4.1.3 ⑥ "확정 결과는 overrides 로 승격"). yaml 승격은 PR 로 한다.
 */
import expected from "@/config/taxonomy_expected.json";
import { dbSelectAll } from "@/lib/db";
import type { Override } from "@/lib/taxonomy/match";

export type PendingRow = { id: number; project: string; label: string; suggested_l1: string[]; method: string; status: string; resolved_l1: string[] | null; first_seen: string };

export async function confirmedOverrides(): Promise<Override[]> {
  const r = await dbSelectAll<PendingRow>("taxonomy_pending", "select=project,label,resolved_l1&status=eq.confirmed");
  if (!r.ok) return [];
  return r.data.filter((x) => x.resolved_l1?.length).map((x) => ({ project: x.project, label: x.label, l1: x.resolved_l1 as string[] }));
}

/** 참조 스냅샷에 있는 라벨 = 이미 확인된 라벨 (프로젝트 키는 스냅샷 키와 같다) */
export function snapshotLabels(project: string): Set<string> {
  const snap = expected as Record<string, Record<string, unknown>>;
  return new Set(Object.keys(snap[project] ?? {}));
}
