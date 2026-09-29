import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";

/**
 * 대시보드 로그인 — 이메일 + 비밀번호 (D31). 로그인하면 세션 쿠키가 유지되어 같은 브라우저에서는 다시 묻지 않는다
 * (access 토큰은 middleware 가 자동 갱신). 허용 이메일 외에는 시도조차 하지 않고 같은 오류를 보여준다.
 */
async function signIn(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const e = env();
  if (!e.NEXT_PUBLIC_SUPABASE_URL || !e.NEXT_PUBLIC_SUPABASE_ANON_KEY) redirect("/login?error=config");
  if (!email || !password || !e.ALLOWED_EMAIL || email !== e.ALLOWED_EMAIL.toLowerCase()) redirect("/login?error=invalid");
  const cookieStore = await cookies();
  const sb = createServerClient(e.NEXT_PUBLIC_SUPABASE_URL!, e.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => cookieStore.getAll(), setAll: (l) => l.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) },
  });
  const { error } = await sb.auth.signInWithPassword({ email, password });
  redirect(error ? "/login?error=invalid" : "/");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const msg = sp.error === "invalid" ? "이메일 또는 비밀번호가 맞지 않습니다."
    : sp.error === "forbidden" ? "허용되지 않은 계정입니다."
    : sp.error === "config" ? "환경변수(Supabase URL·anon 키)가 설정되지 않았습니다." : null;
  const input = "w-full rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2";
  return (
    <main className="mx-auto max-w-sm p-6 space-y-4">
      <h1 className="text-2xl font-bold">JARVIS 로그인</h1>
      <form action={signIn} className="space-y-3">
        <input name="email" type="email" required autoComplete="username" placeholder="이메일" className={input} />
        <input name="password" type="password" required autoComplete="current-password" placeholder="비밀번호" className={input} />
        <button className="w-full rounded bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 py-2 font-medium">로그인</button>
      </form>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      <p className="text-xs text-neutral-500">한 번 로그인하면 이 브라우저에서는 유지됩니다. 비밀번호 변경: PC에서 <code>npm run job -- set_password</code></p>
    </main>
  );
}
