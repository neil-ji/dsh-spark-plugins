/**
 * dsh-spark-wire build: tsc emits declarations, esbuild bundles the wire entry.
 * The package has no Node-only deps (only zod + Typert types) so both host and
 * client bundles can import it. External: @deepseek-ai/* + zod (peer supply).
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
