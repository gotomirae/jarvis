import { PHASE_HINT, PHASE_NAME, type Cycle } from "@/lib/engine/cycle";

/** 🔄 주기 그래프 — y = −cos(θ) 사인 곡선(바닥 → 정점 → 바닥) 위에 지금 위치를 점으로 */
export function CycleGraph({ c }: { c: Cycle | null }) {
  if (!c) return <p className="text-xs text-sub">🔄 주기 계산 자료 부족</p>;
  const W = 220, H = 70, pad = 8;
  const x = (deg: number) => pad + (deg / 360) * (W - 2 * pad);
  const y = (deg: number) => H / 2 + (Math.cos((deg * Math.PI) / 180) * (H / 2 - pad));
  const seg = (a: number, b: number) => Array.from({ length: 31 }, (_, i) => a + ((b - a) * i) / 30).map((d, i) => `${i ? "L" : "M"}${x(d).toFixed(1)},${y(d).toFixed(1)}`).join(" ");
  const colors = ["#34d399", "#ff6b6b", "#fb923c", "#60a5fa"];
  return (
    <div className="flex items-center gap-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-40 shrink-0" role="img" aria-label={`주기 ${PHASE_NAME[c.phase]}`}>
        {[0, 90, 180, 270].map((a, i) => <path key={a} d={seg(a, a + 90)} stroke={colors[i]} strokeWidth={3} fill="none" opacity={0.85} />)}
        <circle cx={x(c.angle)} cy={y(c.angle)} r={6} fill="#fcd34d" stroke="#fff" strokeWidth={2} />
        <text x={x(0)} y={H - 1} fill="#bcd4ff" fontSize={9}>바닥</text>
        <text x={x(180) - 10} y={9} fill="#bcd4ff" fontSize={9}>정점</text>
      </svg>
      <div className="text-sm leading-tight">
        <p className="font-bold whitespace-nowrap">{PHASE_NAME[c.phase]}</p>
        <p className="text-xs text-sub whitespace-nowrap">{PHASE_HINT[c.phase]}</p>
      </div>
    </div>
  );
}
