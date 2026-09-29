/**
 * 대시보드 로그인 비밀번호 설정 (D31) — **사용자가 자기 PowerShell 에서 직접 실행**한다(대화형, 입력은 화면에 보이지 않음).
 *   npm run job -- set_password
 * ALLOWED_EMAIL 계정이 없으면 만들고(이메일 확인 완료 상태), 있으면 비밀번호만 바꾼다. Supabase Admin API(service 키) 사용.
 * 비밀번호는 어디에도 저장·출력하지 않는다.
 */
import readline from "node:readline";
import { need } from "@/lib/env";
import { dbInsert } from "@/lib/db";

function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    let muted = false;
    out._writeToOutput = (s: string) => { if (!muted || s.includes("\n")) out.output.write(muted ? "\n" : s); };
    rl.question(prompt, (v) => { rl.close(); resolve(v); });
    muted = true;
  });
}

export async function setPasswordJob(): Promise<void> {
  if (!process.stdin.isTTY) throw new Error("대화형 터미널(PowerShell)에서 직접 실행하세요: npm run job -- set_password");
  const url = need("NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
  const key = need("SUPABASE_SERVICE_KEY");
  const email = need("ALLOWED_EMAIL").toLowerCase();
  const h = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

  console.log(`JARVIS 대시보드 비밀번호 설정 — 계정: ${email.replace(/^(.{2}).*(@.*)$/, "$1***$2")}`);
  const pw1 = await askHidden("새 비밀번호(10자 이상, 입력이 보이지 않음): ");
  const pw2 = await askHidden("한 번 더: ");
  if (pw1 !== pw2) throw new Error("두 번 입력한 비밀번호가 다릅니다.");
  if (pw1.length < 10) throw new Error("10자 이상으로 정하세요.");

  const list = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=1000`, { headers: h });
  if (list.status !== 200) throw new Error(`사용자 조회 실패 HTTP ${list.status}`);
  const users = ((await list.json()) as { users: { id: string; email?: string }[] }).users;
  const found = users.find((u) => u.email?.toLowerCase() === email);

  const res = found
    ? await fetch(`${url}/auth/v1/admin/users/${found.id}`, { method: "PUT", headers: h, body: JSON.stringify({ password: pw1, email_confirm: true }) })
    : await fetch(`${url}/auth/v1/admin/users`, { method: "POST", headers: h, body: JSON.stringify({ email, password: pw1, email_confirm: true }) });
  if (res.status >= 300) {
    const body = (await res.text()).slice(0, 200);
    throw new Error(`비밀번호 설정 실패 HTTP ${res.status}: ${body}`);
  }
  await dbInsert("allowed_users", [{ email }], { upsertOn: "email" });
  console.log(`✅ ${found ? "기존 계정 비밀번호 변경" : "계정 생성"} 완료. JARVIS 주소/login 에서 이메일·비밀번호로 로그인하세요.`);
}
