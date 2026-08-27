/**
 * dsh-ui-kit build pipeline
 *
 * Produces a tree-shakeable ESM module tree: dist/esm/** (one file per source
 * module, imports rewritten to .js/.mjs) plus a thin aggregating dist/index.js:
 *  - Every src/**\/*.module.css is compiled with lightningcss to hashed class
 *    names ([hash]_[local], the same pattern DeepSeek Harness uses) and emitted
 *    as a tiny module that injects its stylesheet once via a <style> tag
 *    (deduped by id). Components keep `import css from './X.module.css'`; the
 *    esbuild plugin below redirects those specifiers to the generated modules,
 *    so the published artifact carries its own styles — no consumer CSS-modules
 *    configuration required.
 *  - The bare `import 'katex/dist/katex.min.css'` in markdown/MarkdownText.tsx
 *    is redirected to a generated module. If the woff2 subset is small enough
 *    the fonts are inlined as data URIs (fully self-contained); otherwise the
 *    physical stylesheet is copied to dist/katex/ and consumers import the
 *    `dsh-ui-kit/katex.css` subpath through their bundler.
 *  - ui-theme token sheets are concatenated in cascade order into
 *    dist/styles/tokens.css (consumers import `dsh-ui-kit/tokens.css` once).
 *  - TypeScript declarations are emitted to dist/types/ and relative
 *    `.ts`/`.tsx` import specifiers rewritten to `.js` so consumers resolve
 *    them against the emitted .d.ts files.
 */

import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, transform as transformJs } from 'esbuild'
import { transform } from 'lightningcss'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = path.join(root, 'src')
const distDir = path.join(root, 'dist')
const cssOutDir = path.join(distDir, 'css')
const katexOutDir = path.join(distDir, 'katex')
const stylesOutDir = path.join(distDir, 'styles')
const typesOutDir = path.join(distDir, 'types')

/** Walk a directory recursively, returning paths relative to `base`. */
function walk(dir, base = dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const abs = path.join(dir, entry)
    if (statSync(abs).isDirectory()) out.push(...walk(abs, base))
    else out.push(path.relative(base, abs))
  }
  return out
}

/** Compile one CSS Modules file and emit its inject module. */
function emitCssModule(relPath) {
  const abs = path.join(srcDir, relPath)
  const { code, exports: cssExports } = transform({
    filename: abs,
    code: readFileSync(abs),
    cssModules: { pattern: '[hash]_[local]' },
    minify: true,
  })
  const classMap = {}
  for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
  // 内容寻址 id：同一份 css 产物（同一 ui-kit dist 版本）hash 相同，跨插件共享
  // 一个 <style> 标签（幂等）；内容不同（不同 ui-kit 版本）时 hash 不同，
  // 各插件注入各自的标签——避免"先 materialize 者赢"导致其他插件丢样式。
  const hash = createHash('sha1').update(code.toString()).digest('hex').slice(0, 8)
  const id = `dsh-ui-kit/${hash}/${relPath}`
  const module = [
    `/* generated from ${relPath} */`,
    `const id = ${JSON.stringify(id)}`,
    `if (typeof document !== 'undefined' && !document.querySelector('style[data-dsh-ui-kit="' + id + '"]')) {`,
    `  const el = document.createElement('style')`,
    `  el.setAttribute('data-dsh-ui-kit', id)`,
    `  el.textContent = ${JSON.stringify(code.toString())}`,
    `  document.head.appendChild(el)`,
    `}`,
    `export default ${JSON.stringify(classMap)}`,
  ].join('\n')
  const outRel = relPath.replace(/\.css$/, '.mjs')
  mkdirSync(path.dirname(path.join(cssOutDir, outRel)), { recursive: true })
  writeFileSync(path.join(cssOutDir, outRel), module)
  return outRel
}

/** Build the KaTeX stylesheet inject module (data-URI fonts) or fall back to a physical copy. */
function emitKatex() {
  const katexCssPath = require.resolve('katex/dist/katex.min.css')
  const fontsDir = path.join(path.dirname(katexCssPath), 'fonts')
  let css = readFileSync(katexCssPath, 'utf8')

  // Only woff2 is inlined; every browser that can render the current UI supports it.
  const woff2 = walk(fontsDir).filter((f) => f.endsWith('.woff2'))
  const totalWoff2 = woff2.reduce((sum, f) => sum + statSync(path.join(fontsDir, f)).size, 0)

  if (totalWoff2 <= 800_000) {
    for (const m of css.matchAll(/url\(([^)]+)\)/g)) {
      const ref = m[1].trim().replace(/^['"]|['"]$/g, '')
      if (!ref.includes('fonts/')) continue
      const fontFile = path.join(fontsDir, path.basename(ref))
      css = css.replace(m[0], `url(data:font/woff2;base64,${readFileSync(fontFile).toString('base64')})`)
    }
    copyFileSync(katexCssPath, path.join(katexOutDir, 'katex.min.css'))
    writeFileSync(
      path.join(katexOutDir, 'katex-inject.mjs'),
      [
        '/* generated KaTeX stylesheet with inlined woff2 fonts */',
        `const id = 'dsh-ui-kit/${createHash('sha1').update(css).digest('hex').slice(0, 8)}/katex'`,
        `if (typeof document !== 'undefined' && !document.querySelector('style[data-dsh-ui-kit="' + id + '"]')) {`,
        `  const el = document.createElement('style')`,
        `  el.setAttribute('data-dsh-ui-kit', id)`,
        `  el.textContent = ${JSON.stringify(css)}`,
        `  document.head.appendChild(el)`,
        `}`,
        'export default {}',
      ].join('\n'),
    )
    console.log(`[build] katex css inlined (woff2 total ${(totalWoff2 / 1024).toFixed(0)}KB)`)
    writeFileSync(path.join(katexOutDir, 'katex.min.css.d.ts'), 'declare const css: string\nexport default css\n')
    return 'katex-inject.mjs'
  }

  // Fallback: ship the physical stylesheet + fonts; consumers import dsh-ui-kit/katex.css.
  copyFileSync(katexCssPath, path.join(katexOutDir, 'katex.min.css'))
  mkdirSync(path.join(katexOutDir, 'fonts'), { recursive: true })
  for (const f of walk(fontsDir)) copyFileSync(path.join(fontsDir, f), path.join(katexOutDir, 'fonts', f))
  writeFileSync(path.join(katexOutDir, 'katex-inject.mjs'), 'export default {}\n')
  writeFileSync(path.join(katexOutDir, 'katex.min.css.d.ts'), 'declare const css: string\nexport default css\n')
  console.log(`[build] katex css copied physically (woff2 total ${(totalWoff2 / 1024).toFixed(0)}KB)`)
  return 'katex-inject.mjs'
}

// ---------------------------------------------------------------- pipeline

mkdirSync(cssOutDir, { recursive: true })
mkdirSync(katexOutDir, { recursive: true })
mkdirSync(stylesOutDir, { recursive: true })

// 1. CSS Modules -> inject modules
const moduleCss = walk(srcDir).filter((f) => f.endsWith('.module.css'))
for (const rel of moduleCss) emitCssModule(rel)
console.log(`[build] compiled ${moduleCss.length} css modules`)

// 2. KaTeX
emitKatex()

// 3. tokens.css aggregate (cascade order: base -> design-platform -> gradients -> scrollbar -> shiki)
const tokenOrder = ['base.css', 'design-platform.css', 'gradient-shadow-text.css', 'scrollbar.css', 'shiki.css']
const tokens = tokenOrder
  .map((f) => {
    const text = readFileSync(path.join(srcDir, 'styles', f), 'utf8')
    return `/* ===== ${f} ===== */\n${text}`
  })
  .join('\n')
writeFileSync(path.join(stylesOutDir, 'tokens.css'), tokens)
writeFileSync(path.join(stylesOutDir, 'tokens.css.d.ts'), 'declare const css: string\nexport default css\n')
console.log(`[build] tokens.css aggregated (${(tokens.length / 1024).toFixed(0)}KB)`)

// 4. JS: one ESM file per source module (tree-shakeable), imports rewritten
//    so consumers resolve .js modules and the generated css/katex injectors.
//    Bare imports (react, shiki, katex, micromark, ...) are left untouched:
//    consumers decide whether to externalize (host-provided react) or bundle.
const esmOutDir = path.join(distDir, 'esm')
const jsFiles = walk(srcDir).filter((f) => /\.(ts|tsx)$/.test(f))
for (const rel of jsFiles) {
  const { code } = await transformJs(readFileSync(path.join(srcDir, rel), 'utf8'), {
    loader: rel.endsWith('.tsx') ? 'tsx' : 'ts',
    jsx: 'automatic',
    format: 'esm',
    target: 'es2020',
  })
  let out = code
  // Directory depth of this file under esm/ decides how far up to reach dist/css|katex.
  const depth = (rel.split('/').length - 1)
  const up = '../'.repeat(depth + 1)
  const dirPart = rel.split('/').slice(0, -1).join('/')
  const cssDir = dirPart ? dirPart + '/' : ''
  // .module.css -> dist/css/<dirPart>/<local> (css mirrors src subpaths under css/)
  out = out.replace(/(from\s+['"])(\.?\/?)([^'"]+)\.module\.css(['"])/g, (_m, pre, _dot, p, q) => pre + up + 'css/' + cssDir + p + '.module.mjs' + q)
  out = out.replace(/(import\s+['"])(\.?\/?)([^'"]+)\.module\.css(['"])/g, (_m, pre, _dot, p, q) => pre + up + 'css/' + cssDir + p + '.module.mjs' + q)
  // katex/dist/katex.min.css -> dist/katex/katex-inject.mjs
  out = out.replace(/(from\s+['"])katex\/dist\/katex\.min\.css(['"])/g, (_m, pre, q) => pre + up + 'katex/katex-inject.mjs' + q)
  out = out.replace(/(import\s+['"])katex\/dist\/katex\.min\.css(['"])/g, (_m, pre, q) => pre + up + 'katex/katex-inject.mjs' + q)
  // .ts/.tsx relative imports -> .js (esm mirrors src structure)
  out = out.replace(/(from\s+['"])(\.\/?[^'"]+)\.tsx?(['"])/g, '$1$2.js$3')
  out = out.replace(/(import\s+['"])(\.\/?[^'"]+)\.tsx?(['"])/g, '$1$2.js$3')
  const outRel = rel.replace(/\.tsx?$/, '.js')
  mkdirSync(path.dirname(path.join(esmOutDir, outRel)), { recursive: true })
  writeFileSync(path.join(esmOutDir, outRel), out)
}
// Aggregating entry: thin re-export barrel so consumers can tree-shake.
writeFileSync(path.join(distDir, 'index.js'), "export * from './esm/index.js'")
console.log(`[build] esm modules: ${jsFiles.length} files -> dist/esm`)

// 5. Type declarations
const tsconfigBuild = {
  compilerOptions: {
    target: 'ES2022',
    lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    module: 'ESNext',
    moduleResolution: 'bundler',
    jsx: 'react-jsx',
    strict: true,
    skipLibCheck: true,
    allowImportingTsExtensions: true,
    verbatimModuleSyntax: false,
    declaration: true,
    emitDeclarationOnly: true,
    outDir: 'dist/types',
    rootDir: 'src',
  },
  include: ['src'],
}
writeFileSync(path.join(root, 'tsconfig.build.json'), JSON.stringify(tsconfigBuild, null, 2))
execSync('npx tsc -p tsconfig.build.json', { cwd: root, stdio: 'inherit' })

// Post-process emitted declarations: .ts/.tsx specifiers -> .js so consumers
// resolve them against the sibling .d.ts files.
for (const rel of walk(typesOutDir).filter((f) => f.endsWith('.d.ts'))) {
  const abs = path.join(typesOutDir, rel)
  const text = readFileSync(abs, 'utf8')
  const fixed = text
    .replace(/(from ['"])([^'"]+)\.tsx?(['"])/g, '$1$2.js$3')
    .replace(/import 'katex\/dist\/katex\.min\.css';\n?/g, '')
  if (fixed !== text) writeFileSync(abs, fixed)
}
copyFileSync(path.join(srcDir, 'css-modules.d.ts'), path.join(typesOutDir, 'css-modules.d.ts'))
console.log('[build] types emitted to dist/types')

console.log('[build] done')
