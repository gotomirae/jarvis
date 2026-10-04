import type { ReactNode } from "react";
import { NavBar } from "./nav";

/** 상단 로고·탭·탭 활용법 (모든 화면 공용) */
export function Nav() {
  return <NavBar />;
}

export function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight">
        <span>{title}</span>
        {count !== undefined && <span className="rounded-full bg-gold/15 border border-gold/50 px-2 py-0.5 text-sm font-semibold text-gold">{count}</span>}
      </h2>
      <div className="h-px bg-gradient-to-r from-gold/60 via-line to-transparent" />
      {children}
    </section>
  );
}

const TONE = { warn: "border-l-hot", good: "border-l-good", muted: "border-l-line", gold: "border-l-gold" } as const;

export function Card({ children, tone }: { children: ReactNode; tone?: keyof typeof TONE }) {
  return <div className={`glass rounded-xl border-l-4 ${TONE[tone ?? "muted"]} p-4 text-sm space-y-2`}>{children}</div>;
}

export function LinkRow({ links }: { links: { key: string; button: { text: string; url: string } }[] }) {
  return (
    <div className="flex flex-wrap gap-2 text-xs pt-1">
      {links.map((l) => <a key={l.key} href={l.button.url} target="_blank" rel="noreferrer" className="rounded-full border border-arc/50 bg-arc/10 px-2.5 py-1 text-arc hover:bg-arc/20">{l.button.text}</a>)}
    </div>
  );
}

export const Empty = ({ text }: { text: string }) => <p className="text-sm text-sub">💤 {text}</p>;

/** 섹션 설명 — 이 목록이 무엇인지 */
export const Guide = ({ children }: { children: ReactNode }) => (
  <div className="rounded-lg border border-line/70 bg-panel2/60 px-3 py-2 text-sm text-sub">ℹ️ {children}</div>
);

export const Footer = ({ asOf }: { asOf?: string }) => (
  <footer className="pt-6 pb-10 text-sm text-sub space-y-1 border-t border-line/60">
    {asOf && <p>🕒 기준 {asOf} KST</p>}
    <p>⚠️ <b className="text-gold">매수 확정 신호가 아닙니다.</b> 최종 판단·입력은 SnowBall에서.</p>
  </footer>
);

/** 화면 바탕 (가로 폭 · 간격) */
export const Page = ({ children, wide }: { children: ReactNode; wide?: boolean }) => (
  <main className={`mx-auto ${wide ? "max-w-6xl" : "max-w-4xl"} px-4 py-4 space-y-8`}>{children}</main>
);

// ── 강조 ─────────────────────────────────────────────
/** 중요한 키워드(금색 굵게) */
export const Hi = ({ children }: { children: ReactNode }) => <b className="text-gold font-semibold">{children}</b>;
export const Good = ({ children }: { children: ReactNode }) => <b className="text-good font-semibold">{children}</b>;
export const Bad = ({ children }: { children: ReactNode }) => <b className="text-hot font-semibold">{children}</b>;

/** 등락률 — 국내 관례대로 상승 빨강 ▲ · 하락 파랑 ▼ */
export function Pct({ v, digits = 1, arrow = true }: { v: number | null | undefined; digits?: number; arrow?: boolean }) {
  if (v === null || v === undefined || !Number.isFinite(v)) return <span className="text-sub">-</span>;
  const c = v > 0 ? "text-hot" : v < 0 ? "text-cool" : "text-white";
  return <b className={`${c} font-semibold tabular-nums`}>{arrow ? (v > 0 ? "▲ " : v < 0 ? "▼ " : "") : ""}{v > 0 ? "+" : ""}{v.toFixed(digits)}%</b>;
}

/** 요약 숫자 타일 */
export function Stat({ icon, label, value, sub, tone }: { icon: string; label: string; value: ReactNode; sub?: ReactNode; tone?: "gold" | "good" | "hot" | "arc" }) {
  const c = tone === "good" ? "text-good" : tone === "hot" ? "text-hot" : tone === "arc" ? "text-arc" : "text-gold";
  return (
    <div className="glass rounded-xl px-4 py-3 min-w-[9rem] flex-1">
      <div className="text-sm text-sub">{icon} {label}</div>
      <div className={`text-2xl font-extrabold tabular-nums ${c}`}>{value}</div>
      {sub && <div className="text-xs text-sub mt-0.5">{sub}</div>}
    </div>
  );
}

/** ✅/⚠️/❌/➖ 줄을 색으로 */
export function MarkLine({ text }: { text: string }) {
  const c = text.startsWith("✅") ? "text-good" : text.startsWith("❌") ? "text-hot" : text.startsWith("⚠️") ? "text-warn" : "text-sub";
  const [icon, ...rest] = text.split(" ");
  return <li><span className="mr-1">{icon}</span><span className={c === "text-sub" ? "text-sub" : `${c}`}>{rest.join(" ")}</span></li>;
}
