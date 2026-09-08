/**
 * 「把一组 tarball 装进某个 dsh profile」的唯一实现。
 *
 * 两条调用方共用它：
 *   - scripts/install-profile.mjs  从工作区源码 pack 出 tarball（开发者 / 贡献者路径）
 *   - scripts/release-install.mjs  从 GitHub Release 下载 tarball（普通用户路径）
 *
 * 做的事与普通用户用 `dsh plugin add` 的形态一致：
 *   1. profile package.json dependencies: <name> -> file:<绝对路径 tgz>
 *   2. profile pnpm-workspace.yaml overrides 把闭包包钉到同一批 tgz
 *      （tarball 内 workspace:* 已被 pnpm pack 改写成具体 semver，这些包多半没发布到 npm，
 *       不钉 override 会去 registry 解析而失败）
 *   3. 可选：把声明了 dsh.bundle.patch 的包登记进 dsh.profile.bundles
 *      （dsh 的 loader 只按这个列表组合补丁层，不会自动发现已安装的包）
 *   4. 在 profile 目录跑 pnpm install --prod
 *
 * 不挂载 monorepo、不产生 file:/link: 指向源码的活链接。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { execSync } from 'node:child_process'

export const OFFICIAL_BUNDLE_PREFIX = '@deepseek-ai/'

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))

export function profilePaths(home, profile) {
  const profileRoot = join(home, 'profiles', profile)
  return {
    profileRoot,
    manifest: join(profileRoot, 'package.json'),
    workspace: join(profileRoot, 'pnpm-workspace.yaml'),
    modules: join(profileRoot, 'node_modules'),
  }
}

const WORKSPACE_YAML = 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n'

function writeWorkspaceYaml(file, overrides) {
  const lines = Object.entries(overrides).map(([name, spec]) => `  ${JSON.stringify(name)}: ${JSON.stringify(spec)}`)
  writeFileSync(file, WORKSPACE_YAML + (lines.length === 0 ? '' : 'overrides:\n' + lines.join('\n') + '\n'))
}

/**
 * @param {object} options
 * @param {string} options.home - DSH_HOME
 * @param {string} options.profile - profile 名
 * @param {Array<{name: string, version: string, file: string, bundle?: boolean}>} options.packages - 已落盘的 tgz
 * @param {boolean} [options.registerBundles] - 登记 dsh.profile.bundles
 * @param {boolean} [options.dryRun]
 * @param {boolean} [options.resetModules] - 先清空 node_modules/lockfile（link↔install 切换时必须）
 * @param {string[]} [options.initBundles] - profile 不存在时按这份 bundle 列表初始化
 * @param {(message: string) => void} [options.log]
 * @returns {{profileRoot: string, dependencies: Record<string,string>, bundles: string[], changes: string[]}}
 */
export function installIntoProfile(options) {
  const { home, profile, packages, registerBundles = false, dryRun = false, resetModules = false } = options
  const log = options.log ?? ((message) => console.log(message))
  const paths = profilePaths(home, profile)

  if (!existsSync(paths.manifest)) {
    if (options.initBundles === undefined) {
      throw new Error(`profile 不存在：${paths.profileRoot}（先 \`dsh plugin --profile ${profile} add <package>\` 初始化，或用默认模板创建）`)
    }
    if (dryRun) {
      log(`[dry-run] 将初始化 profile ${profile}（bundles=${options.initBundles.join(', ')}）`)
    } else {
      mkdirSync(paths.profileRoot, { recursive: true })
      writeFileSync(
        paths.manifest,
        JSON.stringify(
          {
            name: `dsh-profile-${profile}`,
            private: true,
            dependencies: {},
            dsh: { profile: { bundles: [...options.initBundles], patchReload: 'live' } },
          },
          null,
          2,
        ) + '\n',
      )
      if (!existsSync(paths.workspace)) writeFileSync(paths.workspace, WORKSPACE_YAML)
      const patch = join(paths.profileRoot, 'cordis.patch.yml')
      if (!existsSync(patch)) {
        writeFileSync(patch, '# 本 profile 的补丁层（由 dsh-spark-plugins 安装器创建）\n[]\n')
      }
      log(`初始化 profile：${paths.profileRoot}`)
    }
  }

  for (const pkg of packages) {
    if (!existsSync(pkg.file)) throw new Error(`tarball 不存在：${pkg.file}`)
  }

  const manifest = readJson(paths.manifest)
  const dependencies = (manifest.dependencies ??= {})
  const changes = []
  const owned = new Set(packages.map((pkg) => pkg.name))

  // 清掉本工具链此前留下的形态（link: 与旧的 file: tarball），保留用户从 npm 装的其它插件
  for (const [name, value] of Object.entries(dependencies)) {
    if (owned.has(name)) continue
    const spec = String(value)
    const leftover =
      spec.startsWith('link:') ||
      (spec.startsWith('file:') && /([/\\]\.pack-profile|[/\\]\.dev[/\\]pack|[/\\]dsh-spark-plugins[/\\]cache)[/\\]/.test(spec))
    const staleAlias = !leftover && spec.includes('dsh-spark-plugins')
    if (leftover || staleAlias) {
      changes.push(`${name} (${leftover ? '链接/旧 tarball 残留' : '陈旧别名'}, 移除)`)
      delete dependencies[name]
    }
  }

  for (const pkg of packages) {
    const target = 'file:' + pkg.file
    if (dependencies[pkg.name] !== target) {
      changes.push(`${pkg.name} -> ${pkg.file}`)
      dependencies[pkg.name] = target
    }
  }

  const overrides = {}
  for (const pkg of packages) overrides[pkg.name] = 'file:' + pkg.file

  if (registerBundles) {
    const bundleNames = packages.filter((pkg) => pkg.bundle === true).map((pkg) => pkg.name)
    const previous = manifest.dsh?.profile?.bundles ?? []
    const installed = new Set(Object.keys(dependencies))
    const kept = previous.filter((name) => String(name).startsWith(OFFICIAL_BUNDLE_PREFIX) || installed.has(name))
    manifest.dsh = manifest.dsh ?? {}
    manifest.dsh.profile = {
      ...manifest.dsh.profile,
      bundles: [...kept.filter((name) => !bundleNames.includes(name)), ...bundleNames],
    }
  }
  manifest.dsh = manifest.dsh ?? { profile: {} }
  manifest.dsh.profile = { ...manifest.dsh.profile, patchReload: manifest.dsh.profile.patchReload ?? 'live' }

  if (dryRun) {
    log(`[dry-run] 将写入 ${paths.manifest}（${packages.length} 个 file: 依赖，bundles=${registerBundles ? '登记' : '不动'}）`)
    for (const change of changes) log(`[dry-run]   ${change}`)
    return { profileRoot: paths.profileRoot, dependencies, bundles: manifest.dsh.profile.bundles ?? [], changes }
  }

  mkdirSync(paths.profileRoot, { recursive: true })
  if (resetModules && existsSync(paths.modules)) {
    rmSync(paths.modules, { recursive: true, force: true })
    log(`清理 ${paths.modules}`)
    const lock = join(paths.profileRoot, 'pnpm-lock.yaml')
    if (existsSync(lock)) rmSync(lock, { force: true })
  }
  writeFileSync(paths.manifest, JSON.stringify(manifest, null, 2) + '\n')
  writeWorkspaceYaml(paths.workspace, overrides)

  if (changes.length > 0) {
    log('依赖变更：')
    for (const change of changes) log('  ' + change)
  }

  const run = (args) =>
    execSync('pnpm ' + args, {
      cwd: paths.profileRoot,
      stdio: 'inherit',
      env: { ...process.env },
    })
  run('install --lockfile-only --config.confirmModulesPurge=false')
  run('install --prod --config.confirmModulesPurge=false')

  return {
    profileRoot: paths.profileRoot,
    dependencies,
    bundles: manifest.dsh.profile.bundles ?? [],
    changes,
  }
}

/** 从 tgz 文件名反推包名/版本（pnpm pack 的命名规则：<name 去 scope>-<version>.tgz）。 */
export function parseTarballName(file) {
  const base = file.replace(/^.*[/\\]/, '').replace(/\.tgz$/, '')
  const match = /^(?:(@[^/]+)-)?(.+)-(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/.exec(base)
  if (match === null) return undefined
  const name = match[1] === undefined ? match[2] : `${match[1]}/${match[2]}`
  return { name, version: match[3] }
}

export { dirname as dirOf }
