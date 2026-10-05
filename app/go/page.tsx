import { linksConfig } from "@/lib/config/load";
import { env } from "@/lib/env";
import { dashboardButtons } from "@/lib/links";
import { GoLink, TelegramScript } from "./go-link";

/**
 * 📌 프로젝트 바로가기 (D58) — @Tonny_JARVIS_bot 입력창 옆 메뉴 버튼이 텔레그램 안에서 여는 화면.
 * 버튼은 links.yaml dashboards 6개(/pin 고정 메시지와 같은 함수). 로그인 없이 연다(공개 주소만 표시).
 */
export const dynamic = "force-dynamic";

export default function GoPage() {
  const buttons = dashboardButtons(linksConfig().dashboards, env().JARVIS_URL);
  return (
    <main className="mx-auto max-w-md px-4 py-6">
      <TelegramScript />
      <h1 className="text-xl font-bold">📌 프로젝트 바로가기</h1>
      <p className="mt-1 text-sub">누르면 기본 브라우저로 열립니다 — 로그인이 유지됩니다.</p>
      <div className="mt-5 grid grid-cols-2 gap-3">
        {buttons.map((b) => <GoLink key={b.url} text={b.text} url={b.url} />)}
      </div>
    </main>
  );
}
