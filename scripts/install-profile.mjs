#!/usr/bin/env node
/**
 * 把 workspace 中的插件 bundle 安装到指定 dsh profile（本地自用）。
 *
 * 做法（与 dsh plugin add file: 等效，但集中管理）：
 *  1. 更新 <profile>/package.json 的 dependencies：name -> file:<workspace 绝对路径>
 *  2. 更新 <profile>/pnpm-workspace.yaml：挂载本 monorepo 的 packages/*（替换旧项目路径）
 *  3. 在 profile 目录执行 pnpm install（生成/更新链接与锁文件）
 *
 * 注意：必须用 file: 而非 link:。实测 dsh web（3080）的 /plugins/<id>/client.js
 * 路由直接按 .pnpm/<name>@* 虚拟 store 目录解析包（改名残留副本立即 404），
 * 不跟随顶层 node_modules symlink——link: 会让服务端永远读不到 workspace 更新。
 * file: 的 .pnpm 副本与 workspace lib 是硬链接（同 inode），build 后内容即时
 * 同步；install 重链期间有短暂空文件窗口（实测抓过），由各包 build 的原子写
 * （临时文件 + rename）+ 浏览器刷新兜底。
 *
 * bundle 注册列表在 profile package.json 的 dsh.profile.bundles 中维护，本脚本不动它。
 */
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const registry = JSON.parse(await readFile(join(ROOT, 'plugin-registry.json'), 'utf8'))
const profile = process.argv[2] ?? registry.profile ?? 'web'
const profileRoot = join(homedir(), '.dsh', 'profiles', profile)

// 1) 更新 dependencies
const pkgPath = join(profileRoot, 'package.json')
const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
const deps = (pkg.dependencies ??= {})
const changes = []
for (const [name, rel] of Object.entries(registry.plugins)) {
  const target = 'file:' + resolve(ROOT, rel)
  if (deps[name] !== target) {
    changes.push(name + ': ' + (deps[name] ?? '(无)') + '  ->  ' + target)
    deps[name] = target
  }
}
await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

// 2) 更新 pnpm-workspace.yaml（移除旧项目路径，挂载本 monorepo packages/*）
const wsPath = join(profileRoot, 'pnpm-workspace.yaml')
const ws = await readFile(wsPath, 'utf8')
const esc = (s) => s.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&')
const oldEntries = [
  '/Users/neilji/AIGC/dsh-github-connector/packages/*',
  '/Users/neilji/AIGC/dsh-spark-finance/packages/*',
  '/Users/neilji/AIGC/dsh-hippomemo',
  '/Users/neilji/AIGC/dsh-ui-kit',
]
let next = ws
for (const d of oldEntries) {
  next = next.replace(new RegExp('^\\s*-\\s*' + esc(d) + '\\s*$', 'm'), '')
}
const monoEntry = '  - ' + ROOT + '/packages/*'
if (!next.includes(monoEntry)) {
  next = next.replace(/^packages:\s*\n/, 'packages:\n' + monoEntry + '\n')
}
if (next !== ws) await writeFile(wsPath, next)

// 3) pnpm install
console.log('[install-profile] profile: ' + profile + ' (' + profileRoot + ')')
console.log('[install-profile] 依赖变更:')
for (const c of changes) console.log('  ' + c)
if (changes.length === 0) console.log('  (无变化)')
console.log('[install-profile] 1/2 全量刷新 lockfile（--prod 会跳过 devDependencies 的 lockfile 导入，\n            版本变动如 rc.6→rc.8 需先 lockfile-only 才会写进 importers）...')
execSync('pnpm install --lockfile-only --config.confirmModulesPurge=false', { cwd: profileRoot, stdio: 'inherit' })
console.log('[install-profile] 2/2 执行 pnpm install --prod（只链接生产依赖，保持 profile 精简）...')
execSync('pnpm install --prod --config.confirmModulesPurge=false', { cwd: profileRoot, stdio: 'inherit' })
console.log('[install-profile] 完成。启动验证: dsh --profile ' + profile + ' --port 3999')
