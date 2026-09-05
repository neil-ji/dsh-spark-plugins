#!/usr/bin/env node
/**
 * 把 workspace 中的插件安装到指定 dsh profile —— 与普通用户一致的 tarball 安装路径。
 *
 * 做法（不走 npm registry、不做 file:/link:/硬链接到源码）：
 *  1. `pnpm -r build` 构建全部包（--no-build 跳过）
 *  2. 对 plugin-registry.json 的插件 + 其 workspace 库依赖闭包逐个 `pnpm pack`
 *     产出到 <ROOT>/.pack-profile/<name>-<version>.tgz（pnpm pack 会把
 *     workspace:* 依赖改写为具体 semver）
 *  3. 更新 <profile>/package.json dependencies：name -> file:<tgz 绝对路径>
 *     （tarball 安装是内容拷贝进 profile 自己的 .pnpm store，与源码目录无任何链接）
 *  4. 清除 profile pnpm-workspace.yaml 里对本 monorepo 的 packages/* 挂载
 *     （挂载会让 workspace 库绕过 tarball 变成活链接，正是要消灭的形态）
 *  5. profile 目录 pnpm install
 *
 * 版本纪律：dsh client-modules 按「插件版本」缓存产物字节，同版本重装可能
 * 拿到旧字节（rev 不变）。改码后必须 bump 插件 package.json 版本再跑本脚本。
 * 验证：重启宿主后抓 boot 首页 /plugins/??...&rev= 的 rev 是否变化。
 *
 * bundle 注册列表在 profile package.json 的 dsh.profile.bundles 中维护，本脚本不动它。
 */
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, basename } from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const PACK_DIR = join(ROOT, '.pack-profile')
const doBuild = !process.argv.includes('--no-build')
const posArgs = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const registry = JSON.parse(await readFile(join(ROOT, 'plugin-registry.json'), 'utf8'))
const profile = posArgs[0] ?? registry.profile ?? 'web'
const profileRoot = join(homedir(), '.dsh', 'profiles', profile)

const readPkg = async (rel) => JSON.parse(await readFile(join(ROOT, rel, 'package.json'), 'utf8'))

// 0) 依赖闭包：registry 插件 + 被它们 workspace: 引用的库包
// 包名 -> 目录 映射按 packages/*/package.json 实际 name 建立（目录名可能与包名不同）
const allDirs = (await readFile(join(ROOT, 'pnpm-workspace.yaml'), 'utf8')).length > 0
  ? (await import('node:fs')).readdirSync(join(ROOT, 'packages'))
  : []
const dirByName = new Map()
for (const dir of allDirs) {
  try {
    dirByName.set((await readPkg('packages/' + dir)).name, 'packages/' + dir)
  } catch { /* 非包目录 */ }
}
const queue = Object.entries(registry.plugins).map(([name, rel]) => ({ name, rel }))
const closure = new Map() // pkgName -> rel
while (queue.length) {
  const { name, rel } = queue.shift()
  if (closure.has(name)) continue
  closure.set(name, rel)
  const pkg = await readPkg(rel)
  for (const [dep, spec] of Object.entries(pkg.dependencies ?? {})) {
    if (spec.startsWith('workspace:')) {
      const depRel = dirByName.get(dep)
      if (!depRel) {
        throw new Error(`workspace 依赖 ${dep} 在 packages/ 下找不到对应目录`)
      }
      queue.push({ name: dep, rel: depRel })
    }
  }
}

// 1) 构建
if (doBuild) {
  console.log('[install-profile] 1/5 构建全部包 (pnpm -r build)...')
  execSync('pnpm -r build', { cwd: ROOT, stdio: 'inherit' })
} else {
  console.log('[install-profile] 1/5 跳过构建 (--no-build)')
}

// 2) pack 全部闭包包
await rm(PACK_DIR, { recursive: true, force: true })
await mkdir(PACK_DIR, { recursive: true })
console.log('[install-profile] 2/5 pack ' + closure.size + ' 个包 -> ' + PACK_DIR)
for (const rel of closure.values()) {
  execSync(`pnpm pack --pack-destination ${JSON.stringify(PACK_DIR)}`, {
    cwd: join(ROOT, rel),
    stdio: 'pipe',
  })
}

// 3) 更新 profile dependencies 为 tarball 引用；清理不在 registry 里的 monorepo file: 残留别名
const pkgPath = join(profileRoot, 'package.json')
const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
const deps = (pkg.dependencies ??= {})
const changes = []
for (const [name, value] of Object.entries(deps)) {
  const owned = Object.hasOwn(registry.plugins, name) || closure.has(name)
  if (!owned && String(value).includes('dsh-spark-plugins')) {
    changes.push(name + ' (陈旧别名, 移除)')
    delete deps[name]
  }
}
// 闭包全部入 profile deps：tarball 内被 pnpm pack 改写的 semver 依赖（如 ^0.2.0）
// 才能在本地被满足，不会去 npm registry 解析（这些包多未发布）。
for (const [name, rel] of closure) {
  const p = await readPkg(rel)
  const tgz = join(PACK_DIR, `${name}-${p.version}.tgz`)
  if (!existsSync(tgz)) throw new Error(`tarball 缺失: ${tgz}`)
  const target = 'file:' + tgz
  if (deps[name] !== target) {
    changes.push(name + ' -> ' + target)
    deps[name] = target
  }
}
await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

// 4) pnpm-workspace.yaml：移除 monorepo 挂载 + overrides 把闭包包全部钉到本地 tarball
//    （tarball 内被 pack 改写的 semver 子依赖不去 npm registry 解析）
const wsPath = join(profileRoot, 'pnpm-workspace.yaml')
let ws = await readFile(wsPath, 'utf8')
ws = ws.replace(/^\s*-\s*\S*dsh-spark-plugins\/packages\/\*\s*$/m, '')
const overrides = {}
for (const [name, rel] of closure) {
  const p = await readPkg(rel)
  overrides[name] = 'file:' + join(PACK_DIR, `${name}-${p.version}.tgz`)
}
const overridesYaml = 'overrides:\n' +
  Object.entries(overrides).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join('\n') + '\n'
if (/^overrides:\s*$/m.test(ws)) {
  ws = ws.replace(/^overrides:\s*$(?:\n(?! \S |\S)[^\n]*)*/m, overridesYaml)
} else {
  ws = ws.trimEnd() + '\n' + overridesYaml
}
await writeFile(wsPath, ws)
console.log('[install-profile] 4/5 workspace.yaml 已更新: 移除 monorepo 挂载 + overrides 钉 ' + Object.keys(overrides).length + ' 个包')

// 5) 安装
console.log('[install-profile] 5/5 profile 安装 (' + profileRoot + ')')
if (changes.length) {
  console.log('[install-profile] 依赖变更:')
  for (const c of changes) console.log('  ' + c)
}
execSync('pnpm install --lockfile-only --config.confirmModulesPurge=false', { cwd: profileRoot, stdio: 'inherit' })
execSync('pnpm install --prod --config.confirmModulesPurge=false', {
  cwd: profileRoot,
  stdio: 'inherit',
})
console.log('[install-profile] 完成。启动验证: dsh --profile ' + profile + ' --port 3999')
console.log('[install-profile] 提醒: 宿主必须重启才会重建 client 模块图; 验证以 /plugins/??...&rev= 变化为准。')
