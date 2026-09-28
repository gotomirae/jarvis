/**
 * 대시보드 서버용 Supabase 클라이언트 — 사용자 세션(쿠키) 기반, RLS 적용(jarvis.is_allowed()).
 * 페이지는 JARVIS DB 만 읽는다(PRD §8). 쓰기는 Server Action 에서 허용 사용자 확인 후 lib/db.ts(service)로 한다.
 */
import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

export async function supabaseServer() {
  const e = env();
  if (!e.NEXT_PUBLIC_SUPABASE_URL || !e.NEXT_PUBLIC_SUPABASE_ANON_KEY) throw new Error("NEXT_PUBLIC_SUPABASE_URL/ANON_KEY 미설정");
  const cookieStore = await cookies();
  return createServerClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    db: { schema: "jarvis" },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(list) {
        try { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); } catch { /* RSC 에서는 쓰기 불가 — middleware 가 갱신 */ }
      },
    },
  });
}

/** 현재 사용자가 ALLOWED_EMAIL 인가 — Server Action 쓰기 전 확인 */
export async function requireAllowedUser(): Promise<string> {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  const allowed = env().ALLOWED_EMAIL?.toLowerCase();
  const email = data.user?.email?.toLowerCase();
  if (!email || !allowed || email !== allowed) throw new Error("권한 없음");
  return email;
}
