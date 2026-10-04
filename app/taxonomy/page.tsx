import { Guide, Nav } from "@/app/_components/ui";
import { supabaseServer } from "@/lib/supabase/server";
import { METHOD_NAME, SPECIAL_L1 } from "@/lib/labels";
import { kstString } from "@/lib/time";
import { resolvePending } from "./actions";

export const dynamic = "force-dynamic";

type L1 = { code: string; name: string; l2: string[]; notion_url: string | null; synced_at: string };
type Pending = { id: number; project: string; label: string; suggested_l1: string[]; method: string; first_seen: string };
type Label = { project: string; label: string; l1_codes: string[]; method: string; updated_at: string };
type Diff = { changed?: boolean; added?: { title: string; code: string | null }[]; removed?: { code: string; name: string }[]; title_notes?: { code: string; yaml: string; api_title: string }[]; checked_at?: string; error?: string };

const SPECIAL = ["MACRO", "ETF", "ETC"];

export default async function TaxonomyPage() {
  const sb = await supabaseServer();
  const [l1, pending, labels, diff] = await Promise.all([
    sb.from("taxonomy_l1").select("code,name,l2,notion_url,synced_at").order("code").range(0, 99),
    sb.from("taxonomy_pending").select("id,project,label,suggested_l1,method,first_seen").eq("status", "pending").order("first_seen").range(0, 199),
    sb.from("taxonomy_labels").select("project,label,l1_codes,method,updated_at").order("project").order("label").range(0, 999),
    sb.from("bot_state").select("value,updated_at").eq("key", "taxonomy_notion_diff").maybeSingle(),
  ]);
  const l1Rows = (l1.data ?? []) as L1[];
  const name = (c: string) => l1Rows.find((r) => r.code === c)?.name ?? c;
  const pend = (pending.data ?? []) as Pending[];
  const lab = (labels.data ?? []) as Label[];
  const d = (diff.data?.value ?? null) as Diff | null;
  const now = Date.now();
  const byProject = lab.reduce<Record<string, Label[]>>((m, x) => ((m[x.project] ??= []).push(x), m), {});
  const anyError = l1.error ?? pending.error ?? labels.error;

  return (
    <main className="mx-auto max-w-4xl px-4 py-4 space-y-8">
      <Nav />
      {anyError && <p className="rounded bg-hot/15 p-3 text-sm">DB 읽기 실패: {anyError.message}</p>}

      <section className="space-y-2">
        <h2 className="text-xl font-bold">확인 대기 {pend.length}건</h2>
        <Guide items={["🤔 각 프로젝트의 산업 이름 중 자동 확정 못 한 것", "✅ 맞는 산업 고르고 “확정”", "🔴 7일 넘으면 빨간 테두리"]} />
        {pend.length === 0 && <p className="text-sm text-sub">모든 라벨이 매핑되어 있습니다.</p>}
        {pend.map((p) => {
          const age = Math.floor((now - new Date(p.first_seen).getTime()) / 86400_000);
          return (
            <form key={p.id} action={resolvePending} className={`rounded border p-3 space-y-2 ${age >= 7 ? "border-hot" : "border-line"}`}>
              <input type="hidden" name="id" value={p.id} />
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{p.label}</span>
                <span className="text-xs text-sub">{p.project} · {METHOD_NAME[p.method] ?? p.method} · {age}일째{age >= 7 ? " ⚠️ 7일 넘게 대기" : ""}</span>
              </div>
              <div className="flex flex-wrap gap-2 text-sm">
                {[...l1Rows.map((r) => r.code), ...SPECIAL].map((c) => (
                  <label key={c} className="flex items-center gap-1 rounded border border-line px-2 py-1">
                    <input type="checkbox" name="l1" value={c} defaultChecked={p.suggested_l1.includes(c) && c !== "ETC"} />
                    {SPECIAL.includes(c) ? SPECIAL_L1[c] ?? c : name(c)}
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <button name="action" value="confirm" className="rounded bg-gold text-ink font-semibold px-3 py-1 text-sm">확정</button>
                <button name="action" value="etc" className="rounded border border-line px-3 py-1 text-sm">기타로</button>
              </div>
            </form>
          );
        })}
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-bold">노션 산업 목록 변경 감지</h2>
        {!d ? <p className="text-sm text-sub">아직 taxonomy_sync 결과가 없습니다.</p>
          : d.error ? <p className="text-sm text-hot">노션 읽기 실패: {d.error}</p>
          : (
            <div className="rounded border border-line p-3 text-sm space-y-1">
              <p>{d.changed ? "⚠️ 카테고리 추가·삭제가 있습니다 — taxonomy.yaml 갱신 필요" : "✅ 변경 없음"} <span className="text-sub">· {d.checked_at ? kstString(new Date(d.checked_at)) : ""}</span></p>
              {d.added?.map((a) => <p key={a.title}>➕ {a.title}</p>)}
              {d.removed?.map((r) => <p key={r.code}>➖ {r.code} {r.name}</p>)}
              {!!d.title_notes?.length && <p className="text-xs text-sub">참고: 노션 내부 이름이 화면 제목과 다른 산업 {d.title_notes.length}개 — 같은 페이지라 변경으로 보지 않음</p>}
            </div>
          )}
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-bold">산업 분류 기준 (노션 “2_1. 산업 &amp; 종목” {l1Rows.length}개)</h2>
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-1 text-sm">
          {l1Rows.map((r) => (
            <li key={r.code}>
              <a href={r.notion_url ?? "#"} target="_blank" rel="noreferrer" className="link">{r.name}</a>
              {r.l2.length > 0 && <span className="text-xs text-sub"> · {r.l2.join(", ")}</span>}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">프로젝트별 산업 이름 → 기준 산업</h2>
        {Object.entries(byProject).map(([project, rows]) => (
          <details key={project} className="rounded border border-line p-2">
            <summary className="cursor-pointer text-sm">{project} · {rows.length}개</summary>
            <table className="mt-2 w-full text-sm">
              <tbody>
                {rows.map((x) => (
                  <tr key={x.label} className="border-t border-line/50">
                    <td className="py-1">{x.label}</td>
                    <td className="py-1">{x.l1_codes.map((c) => (SPECIAL.includes(c) ? SPECIAL_L1[c] ?? c : name(c))).join(" + ")}</td>
                    <td className="py-1 text-xs text-sub">{METHOD_NAME[x.method] ?? x.method}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ))}
      </section>
    </main>
  );
}
