import { describe, expect, it } from "vitest";
import { dashboardButtons, fillTemplate, rows } from "./links";
import { linksConfig } from "./config/load";

describe("links", () => {
  it("fillTemplate substitutes {x} and ${X}, null when any value missing", () => {
    expect(fillTemplate("${JARVIS_URL}/stock/{entity_id}", { JARVIS_URL: "https://j.app", entity_id: "KR:000660" })).toBe("https://j.app/stock/KR:000660");
    expect(fillTemplate("${JARVIS_URL}/", { JARVIS_URL: null })).toBeNull();
    expect(fillTemplate("https://h/{code}", { code: "" })).toBeNull();
    expect(fillTemplate("{x}", { x: "not-a-url" })).toBeNull();
    expect(fillTemplate("https://a.b//c", {})).toBe("https://a.b/c");
  });

  it("dashboard buttons follow links.yaml and omit JARVIS without JARVIS_URL", () => {
    const cfg = linksConfig().dashboards;
    const without = dashboardButtons(cfg, undefined);
    expect(without.map((b) => b.text)).not.toContain(cfg.jarvis.label);
    expect(without).toHaveLength(Object.keys(cfg).length - 1);
    const withUrl = dashboardButtons(cfg, "https://jarvis.example.app/");
    expect(withUrl[0]).toEqual({ text: cfg.jarvis.label, url: "https://jarvis.example.app/" });
    expect(withUrl).toHaveLength(6);
  });

  it("rows chunks by 3", () => {
    expect(rows([1, 2, 3, 4, 5, 6, 7])).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    expect(rows([1, 2], 1)).toEqual([[1], [2]]);
  });
});
