/**
 * dsh-npm host build: tsc emits declarations, esbuild bundles the host entry.
 * @deepseek-ai/* and dsh-connector-github stay bare imports (runtime reuse).
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
  external: ['@deepseek-ai/*', 'zod', 'dsh-connector-github'],
  logLevel: 'info',
})
