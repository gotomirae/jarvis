export default function Home() {
  return (
    <main className="mx-auto max-w-xl p-6 space-y-3">
      <h1 className="text-2xl font-bold">JARVIS</h1>
      <p className="text-sm text-neutral-500">오늘 화면(행동 큐)은 P2에서 열립니다.</p>
      <nav className="flex gap-3 text-sm">
        <a href="/taxonomy" className="underline">산업 매핑</a>
      </nav>
      <p className="text-xs text-neutral-500">⚠️ 매수 확정 신호가 아닙니다. 최종 판단·입력은 SnowBall에서.</p>
    </main>
  );
}
