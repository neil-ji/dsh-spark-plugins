/**
 * dsh-github-wire build: pure ESM bundle consumed by both the host bundle
 * and the browser client bundle. @deepseek-ai/* and zod stay bare imports;
 * the host/client bundlers inline this package as needed.
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
  platform: 'neutral',
  target: 'es2022',
  external: ['@deepseek-ai/*', 'zod'],
  logLevel: 'info',
})
