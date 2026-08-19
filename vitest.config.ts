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
      if (!/\.(ts|tsx|mts|cts)$/.test(id)) return null
      const result = await esbuild.transform(code, {
        loader: id.endsWith('.tsx') ? 'tsx' : 'ts',
        target: 'node18',
        sourcefile: id,
      })
      return { code: result.code, map: null }
    },
  }],
  test: {
    include: ['packages/*/tests/**/*.spec.ts'],
    environment: 'node',
  },
})
