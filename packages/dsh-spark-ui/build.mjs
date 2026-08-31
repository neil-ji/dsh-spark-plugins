/**
 * dsh-spark-ui build:
 *  - tsc emits declarations to lib/types
 *  - esbuild emits the node half as lib/index.js (empty loader entry)
 *  - esbuild emits the browser half as lib/client.js wrapped in the vendored
 *    window.__ModuleLoader__.load factory format, inlining dsh-spark-wire +
 *    zod, externalizing shell-provided modules.
 */
import { build } from 'esbuild'
import { execSync } from 'node:child_process'
import { rmSync, writeFileSync, renameSync } from 'node:fs'

const PACKAGE_NAME = 'dsh-spark-ui'

/** 原子写：先生成临时文件再 rename，读方永远看到完整的旧或新文件。 */
const atomicWrite = (file, contents) => {
  const tmp = file + '.tmp-' + process.pid
  writeFileSync(tmp, contents)
  renameSync(tmp, file)
}

rmSync('lib', { recursive: true, force: true })
execSync('npx --no-install tsc -p tsconfig.json', { stdio: 'inherit' })

/** Wrap a CJS bundle in the vendored window.__ModuleLoader__.load handoff. */
const loaderWrapper = (id) => ({
  banner: 'window.__ModuleLoader__.load({\n' +
    '\tid: ' + JSON.stringify(id) + ',\n' +
    '\tfactory: (require) => {\n' +
    '\t\tvar module = { exports: {} };\n' +
    '\t\tvar exports = module.exports;\n' +
    '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
  footer: '\n\t\treturn module.exports;\n\t}\n});\n',
})

/** Build and atomically write all outputs (write:false so this script controls write timing). */
const buildAtomic = async (options) => {
  const result = await build({ ...options, write: false })
  for (const file of result.outputFiles) atomicWrite(file.path, file.contents)
  return result
}

// node half: empty loader entry
await buildAtomic({
  entryPoints: { 'index': 'src/index.ts' },
  outdir: 'lib',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  external: ['@deepseek-ai/*'],
  logLevel: 'info',
})

// browser half
const wrapper = loaderWrapper(PACKAGE_NAME)
await buildAtomic({
  entryPoints: { 'client': 'src/client/index.ts' },
  outdir: 'lib',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  external: [
    'react',
    'react/jsx-runtime',
    'react-dom',
    '@deepseek-ai/dsh-client-runtime/client',
  ],
  banner: { js: wrapper.banner },
  footer: { js: wrapper.footer },
  logLevel: 'info',
})
