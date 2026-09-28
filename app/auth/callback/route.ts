import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

/** 매직링크 콜백: code → 세션 쿠키. 허용 이메일 검사는 middleware 가 한다. */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const to = req.nextUrl.clone();
  to.search = "";
  if (code) {
    const sb = await supabaseServer();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) { to.pathname = "/"; return NextResponse.redirect(to); }
  }
  to.pathname = "/login";
  to.search = "?error=callback";
  return NextResponse.redirect(to);
}
