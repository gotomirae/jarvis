import { redirect } from "next/navigation";

/** 산업 성장 근거는 10/5 산업 레이더 탭으로 통합 — 옛 주소는 그쪽으로 보낸다 */
export default function Growth() {
  redirect("/radar#growth");
}
