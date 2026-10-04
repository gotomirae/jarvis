"use client";
import { usePathname } from "next/navigation";
import { tabOf, TABS } from "./tabs";

/** 상단: 큰 필기체 JARVIS + 탭 + 지금 탭의 활용법 */
export function NavBar() {
  const path = usePathname() ?? "/";
  const cur = tabOf(path);
  return (
    <header className="space-y-4">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-1 pt-2">
        <a href="/" className="jarvis-logo text-7xl sm:text-8xl select-none" aria-label="JARVIS 홈">JARVIS</a>
        <p className="pb-3 text-sm text-sub">
          <span className="text-arc font-semibold tracking-[0.25em]">IRON MAN</span> 투자 통합 지휘 시스템
        </p>
      </div>
      <nav className="flex flex-wrap gap-2" aria-label="탭">
        {TABS.map((t) => {
          const on = cur?.href === t.href;
          return (
            <a key={t.href} href={t.href} aria-current={on ? "page" : undefined}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition border ${on ? "bg-gold text-ink border-gold shadow-[0_0_14px_rgba(252,211,77,0.45)]" : "border-line bg-panel/70 text-white hover:border-arc hover:text-arc"}`}>
              {t.icon} {t.label}
            </a>
          );
        })}
      </nav>
      {cur && (
        <details open className="glass rounded-xl px-4 py-3 group">
          <summary className="cursor-pointer list-none flex items-center justify-between gap-2">
            <span className="font-semibold">
              {cur.icon} <span className="text-gold">{cur.label}</span> 이렇게 쓰세요
              <span className="ml-2 text-sm font-normal text-sub">⏰ {cur.when}</span>
            </span>
            <span className="text-xs text-sub group-open:hidden">펼치기 ▾</span>
            <span className="text-xs text-sub hidden group-open:inline">접기 ▴</span>
          </summary>
          <ol className="mt-2 space-y-1 text-sm">
            {cur.how.map((h, i) => <li key={i}><span className="text-arc font-bold mr-1">{i + 1}.</span>{h}</li>)}
          </ol>
        </details>
      )}
    </header>
  );
}
