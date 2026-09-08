#!/usr/bin/env node
/**
 * 把 workspace 中的插件安装到指定 dsh profile —— **从源码 pack 的开发者路径**。
 *
 * 流程：`pnpm -r build`（可 --no-build）→ 对 plugin-registry 的插件 + workspace 依赖闭包
 * 逐个 `pnpm pack` 到 <ROOT>/.pack-profile → 由 scripts/lib/profile-install.mjs 写入
 * profile 依赖（file:<tgz>）与 overrides，再在 profile 目录 `pnpm install --prod`。
 *
 * 普通用户不必走这条路：`docs/install.sh` / `docs/install.ps1` 默认从 GitHub Release
 * 下载 CI 预构建的同一批 tarball（scripts/release-install.mjs），不 clone、不构建。
 * 本脚本是它的源码等价物，供开发/贡献者与离线环境使用。
 *
 * 目标 home 解析顺序：`--home <dir>` > `$DSH_HOME` > `~/.dsh`（与 dsh 自身一致）。
 *
 * 版本纪律：dsh client-modules 按「插件版本」缓存产物字节，同版本重装可能拿到旧字节。
 * 改码后必须 bump 插件 package.json 版本再跑本脚本；验证以 /plugins/??...&rev= 变化为准。
 *
 * 用法：
 *   node scripts/install-profile.mjs [profile] [--home <dir>] [--only a,b] [--no-build] [--register-bundles]
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { installIntoProfile } from './lib/profile-install.mjs'
import { computeClosure, packClosure, readWorkspacePackages } from './lib/workspace.mjs'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DEFAULT_PACK_DIR = join(ROOT, '.pack-profile')

function parseArgs(argv) {
  const flags = { build: true, only: undefined, home: undefined, registerBundles: false, packDir: DEFAULT_PACK_DIR }
  const positional = []
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--no-build') flags.build = false
    else if (arg === '--register-bundles') flags.registerBundles = true
    else if (arg === '--home') flags.home = argv[++index]
    else if (arg === '--pack-dir') flags.packDir = resolve(argv[++index])
    else if (arg === '--only') flags.only = [...(flags.only ?? []), ...String(argv[++index]).split(',').map((s) => s.trim()).filter(Boolean)]
    else if (arg.startsWith('--')) throw new Error(`未知参数 ${arg}（可用：--home <dir> | --only a,b | --pack-dir <dir> | --no-build | --register-bundles）`)
    else positional.push(arg)
  }
  return { flags, positional }
}

const { flags, positional } = parseArgs(process.argv.slice(2))
const packages = readWorkspacePackages(ROOT)
const registryProfile = JSON.parse(
  (await import('node:fs')).readFileSync(join(ROOT, 'plugin-registry.json'), 'utf8'),
).profile
const profile = positional[0] ?? registryProfile ?? 'web'
const rawHome = flags.home ?? process.env['DSH_HOME'] ?? join(homedir(), '.dsh')
const home = resolve(rawHome.replace(/^~(?=$|[/\\])/, homedir()))
const { selected, closure } = computeClosure(ROOT, packages, flags.only)

console.log(`[install-profile] home=${home} profile=${profile}`)
console.log(`[install-profile] 插件 ${selected.length} 个，闭包 ${closure.size} 个包`)
if (flags.only !== undefined) console.log(`[install-profile] 仅安装：${flags.only.join(', ')}`)

if (flags.build) {
  console.log('[install-profile] 1/3 构建全部包 (pnpm -r build)...')
  execSync('pnpm -r build', { cwd: ROOT, stdio: 'inherit' })
} else {
  console.log('[install-profile] 1/3 跳过构建 (--no-build)')
}

console.log(`[install-profile] 2/3 pack 闭包 -> ${flags.packDir}`)
const packed = packClosure({ packDir: flags.packDir, closure, selected, log: (line) => console.log(line) })

console.log('[install-profile] 3/3 写入 profile 并安装')
const entries = [...packed.values()].map((record) => ({
  name: record.name,
  version: record.version,
  file: record.file,
  bundle: record.bundle,
}))
const result = installIntoProfile({
  home,
  profile,
  packages: entries,
  registerBundles: flags.registerBundles,
})

console.log(`[install-profile] 完成（${entries.length} 个包）。bundles=${result.bundles.length}`)
console.log(`[install-profile] 启动验证: dsh --profile ${profile} --port 3999 --no-open`)
console.log('[install-profile] 提醒: 宿主必须重启才会重建 client 模块图; 验证以 /plugins/??...&rev= 变化为准。')

// 让 shell 能拿到 profile 目录（可选）
if (process.env['DSH_PRINT_PROFILE'] === '1') console.log(result.profileRoot)
if (!existsSync(result.profileRoot)) process.exitCode = 1
