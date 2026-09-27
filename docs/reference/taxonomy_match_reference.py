"""JARVIS 산업 매핑 참조 구현 (PRD §4.1.3).

TypeScript 구현(lib/taxonomy/match.ts)은 이 파일과 **같은 결과**를 내야 한다.
테스트 기준 스냅샷: config/taxonomy_expected.json (이 스크립트로 생성).
실행: python docs/reference/taxonomy_match_reference.py > config/taxonomy_expected.json
"""
import json, re, sys
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[2]
T = yaml.safe_load((ROOT / "config/taxonomy.yaml").read_text(encoding="utf-8"))
M = T["matching"]
STRIP = "".join(re.escape(c) for c in M["normalize_strip"])

def norm(s: str) -> str:
    return re.sub(f"[{STRIP}]+", "", s).lower()

STOP = {norm(x) for x in M["stop_substrings"]}

def lcs(a: str, b: str) -> str:
    best = ""
    for i in range(len(a)):
        for j in range(i + M["partial_min_len"], len(a) + 1):
            sub = a[i:j]
            if sub in b and len(sub) > len(best):
                best = sub
    return best

def match(label: str, project: str = "*"):
    n = norm(label)
    for o in T.get("overrides", []):
        if o["project"] in ("*", project) and norm(o["label"]) == n:
            return [{"l1": c, "type": "override", "kw": o["label"]} for c in o["l1"]]
    for sp in T["special_labels"]:
        if any(norm(a) == n for a in sp["aliases"]):
            return [{"l1": sp["code"], "type": "special", "kw": label}]
    hits = []
    for row in T["l1"]:
        primary = [row["name"], *row["name"].split("_"), *row["l2"]]
        found = None
        for k in primary + row["synonyms"]:
            kn = norm(k)
            if len(kn) >= M["min_keyword_len"] and (kn in n or n in kn):
                found = {"l1": row["code"], "type": "contains", "kw": k}
                break
        if not found:
            for k in primary:
                c = lcs(n, norm(k))
                if len(c) >= M["partial_min_len"] and c not in STOP:
                    found = {"l1": row["code"], "type": "partial", "kw": k, "common": c}
                    break
        if found:
            hits.append(found)
    return hits or [{"l1": T.get("unmatched_default", "ETC"), "type": "unmatched", "kw": None}]

PROJECTS = {
    "hermescall": ["AI인프라반도체","Beauty미용기기","라면","로봇휴머노이드","바이오제약","방산","배터리","양자컴퓨터","우주항공","의료기기","인바운드","전력인프라","조선"],
    "sage": ["반도체","자동차·로봇","거시경제","플랫폼","바이오","전력·에너지","뷰티","부동산","기타"],
    "snowball": ["반도체 IDM","AI 팹리스","반도체 장비","반도체 소재","반도체 부품","전자 부품","광 네트워크","양자","전력 인프라","2차전지","로봇","자동차","전기차","조선","방산","우주","바이오","의료기기","화장품","음식류","엔터","소프트웨어","플랫폼","금융","에너지","소재","유통","기타"],
    "heimdallr_kairos": ["AI","AI 반도체","반도체","전력인프라","바이오","화장품","미용기기","엔터","우주항공방산","조선","2차전지","로봇","IT","헬스케어","소비재","양자컴퓨터","네트워크","ETF","OLED","자율주행차","음식료","의류","건설"],
    "heimdallr_sector": ["원전","방산·우주","2차전지","반도체 장비","반도체 소재","반도체 부품","반도체 DSP","반도체 OSAT","반도체 IDM","전자부품","디스플레이","전력인프라","신재생에너지","조선·해운","자동차","바이오·제약","의료기기","엔터·미디어","게임","인터넷·플랫폼","소프트웨어·IT","통신·네트워크","건설","건자재","철강·금속","화학·소재","기계·로봇","식음료","유통·소비재","운송·물류","금융","부동산·리츠","지주·기타서비스"],
    "flywheel": ["AI","조선","바이오","반도체","양자컴퓨터","음식료","인바운드","의료기기","IT","Robot","배터리","방산","엔터","미용기기","우주항공","화장품","전력인프라"],
    # 오탐 회귀 사례 — 반드시 아래 결과여야 한다
    "_false_positive_guard": ["인바운드","의료기기","미용기기","AI인프라반도체"],
}

if __name__ == "__main__":
    out = {p: {l: match(l, p) for l in labels} for p, labels in PROJECTS.items()}
    json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
