"use client";

import { useEffect } from "react";

type TgWebApp = { openLink?: (url: string) => void; ready?: () => void };
const tg = () => (globalThis as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;

/** 텔레그램 미니 앱 안에서는 openLink 로 기본 브라우저에 연다(로그인 세션 유지). 일반 브라우저에서는 새 탭. */
export function GoLink({ text, url }: { text: string; url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        const w = tg();
        if (w?.openLink) { e.preventDefault(); w.openLink(url); }
      }}
      className="rounded-xl border border-line bg-panel/80 px-3 py-4 text-center text-base font-semibold text-white active:bg-panel2"
    >
      {text}
    </a>
  );
}

/** 텔레그램 미니 앱 스크립트는 hydration 이 끝난 뒤 붙인다 — 먼저 붙이면 <html> style 을 바꿔 hydration 불일치가 난다 */
export function TelegramScript() {
  useEffect(() => {
    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-web-app.js";
    s.async = true;
    s.onload = () => tg()?.ready?.();
    document.head.appendChild(s);
  }, []);
  return null;
}
