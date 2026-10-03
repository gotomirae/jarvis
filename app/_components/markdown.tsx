import type { ReactNode } from "react";

/** 주간 메모 마크다운 표시 — 제목·표·글머리·인용·문단만(lib/memo/compose.ts 가 만드는 형식). 링크는 텍스트로 둔다 */
export function Markdown({ md }: { md: string }) {
  const out: ReactNode[] = [];
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const k = `l${i}`;
    if (!l.trim()) continue;
    if (l.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        if (!/^\|(\s*-+\s*\|)+$/.test(lines[i].trim())) rows.push(lines[i].split("|").slice(1, -1).map((c) => c.trim()));
        i++;
      }
      i--;
      const [head, ...body] = rows;
      out.push(
        <div key={k} className="overflow-x-auto">
          <table className="w-full text-sm my-1">
            <thead className="text-xs text-neutral-500 text-left"><tr>{head.map((h, j) => <th key={j} className="py-1 pr-3 font-normal">{h}</th>)}</tr></thead>
            <tbody>{body.map((r, j) => <tr key={j} className="border-t border-neutral-100 dark:border-neutral-900">{r.map((c, m) => <td key={m} className="py-1 pr-3 align-top">{c}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    const strip = (s: string) => s.replace(/\*\*/g, "");
    if (l.startsWith("### ")) out.push(<h3 key={k} className="font-semibold mt-3">{strip(l.slice(4))}</h3>);
    else if (l.startsWith("## ")) out.push(<h2 key={k} className="text-lg font-semibold mt-5">{strip(l.slice(3))}</h2>);
    else if (l.startsWith("# ")) out.push(<h1 key={k} className="text-xl font-bold">{strip(l.slice(2))}</h1>);
    else if (l.startsWith("- ")) out.push(<li key={k} className="ml-5 list-disc text-sm">{strip(l.slice(2))}</li>);
    else if (l.startsWith("> ")) out.push(<blockquote key={k} className="border-l-2 border-neutral-300 pl-3 text-sm text-neutral-600 dark:text-neutral-400">{strip(l.slice(2))}</blockquote>);
    else out.push(<p key={k} className={`text-sm ${l.startsWith("**") ? "font-medium mt-2" : ""}`}>{strip(l)}</p>);
  }
  return <div className="space-y-1">{out}</div>;
}
