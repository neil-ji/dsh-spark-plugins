/**
 * dsh-spark host build: tsc emits declarations, esbuild bundles the host entry.
 * dsh-spark-wire is inlined; @deepseek-ai/* + zod stay bare imports for the host runtime.
 */
import { build } from 'esbuild'
import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'

rmSync('lib', { recursive: true, force: true })
execSync('npx --no-install tsc -p tsconfig.json', { stdio: 'inherit' })

await build({
  entryPoints: { 'index': 'src/index.ts' },
  outdir: 'lib',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  external: ['@deepseek-ai/*', 'zod'],
  logLevel: 'info',
})
