import { defineConfig } from "vitest/config";
import path from "node:path";

// CLAUDE.md 테스트 규칙: lib/taxonomy · lib/engine · lib/links.ts · lib/outcomes · lib/memo/grounding 라인 커버리지 100%.
// 순수 로직 파일만 대상으로 한다(네트워크 어댑터·fs 로더 제외).
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, ".") } },
  test: {
    include: ["lib/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: [
        "lib/engine/**/*.ts", "lib/taxonomy/**/*.ts", "lib/outcomes/**/*.ts", "lib/memo/grounding.ts",
        "lib/links.ts", "lib/entities.ts", "lib/env.ts", "lib/time.ts", "lib/telegram/format.ts", "lib/telegram/commands.ts",
      ],
      exclude: ["**/*.test.ts", "**/index.ts"],
      thresholds: { lines: 100, functions: 100, statements: 100 },
    },
  },
});
