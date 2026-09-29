import type { ReactNode } from "react";

export function Nav() {
  const items: [string, string][] = [["/", "오늘"], ["/portfolio", "포트폴리오"], ["/growth", "산업 성장"], ["/taxonomy", "산업 매핑"]];
  return (
    <nav className="flex flex-wrap gap-3 text-sm border-b border-neutral-200 dark:border-neutral-800 pb-2">
      <span className="font-bold">JARVIS</span>
      {items.map(([href, label]) => <a key={href} href={href} className="text-neutral-600 dark:text-neutral-400 hover:underline">{label}</a>)}
    </nav>
  );
}

export function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="font-semibold">{title}{count !== undefined && <span className="ml-1 text-neutral-500 font-normal">{count}</span>}</h2>
      {children}
    </section>
  );
}

export function Card({ children, tone }: { children: ReactNode; tone?: "warn" | "good" | "muted" }) {
  const border = tone === "warn" ? "border-red-400" : tone === "good" ? "border-emerald-400" : "border-neutral-200 dark:border-neutral-800";
  return <div className={`rounded border ${border} p-3 text-sm space-y-1`}>{children}</div>;
}

export function LinkRow({ links }: { links: { key: string; button: { text: string; url: string } }[] }) {
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {links.map((l) => <a key={l.key} href={l.button.url} target="_blank" rel="noreferrer" className="rounded border border-neutral-300 dark:border-neutral-700 px-2 py-0.5">{l.button.text}</a>)}
    </div>
  );
}

export const Empty = ({ text }: { text: string }) => <p className="text-sm text-neutral-500">{text}</p>;
export const Footer = ({ asOf }: { asOf?: string }) => (
  <footer className="pt-4 text-xs text-neutral-500 space-y-1">
    {asOf && <p>기준 {asOf} KST</p>}
    <p>⚠️ 매수 확정 신호가 아닙니다. 최종 판단·입력은 SnowBall에서.</p>
  </footer>
);
