/**
 * dsh-npm-ui build:
 *  - tsc emits declarations to lib/types
 *  - esbuild emits the node half (empty loader entry) as lib/index.js
 *  - esbuild emits the browser half as lib/client.js in the vendored
 *    window.__ModuleLoader__.load factory format, inlining dsh-npm-wire +
 *    zod, externalizing shell-provided modules, and inlining CSS modules
 *    with a letter-prefixed hash (a digit-leading selector is invalid).
 */
import { build } from 'esbuild'
import { execSync } from 'node:child_process'
import { rmSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { relative, resolve } from 'node:path'

const PACKAGE_NAME = 'dsh-connector-npm-ui'

/** 原子写：先生成临时文件再 rename，读方永远看到完整的旧文件或完整的新文件。 */
const atomicWrite = (file, contents) => {
  const tmp = file + '.tmp-' + process.pid
  writeFileSync(tmp, contents)
  renameSync(tmp, file)
}

rmSync('lib', { recursive: true, force: true })
execSync('npx --no-install tsc -p tsconfig.json', { stdio: 'inherit' })

/** Turn *.module.css imports into hashed class-name modules + style injection. */
const cssModulesPlugin = () => ({
  name: 'css-modules',
  setup(build) {
    build.onResolve({ filter: /\.module\.css$/ }, (args) => ({
      path: resolve(args.resolveDir, args.path),
      namespace: 'css-mod',
    }))
    build.onLoad({ filter: /.*/, namespace: 'css-mod' }, (args) => {
      const css = readFileSync(args.path, 'utf8')
      // CSS class names must start with a letter: a hex digest may begin with
      // a digit, which makes the generated selector invalid and the browser
      // silently drops the whole rule.
      const hash = 'x' + createHash('sha1').update(css).digest('hex').slice(0, 6)
      const mapping = {}
      const rewritten = css.replace(/\.([_a-zA-Z][\w-]*)/g, (match, name) => {
        mapping[name] = hash + '_' + name
        return '.' + hash + '_' + name
      })
      const tagId = PACKAGE_NAME + '/' + relative(resolve('.'), args.path).replace(/\\/g, '/')
      const entries = Object.entries(mapping).map(([k, v]) => JSON.stringify(k) + ': ' + JSON.stringify(v)).join(', ')
      const contents = [
        'const css = ' + JSON.stringify(rewritten) + ';',
        'const tagId = ' + JSON.stringify(tagId) + ';',
        'if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {',
        '  const tag = document.createElement("style");',
        '  tag.dataset.plugin = ' + JSON.stringify(PACKAGE_NAME) + ';',
        '  tag.dataset.pluginCss = tagId;',
        '  tag.textContent = css;',
        '  document.head.appendChild(tag);',
        '}',
        'export default { ' + entries + ' };',
      ].join('\n')
      return { contents, loader: 'js' }
    })
  },
})

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

/** 构建并原子落盘全部产物（write:false 由本脚本控制写入时机）。 */
const buildAtomic = async (options) => {
  const result = await build({ ...options, write: false })
  for (const file of result.outputFiles) atomicWrite(file.path, file.contents)
  return result
}

// node half: the loader entry with no host-side behavior
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
  ],
  banner: { js: wrapper.banner },
  footer: { js: wrapper.footer },
  plugins: [cssModulesPlugin()],
  logLevel: 'info',
})
