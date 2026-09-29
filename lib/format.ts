/** 대시보드 공용 숫자 포맷터 (PRD §8 "숫자는 공용 포맷터로 표시") */
export const fmtPct = (x: number | null | undefined, digits = 1) =>
  x === null || x === undefined || !Number.isFinite(x) ? "-" : `${x > 0 ? "+" : ""}${x.toFixed(digits)}%`;
export const fmtNum = (x: number | null | undefined, digits = 0) =>
  x === null || x === undefined || !Number.isFinite(x) ? "-" : x.toLocaleString("ko-KR", { maximumFractionDigits: digits });
/** 소수 비중(0.078) → "7.8%" */
export const fmtWeight = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? "-" : `${(x * 100).toFixed(1)}%`);
export const fmtDate = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "-");
