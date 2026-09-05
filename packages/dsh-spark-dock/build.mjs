/**
 * dsh-spark-dock build — 与 dsh-spark-ui 同构：
 *  - tsc 发声明到 lib/types
 *  - esbuild 发 node 半边 lib/index.js（空 loader 入口）
 *  - esbuild 发浏览器半边 lib/client.js，包成 window.__ModuleLoader__.load
 */
import { build } from 'esbuild'
import { execSync } from 'node:child_process'
import { rmSync, writeFileSync, renameSync } from 'node:fs'

const PACKAGE_NAME = 'dsh-spark-dock'

const atomicWrite = (file, contents) => {
  const tmp = file + '.tmp-' + process.pid
  writeFileSync(tmp, contents)
  renameSync(tmp, file)
}

rmSync('lib', { recursive: true, force: true })
execSync('npx --no-install tsc -p tsconfig.json', { stdio: 'inherit' })

const loaderWrapper = (id) => ({
  banner: 'window.__ModuleLoader__.load({\n' +
    '\tid: ' + JSON.stringify(id) + ',\n' +
    '\tfactory: (require) => {\n' +
    '\t\tvar module = { exports: {} };\n' +
    '\t\tvar exports = module.exports;\n' +
    '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
  footer: '\n\t\treturn module.exports;\n\t}\n});\n',
})

const buildAtomic = async (options) => {
  const result = await build({ ...options, write: false })
  for (const file of result.outputFiles) atomicWrite(file.path, file.contents)
  return result
}

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
  ],
  banner: { js: wrapper.banner },
  footer: { js: wrapper.footer },
  logLevel: 'info',
})
