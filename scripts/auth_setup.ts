/**
 * auth_setup: ALLOWED_EMAIL 을 jarvis.allowed_users 에 등록한다(0003). 이메일은 저장소에 적지 않는다.
 *   npm run job -- auth_setup
 */
import { dbInsert, dbSelect } from "@/lib/db";
import { need } from "@/lib/env";

export async function authSetupJob(): Promise<void> {
  const email = need("ALLOWED_EMAIL").toLowerCase();
  const w = await dbInsert("allowed_users", [{ email }], { upsertOn: "email" });
  if (!w.ok) throw new Error(`allowed_users 등록 실패: ${w.reason} (0003_allowed_user_rls.sql 적용 여부 확인)`);
  const r = await dbSelect<{ email: string }>("allowed_users", "select=email");
  console.log(`allowed_users ${r.ok ? r.data.length : "?"}명 등록됨 (ALLOWED_EMAIL 반영)`);
}
