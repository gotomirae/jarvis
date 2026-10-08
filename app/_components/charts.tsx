"use client";
/**
 * 대시보드 그래프 (recharts, 표시 전용 — D56). 색: 글자 흰색·보조 하늘색(회색 금지), 상승 빨강·하락 파랑, 핵심 금색.
 */
import { Area, AreaChart, Bar, CartesianGrid, Cell, ComposedChart, Line, LineChart, ReferenceArea, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, usePlotArea, useXAxisScale, useYAxisScale, XAxis, YAxis } from "recharts";

const SUB = "#bcd4ff", GRID = "rgba(36,64,122,0.55)", GOLD = "#fcd34d", HOT = "#ff6b6b", COOL = "#60a5fa", GOOD = "#34d399", ARC = "#67e8f9";
const tick = { fill: SUB, fontSize: 11 };
const tip = { contentStyle: { background: "#0d1630", border: "1px solid #24407a", borderRadius: 8, color: "#fff" }, labelStyle: { color: GOLD, fontWeight: 700 }, itemStyle: { color: "#fff" } };
const md = (d: string) => `${d.slice(2, 4)}/${d.slice(5, 7)}`;
const mdd = (d: string) => `${d.slice(5, 7)}/${d.slice(8, 10)}`;
const fmt = (v: unknown, digits = 1) => (typeof v === "number" ? v.toLocaleString("en-US", { maximumFractionDigits: digits }) : "-");

/** 선 끝 라벨 — 마지막 값 위치 오른쪽에 이름·값을 붙이고, 겹치면 위아래로 벌려 가는 선으로 잇는다 (10/8 사용자 요청) */
type EndItem = { key: string; text: string; color: string };
function EndLabels({ data, items, gap = 15 }: { data: Record<string, unknown>[]; items: EndItem[]; gap?: number }) {
  const xs = useXAxisScale(), ys = useYAxisScale(), area = usePlotArea();
  if (!xs || !ys || !area) return null;
  const pts = items.flatMap((it) => {
    for (let i = data.length - 1; i >= 0; i--) {
      const v = data[i][it.key];
      if (typeof v !== "number") continue;
      const x = xs(data[i].date), y = ys(v);
      return typeof x === "number" && typeof y === "number" ? [{ ...it, x, y, ly: y }] : [];
    }
    return [];
  }).sort((a, b) => a.y - b.y);
  // 오른쪽 끝까지 온 선만 오른쪽 여백에 모아 겹침을 풀고, 중간에 끝난 선(진행 중인 '지금')은 끝점 바로 옆에 붙인다
  const right = area.x + area.width;
  const edge = pts.filter((p) => p.x >= right - 12), inline = pts.filter((p) => p.x < right - 12);
  const top = area.y + 6, bottom = area.y + area.height - 4;
  for (let i = 0; i < edge.length; i++) edge[i].ly = Math.max(edge[i].y, i ? edge[i - 1].ly + gap : top);
  const over = edge.length ? edge[edge.length - 1].ly - bottom : 0;
  if (over > 0) for (let i = edge.length - 1; i >= 0; i--) edge[i].ly = Math.min(edge[i].ly - over, i < edge.length - 1 ? edge[i + 1].ly - gap : Infinity);
  const lx = right + 8;
  return (
    <g pointerEvents="none">
      {edge.map((p) => (
        <g key={p.key}>
          <circle cx={p.x} cy={p.y} r={3.5} fill={p.color} stroke="#fff" strokeWidth={1} />
          <polyline points={`${p.x + 4},${p.y} ${lx - 2},${p.ly}`} fill="none" stroke={p.color} strokeOpacity={0.6} strokeWidth={1} />
          <text x={lx} y={p.ly} dy="0.35em" fill={p.color} fontSize={11} fontWeight={700}>{p.text}</text>
        </g>
      ))}
      {inline.map((p) => (
        <g key={p.key}>
          <circle cx={p.x} cy={p.y} r={4.5} fill={p.color} stroke="#fff" strokeWidth={1.5} />
          <text x={p.x + 9} y={p.y} dy="0.35em" fill={p.color} fontSize={12} fontWeight={800} stroke="#0d1630" strokeWidth={3} paintOrder="stroke">{p.text}</text>
        </g>
      ))}
    </g>
  );
}
const fgNow = (data: Record<string, unknown>[], key: string, digits = 0) => {
  const v = [...data].reverse().find((r) => typeof r[key] === "number")?.[key];
  return typeof v === "number" ? v.toFixed(digits) : "";
};
const signed = (v: number | null | undefined) => (typeof v === "number" ? `${v > 0 ? "+" : ""}${v.toFixed(1)}%` : "");

/**
 * 📊 주요 지표 — 지수 흐름(첫날 = 100) · 공포·탐욕 · 변동성지수를 세로로 쌓는다 (10/5).
 * 세 그래프가 같은 데이터(날짜 합집합)·같은 여백·같은 축 폭을 써서 같은 날짜가 같은 세로선에 오고, 커서도 함께 움직인다(syncId).
 */
export function MarketPanel({ data, lines, bands, calm, fear, fgColor }: {
  data: Record<string, unknown>[]; lines: { key: string; label: string; color: string; ret?: number | null }[];
  bands: { extreme_fear: number; fear: number; greed: number; extreme_greed: number }; calm: number; fear: number; fgColor: string;
}) {
  const sync = "market";
  const m = { top: 8, right: 112, bottom: 0, left: 0 }; // 오른쪽 = 선 끝 라벨 자리 (세 그래프 같은 폭)
  const W = 52;
  const head = (t: string, sub: string) => <p className="text-sm font-bold whitespace-nowrap pt-2">{t} <span className="text-xs font-normal text-sub">{sub}</span></p>;
  return (
    <div>
      {head("🌏 지수 흐름", "기간 첫날 = 100 → 110이면 +10% · 선 색 = 아래 지수")}
      <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs">
        {lines.map((l) => (
          <span key={l.key} className="inline-flex items-center gap-1.5 whitespace-nowrap font-semibold" style={{ color: l.color }}>
            <span className="inline-block h-[3px] w-5 rounded" style={{ background: l.color }} />{l.label}{typeof l.ret === "number" ? ` ${signed(l.ret)}` : ""}
          </span>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} syncId={sync} margin={m}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={tick} tickFormatter={md} minTickGap={40} />
          <YAxis tick={tick} domain={["auto", "auto"]} width={W} />
          <ReferenceLine y={100} stroke={SUB} strokeDasharray="4 4" />
          <Tooltip {...tip} formatter={(v, n) => [`${fmt(v)} (${typeof v === "number" ? `${v >= 100 ? "+" : ""}${(v - 100).toFixed(1)}%` : "-"})`, n]} />
          {lines.map((l) => <Line key={l.key} type="monotone" dataKey={l.key} name={l.label} stroke={l.color} dot={false} strokeWidth={2} connectNulls />)}
          <EndLabels data={data} items={lines.map((l) => ({ key: l.key, color: l.color, text: `${l.label} ${signed(l.ret)}` }))} />
        </LineChart>
      </ResponsiveContainer>
      {head("😱 공포·탐욕 지수", "0 극단적 공포 · 50 중립 · 100 극단적 탐욕")}
      <ResponsiveContainer width="100%" height={170}>
        <AreaChart data={data} syncId={sync} margin={m}>
          <defs><linearGradient id="fgFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={fgColor} stopOpacity={0.45} /><stop offset="100%" stopColor={fgColor} stopOpacity={0.02} /></linearGradient></defs>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={tick} tickFormatter={md} minTickGap={40} />
          <YAxis tick={tick} width={W} domain={[0, 100]} ticks={[0, bands.extreme_fear, 50, bands.extreme_greed, 100]} />
          <ReferenceArea y1={0} y2={bands.extreme_fear} fill={COOL} fillOpacity={0.12} />
          <ReferenceArea y1={bands.extreme_greed} y2={100} fill={HOT} fillOpacity={0.12} />
          <ReferenceLine y={50} stroke={SUB} strokeDasharray="4 4" />
          <Tooltip {...tip} formatter={(v, _n, p) => [`${fmt(v)} · ${(p?.payload as { fg_rating?: string })?.fg_rating ?? ""}`, "공포·탐욕"]} />
          <Area type="monotone" dataKey="fg" name="공포·탐욕" stroke={fgColor} fill="url(#fgFill)" strokeWidth={2} connectNulls />
          <EndLabels data={data} items={[{ key: "fg", color: fgColor, text: `공포·탐욕 ${fgNow(data, "fg")}` }]} />
        </AreaChart>
      </ResponsiveContainer>
      {head("🌪️ 변동성지수(VIX)", `${calm} 아래 안정 · ${fear} 위 공포`)}
      <ResponsiveContainer width="100%" height={170}>
        <AreaChart data={data} syncId={sync} margin={m}>
          <defs><linearGradient id="vixFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={HOT} stopOpacity={0.45} /><stop offset="100%" stopColor={HOT} stopOpacity={0.02} /></linearGradient></defs>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={tick} tickFormatter={md} minTickGap={40} />
          <YAxis tick={tick} width={W} domain={[0, "auto"]} />
          <ReferenceLine y={calm} stroke={GOOD} strokeDasharray="4 4" label={{ value: `${calm} 안정`, fill: GOOD, fontSize: 11, position: "insideBottomRight" }} />
          <ReferenceLine y={fear} stroke={HOT} strokeDasharray="4 4" label={{ value: `${fear} 공포`, fill: HOT, fontSize: 11, position: "insideTopRight" }} />
          <Tooltip {...tip} formatter={(v) => [fmt(v, 2), "변동성지수"]} />
          <Area type="monotone" dataKey="vix" name="변동성지수" stroke={HOT} fill="url(#vixFill)" strokeWidth={2} connectNulls />
          <EndLabels data={data} items={[{ key: "vix", color: HOT, text: `VIX ${fgNow(data, "vix", 1)}` }]} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** 섹터 12개월 — 이번 주 구간 표시 */
export function SectorChart({ data, week, up }: { data: { date: string; close: number }[]; week: { start: string; end: string } | null; up: boolean }) {
  const c = up ? HOT : COOL;
  const s = week ? data.find((p) => p.date === week.start) : undefined, e = week ? data.find((p) => p.date === week.end) : undefined;
  return (
    <ResponsiveContainer width="100%" height={150}>
      <AreaChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
        <defs><linearGradient id={`sec${up ? "u" : "d"}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={c} stopOpacity={0.35} /><stop offset="100%" stopColor={c} stopOpacity={0.02} /></linearGradient></defs>
        <XAxis dataKey="date" tick={{ ...tick, fontSize: 10 }} tickFormatter={md} minTickGap={50} />
        <YAxis tick={{ ...tick, fontSize: 10 }} width={46} domain={["auto", "auto"]} tickFormatter={(v) => fmt(v, 0)} />
        <Tooltip {...tip} formatter={(v) => [fmt(v, 2), "종가"]} />
        {week && <ReferenceArea x1={week.start} x2={week.end} fill={GOLD} fillOpacity={0.18} />}
        <Area type="monotone" dataKey="close" stroke={c} fill={`url(#sec${up ? "u" : "d"})`} strokeWidth={1.8} />
        {s && <ReferenceDot x={s.date} y={s.close} r={4} fill={ARC} stroke="#fff" label={{ value: "시작", fill: ARC, fontSize: 10, position: "top" }} />}
        {e && <ReferenceDot x={e.date} y={e.close} r={4} fill={GOLD} stroke="#fff" label={{ value: "끝", fill: GOLD, fontSize: 10, position: "top" }} />}
      </AreaChart>
    </ResponsiveContainer>
  );
}

type IP = { date: string; close: number; macd: number; signal: number; hist: number; rsi: number | null; op_yoy: number | null };

/** 🚦 종목 — 주가(+분기 영업이익 증가율 금색) · MACD · RSI 를 세로로 쌓고 같은 날짜 커서로 맞춘다 */
export function StockChart({ id, data, opLabel, overbought, oversold, currency }: { id: string; data: IP[]; opLabel: string; overbought: number; oversold: number; currency: "KRW" | "USD" }) {
  const sync = `stk-${id}`;
  const m = { top: 6, right: 8, bottom: 0, left: 0 };
  const price = (v: unknown) => (typeof v === "number" ? (currency === "KRW" ? `${Math.round(v).toLocaleString("en-US")}원` : `$${v.toFixed(2)}`) : "-");
  return (
    <div className="space-y-1">
      <p className="text-xs text-sub whitespace-nowrap">📈 주가 <span className="text-gold">● {opLabel}(전년 대비, 오른쪽 축)</span></p>
      <ResponsiveContainer width="100%" height={210}>
        <ComposedChart data={data} syncId={sync} margin={m}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={tick} tickFormatter={md} minTickGap={50} />
          <YAxis yAxisId="p" tick={tick} width={58} domain={["auto", "auto"]} tickFormatter={(v) => fmt(v, 0)} />
          <YAxis yAxisId="q" orientation="right" tick={{ ...tick, fill: GOLD }} width={46} tickFormatter={(v) => `${v}%`} />
          <Tooltip {...tip} labelFormatter={(l) => String(l)} formatter={(v, n) => (n === opLabel ? [`${fmt(v)}%`, n] : [price(v), n])} />
          <Line yAxisId="p" type="monotone" dataKey="close" name="주가" stroke={ARC} dot={false} strokeWidth={1.8} />
          <Line yAxisId="q" type="linear" dataKey="op_yoy" name={opLabel} stroke={GOLD} strokeWidth={2} connectNulls dot={{ r: 4, fill: GOLD, stroke: "#fff" }} />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-xs text-sub whitespace-nowrap">📊 MACD(추세 지표) <span className="text-arc">— MACD</span> <span className="text-gold">— 시그널</span> · 막대 = 차이</p>
      <ResponsiveContainer width="100%" height={130}>
        <ComposedChart data={data} syncId={sync} margin={m}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={tick} tickFormatter={md} minTickGap={50} />
          <YAxis tick={tick} width={58} tickFormatter={(v) => fmt(v, 1)} />
          <YAxis yAxisId="r" orientation="right" width={46} tick={false} />
          <Tooltip {...tip} formatter={(v, n) => [fmt(v, 2), n]} />
          <ReferenceLine y={0} stroke={SUB} />
          <Bar dataKey="hist" name="차이" isAnimationActive={false}>
            {data.map((p, i) => <Cell key={i} fill={p.hist >= 0 ? HOT : COOL} fillOpacity={0.6} />)}
          </Bar>
          <Line type="monotone" dataKey="macd" name="MACD" stroke={ARC} dot={false} strokeWidth={1.5} />
          <Line type="monotone" dataKey="signal" name="시그널" stroke={GOLD} dot={false} strokeWidth={1.5} />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-xs text-sub whitespace-nowrap">🌡️ RSI(과열 지표) <span className="text-hot">{overbought} 이상 과열</span> · <span className="text-cool">{oversold} 이하 침체</span></p>
      <ResponsiveContainer width="100%" height={110}>
        <LineChart data={data} syncId={sync} margin={m}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={tick} tickFormatter={mdd} minTickGap={50} />
          <YAxis tick={tick} width={58} domain={[0, 100]} ticks={[oversold, 50, overbought]} />
          <YAxis yAxisId="r" orientation="right" width={46} tick={false} />
          <ReferenceArea y1={overbought} y2={100} fill={HOT} fillOpacity={0.1} />
          <ReferenceArea y1={0} y2={oversold} fill={COOL} fillOpacity={0.1} />
          <Tooltip {...tip} formatter={(v) => [fmt(v), "RSI"]} />
          <Line type="monotone" dataKey="rsi" name="RSI" stroke={GOOD} dot={false} strokeWidth={1.5} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** 📅 과거 사례 — 시작일 = 100, x = 경과 거래일. 지금(current)은 금색 굵은 선 (D63) */
export function PathChart({ data, lines, days }: { data: Record<string, unknown>[]; lines: { key: string; label: string; color: string; current: boolean; last: number | null }[]; days: number }) {
  const ticks = [0, 20, 40, 60, 80, 100, 120, 150, 200, 250].filter((t) => t <= days).map(String);
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 8, right: 96, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
        <XAxis dataKey="date" tick={tick} ticks={ticks} interval={0} tickFormatter={(v) => `${v}일`} />
        <YAxis tick={tick} width={44} domain={["auto", "auto"]} />
        <ReferenceLine y={100} stroke={SUB} strokeDasharray="4 4" />
        <Tooltip {...tip} labelFormatter={(l) => `${l}거래일째`} formatter={(v, n) => [`${fmt(v)} (${typeof v === "number" ? `${v >= 100 ? "+" : ""}${(v - 100).toFixed(1)}%` : "-"})`, n]} />
        {lines.map((l) => <Line key={l.key} type="monotone" dataKey={l.key} name={l.label} stroke={l.color} dot={false} strokeWidth={l.current ? 3 : 1.6} strokeOpacity={l.current ? 1 : 0.85} connectNulls={false} isAnimationActive={false} />)}
        <EndLabels data={data} items={lines.map((l) => ({ key: l.key, color: l.color, text: `${l.label} ${signed(l.last === null ? null : l.last - 100)}` }))} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/**
 * 🎯 지금 사기 좋은 종목 — 최근 12개월 주가 + 5·20일선 · MACD · RSI 를 한 상자에 세로로 쌓고 같은 날짜 커서로 맞춘다 (10/8 사용자 요청).
 * rec = 첫 추천일·기준가 → 세로선과 점으로 표시.
 */
type PP = { date: string; close: number; ma_fast: number | null; ma_slow: number | null; macd: number; signal: number; hist: number; rsi: number | null };
const MA_SLOW = "#f472b6";
export function PickChart({ id, data, ma, overbought, oversold, currency, rec }: {
  id: string; data: PP[]; ma: [number, number]; overbought: number; oversold: number; currency: "KRW" | "USD"; rec: { date: string; price: number } | null;
}) {
  const sync = `pick-${id}`;
  const m = { top: 8, right: 8, bottom: 0, left: 0 };
  const W = 62;
  const price = (v: unknown) => (typeof v === "number" ? (currency === "KRW" ? `${Math.round(v).toLocaleString("en-US")}원` : `$${v.toFixed(2)}`) : "-");
  const recX = rec ? data.find((p) => p.date >= rec.date)?.date : undefined;
  const fast = `${ma[0]}일선`, slow = `${ma[1]}일선`;
  const key = (c: string, t: string) => <span className="inline-flex items-center gap-1 whitespace-nowrap" style={{ color: c }}><span className="inline-block h-[3px] w-4 rounded" style={{ background: c }} />{t}</span>;
  return (
    <div className="rounded-lg border border-line/70 bg-panel2/40 p-2 space-y-1">
      <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs font-semibold">📈 {key(ARC, "주가")}{key(GOLD, fast)}{key(MA_SLOW, slow)}{recX && <span className="text-good whitespace-nowrap">┊ 🎯 첫 추천</span>}</p>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data} syncId={sync} margin={m}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={tick} tickFormatter={md} minTickGap={40} />
          <YAxis tick={tick} width={W} domain={["auto", "auto"]} tickFormatter={(v) => fmt(v, 0)} />
          <Tooltip {...tip} formatter={(v, n) => [price(v), n]} />
          {recX && <ReferenceLine x={recX} stroke={GOOD} strokeDasharray="4 3" />}
          <Line type="monotone" dataKey="close" name="주가" stroke={ARC} dot={false} strokeWidth={1.8} isAnimationActive={false} />
          <Line type="monotone" dataKey="ma_fast" name={fast} stroke={GOLD} dot={false} strokeWidth={1.2} isAnimationActive={false} connectNulls />
          <Line type="monotone" dataKey="ma_slow" name={slow} stroke={MA_SLOW} dot={false} strokeWidth={1.2} isAnimationActive={false} connectNulls />
          {recX && rec && <ReferenceDot x={recX} y={rec.price} r={5} fill={GOOD} stroke="#fff" label={{ value: "추천", fill: GOOD, fontSize: 11, position: "top" }} />}
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-xs font-semibold whitespace-nowrap">📊 MACD(추세) <span className="text-arc">— MACD</span> <span className="text-gold">— 시그널</span> <span className="text-sub">· 막대 = 차이(빨강 상승 · 파랑 하락)</span></p>
      <ResponsiveContainer width="100%" height={110}>
        <ComposedChart data={data} syncId={sync} margin={m}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={tick} tickFormatter={md} minTickGap={40} />
          <YAxis tick={tick} width={W} tickFormatter={(v) => fmt(v, 1)} />
          <Tooltip {...tip} formatter={(v, n) => [fmt(v, 2), n]} />
          <ReferenceLine y={0} stroke={SUB} />
          {recX && <ReferenceLine x={recX} stroke={GOOD} strokeDasharray="4 3" />}
          <Bar dataKey="hist" name="차이" isAnimationActive={false}>
            {data.map((p, i) => <Cell key={i} fill={p.hist >= 0 ? HOT : COOL} fillOpacity={0.6} />)}
          </Bar>
          <Line type="monotone" dataKey="macd" name="MACD" stroke={ARC} dot={false} strokeWidth={1.4} isAnimationActive={false} />
          <Line type="monotone" dataKey="signal" name="시그널" stroke={GOLD} dot={false} strokeWidth={1.4} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-xs font-semibold whitespace-nowrap">🌡️ <span style={{ color: "#c084fc" }}>RSI(과열)</span> <span className="text-hot">{overbought} 이상 과열</span> · <span className="text-cool">{oversold} 이하 침체</span></p>
      <ResponsiveContainer width="100%" height={100}>
        <LineChart data={data} syncId={sync} margin={m}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={tick} tickFormatter={md} minTickGap={40} />
          <YAxis tick={tick} width={W} domain={[0, 100]} ticks={[oversold, 50, overbought]} />
          <ReferenceArea y1={overbought} y2={100} fill={HOT} fillOpacity={0.1} />
          <ReferenceArea y1={0} y2={oversold} fill={COOL} fillOpacity={0.1} />
          {recX && <ReferenceLine x={recX} stroke={GOOD} strokeDasharray="4 3" />}
          <Tooltip {...tip} formatter={(v) => [fmt(v), "RSI"]} />
          <Line type="monotone" dataKey="rsi" name="RSI" stroke="#c084fc" dot={false} strokeWidth={1.4} connectNulls isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
