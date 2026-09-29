/**
 * 세션 갱신 + 대시보드 보호 (PRD §8). 공개 경로: /login, /api/*(webhook·public API 는 자체 토큰으로 보호).
 * 허용 이메일(ALLOWED_EMAIL) 외 세션은 로그아웃시킨다. DB 는 RLS(jarvis.is_allowed)로 한 번 더 막는다.
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";

export function isPublicPath(path: string): boolean {
  return path.startsWith("/login") || path.startsWith("/api/") || path === "/robots.txt";
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const path = request.nextUrl.pathname;
  const e = env();
  const redirect = (pathname: string, search = "") => {
    const u = request.nextUrl.clone();
    u.pathname = pathname;
    u.search = search;
    return NextResponse.redirect(u);
  };
  if (isPublicPath(path)) {
    if (!e.NEXT_PUBLIC_SUPABASE_URL || !e.NEXT_PUBLIC_SUPABASE_ANON_KEY) return response;
  } else if (!e.NEXT_PUBLIC_SUPABASE_URL || !e.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return redirect("/login", "?error=config");
  }

  const supabase = createServerClient(e.NEXT_PUBLIC_SUPABASE_URL!, e.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list) {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();

  if (path.startsWith("/api/")) return response;
  if (!user && !isPublicPath(path)) return redirect("/login");
  const allowed = e.ALLOWED_EMAIL?.toLowerCase();
  if (user && (!allowed || user.email?.toLowerCase() !== allowed)) {
    await supabase.auth.signOut();
    return redirect("/login", "?error=forbidden");
  }
  if (user && path.startsWith("/login")) return redirect("/");
  return response;
}
