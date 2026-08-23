#!/usr/bin/env node
/**
 * bump-dsh-pins.mjs — 一键把 monorepo 的 @deepseek-ai/dsh-* 钉版升级到新版本。
 *
 * 改三处（升级协议第三道闸，check → dryrun → bump 之后的手动执行器）：
 *   1. pnpm-workspace.yaml overrides（逐包精确钉版，pnpm 11.11 通配不生效）
 *   2. pnpm-workspace.yaml minimumReleaseAgeExclude（新包太年轻会被 pnpm 拒装）
 *   3. 根 package.json + packages 下各 package.json 里的 @deepseek-ai/dsh-* 依赖
 *      （^0.1.0-rc.x 的 caret 只匹配同 tuple 预发布，不会自动吃到 0.1.1-rc.x，必须显式钉）
 * 只替换「当前钉版」（默认 0.1.0-rc.8）的版本号，保留原有引号/前缀（^）风格。
 *
 * 用法：
 *   node scripts/bump-dsh-pins.mjs 0.1.1-rc.2          # 实际改写
 *   node scripts/bump-dsh-pins.mjs 0.1.1-rc.2 --dry-run  # 只打印将要改的行
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(SCRIPT_DIR, '..')

const [target, dryRun] = (() => {
  const argv = process.argv.slice(2)
  const idx = argv.findIndex((a) => !a.startsWith('--'))
  return [idx >= 0 ? argv[idx] : undefined, argv.includes('--dry-run')]
})()

if (!target) { console.error('用法: node scripts/bump-dsh-pins.mjs <new-version> [--dry-run]'); process.exit(2) }
// 当前钉版：从 overrides 里数出最多的那个（或直接取 dsh-settings 的值）
function currentPinned() {
  const yaml = readFileSync(path.join(ROOT, 'pnpm-workspace.yaml'), 'utf8')
  const v = new Map()
  for (const line of yaml.split('\n')) {
    const m = line.trim().match(/^['"]?@deepseek-ai\/dsh-[a-z0-9-]+['"]?:\s*['"]?([^\s'"#]+)['"]?$/)
    if (m) v.set(m[1], (v.get(m[1]) || 0) + 1)
  }
  return [...v.entries()].sort((a, b) => b[1] - a[1])[0][0]
}
const current = currentPinned()
if (current === target) { console.log('当前钉版已是 ' + target + '，无需升级'); process.exit(0) }

const changes = []
function note(file, line) { changes.push({ file, line }) }

// 1+2) pnpm-workspace.yaml
{
  const file = 'pnpm-workspace.yaml'
  const p = path.join(ROOT, file)
  const lines = readFileSync(p, 'utf8').split('\n')
  const out = lines.map((line) => {
    const ov = line.match(/^([ \t]*['"]?@deepseek-ai\/dsh-[a-z0-9-]+['"]?:\s*['"]?)([^\s'"#]+)(['"]?\s*)$/)
    if (ov && ov[2] === current) { note(file, line); return ov[1] + target + ov[3] }
    const ex = line.match(/^([ \t]*-\s+['"]?@deepseek-ai\/dsh-[a-z0-9-]+@)([^'"\s]+)(['"]?\s*)$/)
    if (ex && ex[2] === current) { note(file, line); return ex[1] + target + ex[3] }
    return line
  })
  if (!dryRun) writeFileSync(p, out.join('\n'))
}

// 3) 根 + packages/*/package.json
const pkgs = ['package.json', ...readdirSync(path.join(ROOT, 'packages')).map((d) => 'packages/' + d + '/package.json')]
for (const rel of pkgs) {
  const p = path.join(ROOT, rel)
  let json
  try { json = JSON.parse(readFileSync(p, 'utf8')) } catch { continue }
  let touched = false
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const deps = json[section]
    if (!deps) continue
    for (const name of Object.keys(deps)) {
      if (!name.startsWith('@deepseek-ai/dsh-')) continue
      const m = deps[name].match(/^(\^|~)?0\.1\.0-rc\.8$/)
      if (m) { deps[name] = (m[1] || '') + target; touched = true }
    }
  }
  if (touched) { note(rel, '(deps 钉版)'); if (!dryRun) writeFileSync(p, JSON.stringify(json, null, 2) + '\n') }
}

console.log(dryRun ? '[dry-run] 将改动 ' + changes.length + ' 行：' : '已改动 ' + changes.length + ' 行：')
const byFile = {}
for (const c of changes) byFile[c.file] = (byFile[c.file] || 0) + 1
for (const [f, n] of Object.entries(byFile)) console.log('  ' + f + ' (' + n + ')')
if (!changes.length) console.log('⚠️ 没有匹配到当前钉版 ' + current + ' 的行，检查一下？')