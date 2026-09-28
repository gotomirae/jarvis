import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";

/** 매직링크 로그인 (PRD §8). 허용 이메일이 아니어도 같은 안내를 보여 계정 존재 여부를 드러내지 않는다. */
async function sendLink(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const e = env();
  if (email && e.ALLOWED_EMAIL && email === e.ALLOWED_EMAIL.toLowerCase() && e.NEXT_PUBLIC_SUPABASE_URL && e.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const cookieStore = await cookies();
    const sb = createServerClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      cookies: { getAll: () => cookieStore.getAll(), setAll: (l) => l.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) },
    });
    const base = (e.JARVIS_URL ?? "").replace(/\/$/, "");
    await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: `${base}/auth/callback` } });
  }
  redirect("/login?sent=1");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const msg = sp.sent ? "허용된 이메일이면 로그인 링크를 보냈습니다. 메일함을 확인하세요."
    : sp.error === "forbidden" ? "허용되지 않은 계정입니다."
    : sp.error === "config" ? "환경변수(Supabase URL·anon 키)가 설정되지 않았습니다."
    : sp.error === "callback" ? "로그인 링크가 만료되었거나 잘못되었습니다. 다시 요청하세요." : null;
  return (
    <main className="mx-auto max-w-sm p-6 space-y-4">
      <h1 className="text-2xl font-bold">JARVIS 로그인</h1>
      <form action={sendLink} className="space-y-3">
        <input name="email" type="email" required placeholder="이메일" className="w-full rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2" />
        <button className="w-full rounded bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 py-2 font-medium">매직링크 받기</button>
      </form>
      {msg && <p className="text-sm text-neutral-500">{msg}</p>}
    </main>
  );
}
