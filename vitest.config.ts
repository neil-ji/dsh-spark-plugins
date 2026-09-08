import { createRequire } from 'node:module'
import { defineConfig } from 'vitest/config'

/**
 * vite 8 / rolldown's oxc transform does not lower standard (stage-3)
 * decorators, and Node 24 cannot execute them natively. The connector uses
 * @Remote from @deepseek-ai/dsh-typert-protocol (stage-3 method decorator),
 * so we transform TS with esbuild (supports standard decorators) for tests.
 * esbuild resolves from the workspace root (root devDependency).
 */
const require = createRequire(import.meta.url)
const esbuild = require('esbuild')

export default defineConfig({
  plugins: [{
    name: 'esbuild-ts-transform',
    enforce: 'pre',
    async transform(code, id) {
      // 测试会 import 仓库里的 .mjs 脚本（如 scripts/sync-finance-prices.mjs），
      // 它们带 `#!/usr/bin/env node`。vite 的管线对非 TS 文件不剥 shebang，
      // 直接当 JS 解析会报 "Invalid or unexpected token"，所以这里统一先剥掉。
      const withoutShebang = code.startsWith('#!') ? code.replace(/^#![^\n]*\n/, '\n') : code
      if (!/\.(ts|tsx|mts|cts)$/.test(id)) {
        return withoutShebang === code ? null : { code: withoutShebang, map: null }
      }
      const result = await esbuild.transform(withoutShebang, {
        loader: id.endsWith('.tsx') ? 'tsx' : 'ts',
        target: 'node18',
        sourcefile: id,
      })
      return { code: result.code, map: null }
    },
  }],
  test: {
    include: ['packages/*/tests/**/*.spec.ts', 'scripts/tests/**/*.spec.ts'],
    environment: 'node',
  },
})
