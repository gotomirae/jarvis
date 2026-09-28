/**
 * 링크 빌더 — config/links.yaml 단일 출처 (PRD §9.4, D14, 불변 규칙 7). 텔레그램·대시보드가 같은 함수를 쓴다.
 * 순수 함수: 설정·JARVIS_URL 을 인자로 받는다. 만들 수 없는 링크(치환값 누락)는 null → 버튼 생략.
 * P0: 대시보드 홈 버튼(/links). 종목 링크 세트·naver_us 해석 어댑터는 P1 에서 추가한다.
 */
export type Button = { text: string; url: string };
export type DashboardsConfig = Record<string, { label: string; url: string }>;

/** {x}·${X} 자리표시자를 치환한다. 하나라도 값이 없거나 비면 null. */
export function fillTemplate(template: string, vars: Record<string, string | null | undefined>): string | null {
  let missing = false;
  const out = template.replace(/\$?\{(\w+)\}/g, (_, k: string) => {
    const v = vars[k];
    if (v === undefined || v === null || v === "") { missing = true; return ""; }
    return v;
  });
  if (missing) return null;
  return /^https?:\/\/[^/\s]+/.test(out) ? out.replace(/([^:])\/\/+/g, "$1/") : null;
}

/** 대시보드 홈 버튼 (links.yaml dashboards 순서). JARVIS_URL 미설정이면 JARVIS 버튼만 생략. */
export function dashboardButtons(cfg: DashboardsConfig, jarvisUrl: string | null | undefined): Button[] {
  const vars = { JARVIS_URL: jarvisUrl ? jarvisUrl.replace(/\/$/, "") : null };
  const out: Button[] = [];
  for (const d of Object.values(cfg)) {
    const url = fillTemplate(d.url, vars);
    if (url) out.push({ text: d.label, url });
  }
  return out;
}

/** 한 행 최대 n개로 나눈다 (텔레그램 인라인 키보드) */
export function rows<T>(items: T[], perRow = 3): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += perRow) out.push(items.slice(i, i + perRow));
  return out;
}
