"use server";
/**
 * /taxonomy 확정 (PRD §4.1.3 ⑥, SC2). 허용 사용자만. 확정값은 런타임 overrides(taxonomy_pending confirmed)로 쓰이고,
 * 다음 taxonomy_sync·entities_sync 부터 반영된다. yaml overrides 승격은 PR 로 한다.
 */
import { revalidatePath } from "next/cache";
import { dbUpdate } from "@/lib/db";
import { requireAllowedUser } from "@/lib/supabase/server";

const CODE = /^(?:[0-9][a-z]|MACRO|ETF|ETC)$/;

export async function resolvePending(formData: FormData) {
  await requireAllowedUser();
  const id = Number(formData.get("id"));
  const toEtc = formData.get("action") === "etc";
  const codes = toEtc ? ["ETC"] : [...new Set(formData.getAll("l1").map(String).filter((c) => CODE.test(c)))];
  if (!Number.isInteger(id) || !codes.length) throw new Error("L1 을 하나 이상 고르세요");
  const r = await dbUpdate("taxonomy_pending", `id=eq.${id}&status=eq.pending`, {
    status: "confirmed", resolved_l1: codes, resolved_at: new Date().toISOString(),
  });
  if (!r.ok) throw new Error(r.reason);
  revalidatePath("/taxonomy");
}
