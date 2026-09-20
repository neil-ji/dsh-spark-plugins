#!/usr/bin/env node
/**
 * 打「发布包」：把闭包内的每个包 `pnpm pack` 成 tarball，连同清单与安装器一起放进一个目录，
 * 由 CI 作为 GitHub Release 资产上传。用户侧不再 clone / 构建，只下载 + 校验 + 安装。
 *
 * 产物（<out>/）：
 *   manifest.json          机器可读清单（版本、dsh 兼容区间、每个包的 sha256/size/依赖）
 *   SHA256SUMS             常规校验文件（sha256  文件名）
 *   release-install.mjs    单文件安装器（由 scripts/release-install.mjs 打包而来，无外部依赖）
 *   <name>-<version>.tgz   每个包一个
 *
 * 用法：
 *   node scripts/pack-release.mjs --version 0.2.0 [--tag v0.2.0] [--out dist-release]
 *                                 [--only a,b] [--no-build] [--dsh <version>]
 *
 * dsh 兼容策略：**只保证与最新 dsh 兼容**。清单里的 dsh.tested 取打包环境里 `dsh --version`
 * （CI 装的是 @latest，所以就是发布时刻的最新版），compat 由它推导为 `^<tested>`。
 * dsh 升级后重跑两道闸（pnpm check:dsh-upgrade / dryrun:dsh-upgrade）再重发版。
 */
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build as esbuild } from 'esbuild'
import { computeClosure, missingArtifacts, packClosure, readWorkspacePackages } from './lib/workspace.mjs'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

/** 跑一条命令取版本号，失败返回 undefined（用于 dsh/pnpm 版本记录）。 */
function toolVersion(command) {
  try {
    return execSync(command, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return undefined
  }
}

function parseArgs(argv) {
  const flags = { out: join(ROOT, 'dist-release'), build: true }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--version') flags.version = argv[++index]
    else if (arg === '--tag') flags.tag = argv[++index]
    else if (arg === '--out') flags.out = resolve(argv[++index])
    else if (arg === '--only') flags.only = [...(flags.only ?? []), ...String(argv[++index]).split(',').map((s) => s.trim()).filter(Boolean)]
    else if (arg === '--dsh') flags.dsh = argv[++index]
    else if (arg === '--no-build') flags.build = false
    else if (arg.startsWith('--')) throw new Error(`未知参数 ${arg}`)
    else throw new Error(`未知位置参数 ${arg}`)
  }
  return flags
}

const flags = parseArgs(process.argv.slice(2))
const tag = flags.tag ?? (flags.version === undefined ? undefined : `v${flags.version}`)
const version = flags.version ?? (tag === undefined ? undefined : tag.replace(/^v/, ''))
if (version === undefined) throw new Error('必须给 --version <semver> 或 --tag <vX.Y.Z>')

const registry = JSON.parse(readFileSync(join(ROOT, 'plugin-registry.json'), 'utf8'))
/** 打包环境的 dsh 版本 = 本发布包声明兼容（并已验收）的版本。 */
const dshTested = flags.dsh ?? toolVersion('dsh --version')
const dshCompat = dshTested === undefined ? undefined : `^${dshTested}`
if (dshTested === undefined) {
  console.warn('[pack-release] ! 打包环境里没有 `dsh`，清单将不声明 dsh 兼容版本（安装器会跳过兼容检查）')
} else {
  console.log(`[pack-release] dsh 兼容：只在 ${dshTested} 上验证 → compat ${dshCompat}`)
}

if (flags.build) {
  console.log('[pack-release] 1/5 构建全部包 (pnpm -r build)...')
  execSync('pnpm -r build', { cwd: ROOT, stdio: 'inherit' })
} else {
  console.log('[pack-release] 1/5 跳过构建')
}

console.log('[pack-release] 2/5 计算闭包并做产物完整性预检')
const packages = readWorkspacePackages(ROOT)
const { selected, closure } = computeClosure(ROOT, packages, flags.only)
const missing = missingArtifacts(closure)
if (missing.length > 0) {
  throw new Error(`以下包缺少构建产物，拒绝发版：\n  ${missing.join('\n  ')}`)
}
console.log(`[pack-release] 插件 ${selected.length} 个，闭包 ${closure.size} 个包`)

console.log(`[pack-release] 3/5 pack -> ${flags.out}`)
rmSync(flags.out, { recursive: true, force: true })
mkdirSync(flags.out, { recursive: true })
const packed = packClosure({ packDir: flags.out, closure, selected, log: (line) => console.log(line) })

console.log('[pack-release] 4/5 打包单文件安装器 (release-install.mjs)')
const installerFile = join(flags.out, 'release-install.mjs')
await esbuild({
  entryPoints: [join(ROOT, 'scripts', 'release-install.mjs')],
  outfile: installerFile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  legalComments: 'none',
  banner: { js: '// dsh-spark-plugins 安装器（由 scripts/release-install.mjs 打包，勿手改）' },
})

const uninstallerFile = join(flags.out, 'release-uninstall.mjs')
await esbuild({
  entryPoints: [join(ROOT, 'scripts', 'release-uninstall.mjs')],
  outfile: uninstallerFile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  legalComments: 'none',
  banner: { js: '// dsh-spark-plugins 卸载器（由 scripts/release-uninstall.mjs 打包，勿手改）' },
})

console.log('[pack-release] 5/5 写 manifest.json / SHA256SUMS')
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
const describe = (file) => ({ sha256: sha256(file), size: statSync(file).size })

const commit = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return undefined
  }
})()

const packageEntries = [...packed.values()]
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((record) => {
    const file = record.file.replace(/^.*[/\\]/, '')
    return {
      name: record.name,
      version: record.version,
      file,
      ...describe(record.file),
      bundle: record.bundle,
      plugin: record.plugin,
      deps: record.deps,
    }
  })

const manifest = {
  schema: 1,
  version,
  tag: tag ?? `v${version}`,
  commit,
  builtAt: new Date().toISOString(),
  toolchain: { node: process.version, pnpm: toolVersion('pnpm --version') },
  dsh: { policy: 'latest', tested: dshTested, compat: dshCompat },
  installer: { file: 'release-install.mjs', ...describe(installerFile) },
  uninstaller: { file: 'release-uninstall.mjs', ...describe(uninstallerFile) },
  defaultBundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
  bundles: packageEntries.filter((entry) => entry.bundle).map((entry) => entry.name),
  plugins: packageEntries.filter((entry) => entry.plugin).map((entry) => entry.name),
  packages: packageEntries,
}
writeFileSync(join(flags.out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
writeFileSync(
  join(flags.out, 'SHA256SUMS'),
  packageEntries.map((entry) => `${entry.sha256}  ${entry.file}`).join('\n') +
    `\n${manifest.installer.sha256}  ${manifest.installer.file}\n` +
    `${manifest.uninstaller.sha256}  ${manifest.uninstaller.file}\n`,
)

const total = packageEntries.reduce((sum, entry) => sum + entry.size, 0)
console.log('')
console.log(`[pack-release] 完成：${packageEntries.length} 个 tarball + manifest.json + SHA256SUMS + release-install.mjs + release-uninstall.mjs`)
console.log(`[pack-release] 版本 ${tag ?? version} · dsh 兼容 ${dshCompat ?? '未声明'} · 总体积 ${(total / 1024 / 1024).toFixed(2)} MB`)
console.log(`[pack-release] 输出目录：${flags.out}`)
