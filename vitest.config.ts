import { defineConfig } from "vitest/config";

/* 独立于 vite.config.ts：测试只覆盖纯逻辑（匹配引擎、撤销栈、存档），
   不需要 React 插件，也就避开了 vitest 自带 vite 副本与项目 vite 的类型冲突。 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
