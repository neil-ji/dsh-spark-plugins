import { defineConfig } from 'vitest/config'

/**
 * 包内测试配置（与 dsh-finance-client 同形）：组件级断言要 SSR 真渲染一次，
 * 所以必须走自动 JSX 运行时（仓库根的 vitest 配置按 classic 转译，只服务于纯逻辑 spec）。
 */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    css: false,
  },
})
