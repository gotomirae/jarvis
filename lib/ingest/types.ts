/**
 * 어댑터 공통 결과 (CLAUDE.md 불변 규칙 6).
 * 어댑터는 예외를 올리지 않고 {ok:false, reason} 을 반환한다. 누락 컬럼은 호출부가 필드 단위로 방어한다.
 */
export type Ok<T> = { ok: true; data: T; status?: number };
export type Fail = { ok: false; reason: string; status?: number };
export type Result<T> = Ok<T> | Fail;

export const ok = <T>(data: T, status?: number): Ok<T> => ({ ok: true, data, status });
export const fail = (reason: string, status?: number): Fail => ({ ok: false, reason, status });

/** 비밀이 섞일 수 있는 오류 문자열을 짧게 자르고 토큰 모양 문자열을 가린다. */
export function safeReason(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e);
  return s.replace(/[A-Za-z0-9_\-]{32,}(\.[A-Za-z0-9_\-]+){0,2}/g, "<redacted>").slice(0, 300);
}

/** 테이블 읽기 가능 여부 실측 결과 (P0 스모크) */
export type ProbeRow = {
  source: string;
  table: string;
  status: number | null;
  readable: boolean;          // HTTP 200
  rows: number;               // limit=1 결과 행 수 (0 = RLS 로 막혔거나 비어 있음)
  columns: string[];          // 첫 행 컬럼명(값은 저장하지 않음)
  note?: string;
};

export type SourceAdapter = {
  name: string;
  configured: () => boolean;
  probe: () => Promise<ProbeRow[]>;
};
