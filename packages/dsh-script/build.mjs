/**
 * dsh-script host build: tsc emits declarations, esbuild bundles the host entry.
 * dsh-spark-wire is inlined; @deepseek-ai/* + zod stay bare imports for the host runtime.
 */
import { build } from 'esbuild'
import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'

rmSync('lib', { recursive: true, force: true })
execSync('npx --no-install tsc -p tsconfig.json', { stdio: 'inherit' })

await build({
  // 两个入口：主插件 + 检索词富化（Spec §5.5 的子路径插件入口，与 hippomemo 的 ./terms 同形）。
  entryPoints: { 'index': 'src/index.ts', 'terms': 'src/terms.ts' },
  outdir: 'lib',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  external: ['@deepseek-ai/*', 'zod'],
  logLevel: 'info',
})
