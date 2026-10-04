"use client";
import { usePathname } from "next/navigation";
import { tabOf, TAB_GROUPS } from "./tabs";

/** 상단: 큰 필기체 JARVIS + 묶음별 탭 + 지금 탭의 활용법 */
export function NavBar() {
  const path = usePathname() ?? "/";
  const cur = tabOf(path);
  return (
    <header className="space-y-4">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-1 pt-3 pl-2">
        <a href="/" className="jarvis-logo text-7xl sm:text-8xl select-none" aria-label="JARVIS 홈">JARVIS</a>
        <p className="pb-4 text-sm text-sub whitespace-nowrap">🦾 <span className="text-arc font-semibold">아이언맨</span> 투자 통합 지휘 시스템</p>
      </div>
      <nav className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-label="탭">
        {TAB_GROUPS.map((g) => (
          <div key={g.name} className="glass rounded-xl px-3 py-2">
            <p className="text-xs font-bold text-gold mb-1.5 whitespace-nowrap">▸ {g.name}</p>
            <div className="flex flex-col gap-1.5">
              {g.tabs.map((t) => {
                const on = cur?.href === t.href;
                return (
                  <a key={t.href} href={t.href} aria-current={on ? "page" : undefined}
                    className={`one-line rounded-lg px-3 py-1.5 text-sm font-semibold border transition ${on ? "bg-gold text-ink border-gold shadow-[0_0_14px_rgba(252,211,77,0.45)]" : "border-line bg-panel/70 text-white hover:border-arc hover:text-arc"}`}>
                    {t.icon} {t.label}
                  </a>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      {cur && (
        <details open className="glass rounded-xl px-4 py-3 group">
          <summary className="cursor-pointer list-none flex items-center justify-between gap-3">
            <span className="one-line font-bold">{cur.icon} <span className="text-gold">{cur.label}</span> 이렇게 쓰세요 <span className="ml-1 text-sm font-normal text-sub">⏰ {cur.when}</span></span>
            <span className="text-xs text-sub whitespace-nowrap group-open:hidden">펼치기 ▾</span>
            <span className="text-xs text-sub whitespace-nowrap hidden group-open:inline">접기 ▴</span>
          </summary>
          <ol className="mt-2 grid gap-1.5 sm:grid-cols-3 text-sm">
            {cur.how.map((h, i) => <li key={i} className="rounded-lg bg-panel2/70 px-3 py-1.5"><span className="text-arc font-bold mr-1">{i + 1}</span>{h}</li>)}
          </ol>
        </details>
      )}
    </header>
  );
}
