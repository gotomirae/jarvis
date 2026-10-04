import type { Metadata } from "next";
import { Great_Vibes } from "next/font/google";
import "./globals.css";

/** JARVIS 로고용 필기체 (사용자 지정 2026-10-04) */
const script = Great_Vibes({ weight: "400", subsets: ["latin"], variable: "--font-great-vibes", display: "swap" });

export const metadata: Metadata = {
  title: "JARVIS",
  description: "아이언맨 투자 통합 지휘 시스템",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={script.variable}>
      <body className="min-h-dvh antialiased text-white text-[15px] leading-relaxed">{children}</body>
    </html>
  );
}
