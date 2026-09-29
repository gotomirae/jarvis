/**
 * pg_cron → Vercel 정시 호출 (0005 jarvis.call_route). 가벼운 잡만: 30분 폴링(보유 경고) · 아침/저녁 브리핑.
 * Authorization: Bearer <CRON_SECRET> 확인. 무거운 수집은 GitHub Actions(scripts/run.ts)가 한다.
 */
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { runJob } from "@/lib/jobs";
import { sendBrief } from "@/lib/jobs/brief";
import { poll } from "@/lib/jobs/poll";
import { safeEqual } from "@/lib/telegram/format";
import { kstDate } from "@/lib/time";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const JOBS: Record<string, (now: Date) => Promise<Record<string, unknown> | null>> = {
  poll: (now) => runJob("poll", `${now.toISOString().slice(0, 15)}0`, () => poll(now)),        // 10분 단위 슬롯
  brief_morning: (now) => runJob("brief_morning", kstDate(now), () => sendBrief("morning", now)),
  brief_evening: (now) => runJob("brief_evening", kstDate(now), () => sendBrief("evening", now)),
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ job: string }> }) {
  const secret = env().CRON_SECRET;
  const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!secret || !safeEqual(auth, secret)) return NextResponse.json({ ok: false }, { status: 401 });
  const { job } = await params;
  const fn = JOBS[job];
  if (!fn) return NextResponse.json({ ok: false, error: "unknown job" }, { status: 404 });
  try {
    const out = await fn(new Date());
    return NextResponse.json({ ok: true, job, out: out ?? "skipped (slot done)" });
  } catch (e) {
    return NextResponse.json({ ok: false, job, error: e instanceof Error ? e.message.slice(0, 300) : String(e) }, { status: 500 });
  }
}
