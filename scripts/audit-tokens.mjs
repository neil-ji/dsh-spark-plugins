/**
 * 形制 token 闸门（间距 / 圆角 / 字号字面量审计）。
 *
 * 规范来源：docs/UI-UX-SPEC.md §2（设计 Token 规范）。
 * 与 audit-contrast（颜色）互补：这个脚本守护「非颜色形制」——
 *   1. radius：面板层 border-radius 只允许引 var(--spk-radius-*)；微元素/
 *      嵌套推导/胶囊(h/2)字面量白名单：2/3/4/6/8/9/13/16px 与 50%/inherit；
 *   2. font-size：只允许 var(--spk-text-*) / 组件级密度 token（var(--<scope>-*)）；
 *      自定义属性定义行（--x: 12px）不算违规（那就是 token 的定义处）；
 *   3. 间距（margin/padding/gap 族）：px 值必须是 4 的倍数，微距白名单
 *      1/2px，14px 仅限既有语义档内部值；var(...) 引用不限制。
 *
 * 豁免：dsh-ui-kit/src/components（组件形制的定义源，由规范文档直接管辖）、
 *       packages 下的 templates（独立静态站，非面板 UI）。
 *
 * 用法：node scripts/audit-tokens.mjs [--json]
 * 退出码：0 = 通过，1 = 有硬失败。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'packages')

const EXCLUDED_DIR = /(?:\\|\/)(?:node_modules|lib|dist|templates)(?:\\|\/)/
const COMPONENT_SOURCE = /dsh-ui-kit\W+src\W+components\W+/

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (EXCLUDED_DIR.test(full)) continue
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(css|tsx?|mjs)$/.test(entry.name)) out.push(full)
  }
  return out
}

const files = walk(SRC).filter((f) => !COMPONENT_SOURCE.test(f))

const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .map((line) => {
      const i = line.indexOf('//')
      return i < 0 ? line : line.slice(0, i)
    })
    .join('\n')

const RADIUS_MICRO = new Set([2, 3, 4, 6, 8, 9, 13, 16])
const SPACING_ALLOWED = new Set([1, 2, 14])
const violations = []

function check(files, re, classify) {
  for (const file of files) {
    const rel = relative(ROOT, file).split('\\').join('/')
    const text = stripComments(readFileSync(file, 'utf8'))
    const lines = text.split('\n')
    lines.forEach((line, i) => {
      for (const match of line.matchAll(re)) {
        const verdict = classify(match, line)
        if (verdict) violations.push({ file: rel, line: i + 1, ...verdict, text: line.trim().slice(0, 110) })
      }
    })
  }
}

// 1) radius：字面量必须落在微元素/胶囊推导白名单；10/12/14/20/999/7 一律引 token
check(files, /border-radius:\s*([^;\n}]+)/g, (m) => {
  const raw = m[1].trim()
  if (raw.startsWith('var(') || raw === 'inherit' || raw === '50%') return null
  const pxs = [...raw.matchAll(/(\d+)px/g)].map((x) => Number(x[1]))
  if (pxs.length > 0 && pxs.every((n) => RADIUS_MICRO.has(n))) return null
  return { rule: 'radius-token', detail: raw }
})

// 2) font-size：font-size: Npx 与 font: <weight> Npx/… 两种写法都抓
check(files, /(?:font-size:\s*|font:\s*[\w-]+\s+)([^;\n/}]+)/g, (m, line) => {
  const raw = m[1].trim()
  if (raw.startsWith('var(')) return null
  if (line.trim().startsWith('--')) return null
  if (!/^\d+px$/.test(raw)) return null
  return { rule: 'font-size-token', detail: raw }
})

// 3) 间距：px 值 ∈ 4 的倍数 ∪ {1,2,14}；var(...) 引用不限；定义行合法
check(
  files,
  /(?:^|;|\{)\s*(?:margin|padding|gap|row-gap|column-gap)(?:-[a-z]+)?:\s*([^;\n}]+)/g,
  (m, line) => {
    if (line.trim().startsWith('--')) return null
    for (const px of m[1].matchAll(/(\d+)px/g)) {
      const n = Number(px[1])
      if (n % 4 !== 0 && !SPACING_ALLOWED.has(n)) {
        return { rule: 'spacing-scale', detail: m[1].trim().slice(0, 60) }
      }
    }
    return null
  },
)

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ ok: violations.length === 0, count: violations.length, violations }, null, 2))
} else if (violations.length === 0) {
  console.log('audit-tokens: PASS — 面板层形制全部走 token（微元素/密度定义白名单内）')
} else {
  console.log('audit-tokens: FAIL — ' + violations.length + ' 处形制字面量越出白名单：')
  for (const v of violations) {
    console.log('  ' + v.rule + '\t' + v.file + ':' + v.line + '\t[' + v.detail + '] ' + v.text)
  }
  process.exitCode = 1
}
