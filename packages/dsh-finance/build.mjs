/**
 * dsh-spark-finance build: emit declarations with tsc, bundle each entry with
 * esbuild (relative modules inlined, @deepseek-ai/* / zod left as bare
 * imports for the host runtime).
 */
import { build } from 'esbuild'
import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'

rmSync('lib', { recursive: true, force: true })
execSync('npx --no-install tsc -p tsconfig.json', { stdio: 'inherit' })

await build({
  entryPoints: {
    'index': 'src/index.ts',
    'types/types': 'src/types.ts',
    'sync/community-prices': 'src/sync/community-prices.ts',
    'typert.host': 'src/typert.host.ts',
    'typert.remote-client': 'src/typert.remote-client.ts',
  },
  outdir: 'lib',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  external: ['@deepseek-ai/*', 'zod'],
  logLevel: 'info',
})