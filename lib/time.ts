/** KST 표시 헬퍼 (불변 규칙 12: 저장은 timestamptz, 표시는 KST) */
export function kstString(d: Date = new Date()): string {
  const k = new Date(d.getTime() + 9 * 3600_000);
  return k.toISOString().slice(0, 16).replace("T", " ");
}

/** KST 기준 날짜 (YYYY-MM-DD) */
export function kstDate(d: Date = new Date()): string {
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}
