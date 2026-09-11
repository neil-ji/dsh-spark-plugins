/**
 * 预览 harness 的 esbuild 共用插件。
 *
 * 为什么单独成文件：`server.mjs`（浏览器画布）与 `verify.mjs`（Node 冒烟）都要把
 * **源码**里的 CSS Modules 内联成「注入 style + 导出类名映射」——与各包 build.mjs
 * 同形。ADR-003 之后组件级画布改吃 `src/client/embed.ts` 源码 barrel（不再有
 * lib/embed.cjs 预构建产物），两条构建路径都需要这个插件，所以收敛到一处。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

/**
 * CSS Modules 内联插件。
 * @param {string} packageName - 注入用的 style tag 前缀（如 'preview'）。
 * @param {string} repoRoot - 计算 tagId 用的仓库根（相对路径更稳）。
 */
export const cssModulesPlugin = (packageName, repoRoot) => ({
  name: 'css-modules',
  setup(build) {
    build.onResolve({ filter: /\.module\.css$/ }, (args) => ({
      path: resolve(args.resolveDir, args.path),
      namespace: 'css-mod',
    }))
    build.onLoad({ filter: /.*/, namespace: 'css-mod' }, (args) => {
      const css = readFileSync(args.path, 'utf8')
      // 类名哈希必须以字母开头：十六进制摘要可能以数字开头，会生成非法选择器
      // 并被浏览器静默丢掉整条规则（各包 build.mjs 的同一条教训）。
      const hash = 'x' + createHash('sha1').update(css).digest('hex').slice(0, 6)
      const mapping = {}
      const rewritten = css.replace(/\.([_a-zA-Z][\w-]*)/g, (match, name) => {
        mapping[name] = hash + '_' + name
        return '.' + hash + '_' + name
      })
      const tagId = packageName + '/' + relative(repoRoot, args.path).replace(/\\/g, '/')
      const entries = Object.entries(mapping).map(([k, v]) => JSON.stringify(k) + ': ' + JSON.stringify(v)).join(', ')
      const contents = [
        'const css = ' + JSON.stringify(rewritten) + ';',
        'const tagId = ' + JSON.stringify(tagId) + ';',
        'if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {',
        '  const tag = document.createElement("style");',
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
