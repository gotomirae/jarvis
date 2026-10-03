/**
 * LLM 단일 경유점 (불변 규칙 5 · PRD §10.4 · §15). **판정에는 쓰지 않는다** — 주간 메모 서술만.
 *  · 월 상한(MONTHLY_LLM_CAP_USD, KST 달 기준 cost_log 합계)을 넘으면 호출하지 않는다
 *  · 모든 호출을 cost_log 에 기록(모델·용도·토큰·달러)
 *  · 구조화 출력(zod 스키마)으로 받아 형식을 강제 — 숫자 검증은 호출부(lib/memo/grounding.ts)
 * 예외를 올리지 않고 Result 로 돌려준다(어댑터와 같은 규약).
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type * as z from "zod/v4";
import { dbInsert, dbSelectAll } from "@/lib/db";
import { env } from "@/lib/env";
import { fail, ok, safeReason, type Result } from "@/lib/ingest/types";
import { rules } from "@/lib/jobs/context";
import { kstDate } from "@/lib/time";

export type LlmOut<T> = { data: T; model: string; usd: number; input_tokens: number; output_tokens: number };

/** 이번 달(KST) LLM 사용액 */
export async function monthSpend(now = new Date()): Promise<number> {
  const since = `${kstDate(now).slice(0, 8)}01T00:00:00%2B09:00`;
  const r = await dbSelectAll<{ usd: number }>("cost_log", `select=usd&at=gte.${since}`);
  return r.ok ? r.data.reduce((a, x) => a + Number(x.usd), 0) : 0;
}

export function costUsd(model: string, inTok: number, outTok: number): number {
  const p = rules().llm.prices_per_mtok[model] ?? { input: 4, output: 20 };   // 모르는 모델은 보수적으로 Opus 가격
  return (inTok * p.input + outTok * p.output) / 1_000_000;
}

export async function llmJson<T>(o: { purpose: string; system: string; user: string; schema: z.ZodType<T>; now?: Date }): Promise<Result<LlmOut<T>>> {
  const e = env();
  if (!e.ANTHROPIC_API_KEY) return fail("ANTHROPIC_API_KEY 미설정");
  const cap = e.MONTHLY_LLM_CAP_USD;
  const spent = await monthSpend(o.now);
  if (spent >= cap) return fail(`이번 달 LLM 상한 초과($${spent.toFixed(2)} ≥ $${cap})`);
  const L = rules().llm;
  const model = e.MEMO_MODEL;
  try {
    const client = new Anthropic({ apiKey: e.ANTHROPIC_API_KEY });
    const res = await client.messages.parse({
      model,
      max_tokens: L.max_tokens,
      system: o.system,
      messages: [{ role: "user", content: o.user }],
      output_config: { effort: L.effort as "low" | "medium" | "high", format: zodOutputFormat(o.schema) },
    });
    const inTok = (res.usage.input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0) + (res.usage.cache_read_input_tokens ?? 0);
    const outTok = res.usage.output_tokens ?? 0;
    const usd = costUsd(model, inTok, outTok);
    await dbInsert("cost_log", [{ provider: "anthropic", model, purpose: o.purpose, input_tokens: inTok, output_tokens: outTok, usd }]);
    if (res.stop_reason === "refusal") return fail("모델이 응답을 거절함(refusal)");
    if (res.stop_reason === "max_tokens") return fail("출력 한도 도달(max_tokens)");
    if (!res.parsed_output) return fail("구조화 출력 파싱 실패");
    return ok({ data: res.parsed_output as T, model, usd, input_tokens: inTok, output_tokens: outTok });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return fail(`LLM 요청 한도(429): ${safeReason(err)}`, 429);
    if (err instanceof Anthropic.AuthenticationError) return fail("LLM 인증 실패(키 확인)", 401);
    if (err instanceof Anthropic.BadRequestError) return fail(`LLM 요청 오류(400): ${safeReason(err)}`, 400);
    if (err instanceof Anthropic.APIError) return fail(`LLM API 오류 ${err.status}: ${safeReason(err)}`, err.status);
    return fail(`LLM 호출 실패: ${safeReason(err)}`);
  }
}
