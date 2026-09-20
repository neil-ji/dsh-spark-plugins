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
 *   5. 按 dsh-app-boot 的口径复核每条 bundle 行（见 inspectBundleRow）
 *
 * 不挂载 monorepo、不产生 file:/link: 指向源码的活链接。
 *
 * **bundle 行永远与实际依赖对账**（不受 registerBundles 门控）：`dsh` 的 loadProfileDirectory
 * 对 dsh.profile.bundles 是严格解析 —— 任何一行指向没装的包，下次启动就 fail-loud
 * （`cannot resolve profile bundle "..."`），而且它的解析锚是 dsh 安装目录优先、profile 目录兜底，
 * 所以官方 @deepseek-ai/* 的行放行、其余必须能在 profile 里解析到。历史事故：一次
 * `install-profile.mjs --only <子集>`（registerBundles 默认 false）把依赖正确清到了子集，
 * 却把 bundle 行原样留着，于是真 home 的 `dsh web` 直接起不来。所以回收逻辑不能挂在
 * registerBundles 上，registerBundles 只决定「要不要**新增**行」。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'

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

/**
 * 纯函数：把我们自己的 overrides 并进既有 pnpm-workspace.yaml（可单测）。
 *
 * 修复的历史缺陷：这里原先是**整个重写**该文件，于是用户手写的 override 会在每次
 * 安装时被静默抹掉（实测：种入 `"user-own-pin": "^1.0.0"` 后跑一次安装就没了）。
 * 用户的 profile 不是我们的地盘 —— 别人的键一律原样保留，同名键才由我们覆盖。
 *
 * @param {string} existing - 现有文件内容（空串 = 文件不存在）
 * @param {Record<string,string>} overrides - 本次要写的 override
 * @returns {string} 新文件内容
 */
export function mergeWorkspaceYaml(existing, overrides) {
  const ours = Object.entries(overrides).map(([name, spec]) => `  ${JSON.stringify(name)}: ${JSON.stringify(spec)}`)
  const text = existing ?? ''
  const parseKey = (line) => {
    const match = /^\s+["']?([^"':\s]+)["']?\s*:/.exec(line)
    return match === null ? undefined : match[1]
  }

  // 没有 overrides 段：按标准模板起一个，把我们的键放进去；用户已有的其它行保留。
  const lines = text.split('\n')
  const headerIndex = lines.findIndex((line) => /^overrides:\s*$/.test(line))
  if (headerIndex === -1) {
    const kept = text.trimEnd()
    const base = kept === '' ? WORKSPACE_YAML.trimEnd() : kept
    if (ours.length === 0) return base + '\n'
    return `${base}\noverrides:\n${ours.join('\n')}\n`
  }

  // 有 overrides 段：逐行重建 —— 同名键替换成我们的 spec，其余（用户的）行原样留着。
  const oursMap = new Map(Object.entries(overrides))
  const out = []
  for (let index = 0; index <= headerIndex; index++) out.push(lines[index])
  for (let index = headerIndex + 1; index < lines.length; index++) {
    const line = lines[index]
    if (/^\S/.test(line) && line.trim() !== '') {
      out.push(...lines.slice(index))
      break
    }
    const key = parseKey(line)
    if (key !== undefined && oursMap.has(key)) continue
    out.push(line)
  }
  // 把还没出现过的我们的键补在 overrides 段末尾
  const present = new Set(out.map(parseKey).filter((key) => key !== undefined))
  const missing = ours.filter((line) => !present.has(parseKey(line)))
  if (missing.length > 0) {
    // 定位 overrides 段的结束位置，插在段内
    let insertAt = out.length
    for (let index = headerIndex + 1; index < out.length; index++) {
      if (/^\S/.test(out[index]) && out[index].trim() !== '') {
        insertAt = index
        break
      }
    }
    out.splice(insertAt, 0, ...missing)
  }
  return out.join('\n').replace(/\n*$/, '\n')
}

function writeWorkspaceYaml(file, overrides) {
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : ''
  writeFileSync(file, mergeWorkspaceYaml(existing, overrides))
}

/**
 * 纯函数：bundle 行对账（可单测）。规则见文件头注释 —— 官方前缀的行一律保留
 * （解析锚是 dsh 安装目录），其余行必须在**本次安装后的依赖集**里，否则摘掉。
 *
 * `added` 里已经存在的行不重复追加，也不改变它原有的位置。
 * @param {{previous: string[], dependencies: string[], added: string[], officialPrefix?: string}} input
 * @returns {{bundles: string[], removed: string[], added: string[]}} added 为真正新登记的行
 */
export function reconcileBundleRows({ previous, dependencies, added, officialPrefix = OFFICIAL_BUNDLE_PREFIX }) {
  const installed = new Set(dependencies)
  const keep = (name) => String(name).startsWith(officialPrefix) || installed.has(name)
  const resolvable = previous.filter(keep)
  return {
    bundles: [...resolvable.filter((name) => !added.includes(name)), ...added],
    removed: previous.filter((name) => !resolvable.includes(name)),
    added: added.filter((name) => !resolvable.includes(name)),
  }
}

/**
 * 按 Node 自己的 node_modules 查找顺序，从 profile 目录解析一个包的根目录。
 * 与 dsh-app-boot 的 packageDirFromAnchor 同口径（它用 createRequire(anchor).resolve.paths），
 * 这样这里的判断和宿主启动时的判断不会漂移。
 * @returns 包的绝对目录，解析不到为 undefined
 */
export function packageDirFromProfile(profileRoot, packageName) {
  let searchPaths
  try {
    searchPaths = createRequire(join(profileRoot, 'package.json')).resolve.paths(packageName) ?? []
  } catch {
    return undefined
  }
  for (const searchPath of searchPaths) {
    const candidate = join(searchPath, packageName)
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  return undefined
}

/**
 * 一条 bundle 行能否被宿主当成补丁层加载 —— 复刻 loadProfileDirectory 的三道检查：
 * 包能解析、声明了 dsh.bundle.patch、该补丁文件存在。任一不过，dsh 下次启动就抛。
 *
 * 官方包（@deepseek-ai/*）一律放行：它们的解析锚是 dsh 安装目录，不归本工具链管，
 * 真解析不到那是 dsh 自己坏了。
 * @returns {{ok: true, official?: true, dir?: string, patch?: string} | {ok: false, reason: string}}
 */
export function inspectBundleRow(profileRoot, packageName) {
  const name = String(packageName)
  if (name.startsWith(OFFICIAL_BUNDLE_PREFIX)) return { ok: true, official: true }
  const dir = packageDirFromProfile(profileRoot, name)
  if (dir === undefined) return { ok: false, reason: '在 profile 里解析不到（没安装）' }
  let declared
  try {
    declared = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).dsh?.bundle?.patch
  } catch (error) {
    return { ok: false, reason: `package.json 读不了：${String(error?.message ?? error)}` }
  }
  if (typeof declared !== 'string' || declared === '') {
    return { ok: false, reason: '未声明 dsh.bundle.patch（bundle 行只能指向声明了补丁的包）' }
  }
  if (!existsSync(join(dir, declared))) {
    return { ok: false, reason: `补丁文件不存在：${declared}（tarball 里大概率没带上）` }
  }
  return { ok: true, dir, patch: declared }
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

  // bundle 行对账：**不受 registerBundles 门控**（见文件头注释）。上面刚把 dependencies 收敛成
  // 本次安装的形态，这里就必须同步收敛 bundle 行 —— 留着指向没装的包的行 = 留一个下次启动
  // 必然 fail-loud 的 profile。
  const reconciled = reconcileBundleRows({
    previous: manifest.dsh?.profile?.bundles ?? [],
    dependencies: Object.keys(dependencies),
    // registerBundles 只决定「要不要新增行」：新增的必须是本次安装且声明了 bundle 补丁的包。
    added: registerBundles ? packages.filter((pkg) => pkg.bundle === true).map((pkg) => pkg.name) : [],
  })
  const bundles = reconciled.bundles
  for (const name of reconciled.removed) {
    changes.push(`${name} (bundle 行指向未安装的包 → 移除，留着会让 dsh 下次启动 fail-loud)`)
  }
  for (const name of reconciled.added) changes.push(`${name} (登记为 bundle 行)`)

  manifest.dsh = manifest.dsh ?? { profile: {} }
  manifest.dsh.profile = {
    ...manifest.dsh.profile,
    patchReload: manifest.dsh.profile.patchReload ?? 'live',
    // 原本没有 bundle 行、本次也不登记时保持 undefined，不去凭空写一个空列表。
    ...(registerBundles || manifest.dsh.profile.bundles !== undefined ? { bundles } : {}),
  }

  if (dryRun) {
    log(`[dry-run] 将写入 ${paths.manifest}（${packages.length} 个 file: 依赖，bundle 行对账后 ${bundles.length} 条${registerBundles ? '，含本次新登记' : ''}）`)
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

  // 装完按宿主口径复核：前面只能按 dependencies 对账，装不上 / tarball 里没带补丁文件
  // 这两件事只有落盘后才知道。坏行既不能留下（下次启动必炸），也不能默默吞掉
  // （用户明确登记过），所以「摘掉坏行保证 profile 能启动」+「抛错让本次安装显式失败」两样都做。
  const finalBundles = manifest.dsh.profile.bundles ?? []
  const broken = finalBundles
    .map((name) => ({ name, verdict: inspectBundleRow(paths.profileRoot, name) }))
    .filter((row) => row.verdict.ok !== true)
  if (broken.length > 0) {
    const survivors = finalBundles.filter((name) => !broken.some((row) => row.name === name))
    manifest.dsh.profile = { ...manifest.dsh.profile, bundles: survivors }
    writeFileSync(paths.manifest, JSON.stringify(manifest, null, 2) + '\n')
    throw new Error(
      [
        `已安装的包里有 ${broken.length} 条 bundle 行不能作为补丁层加载，已从 ${paths.manifest} 摘掉：`,
        ...broken.map((row) => `  - ${row.name}：${row.verdict.reason}`),
        `保留的 bundle 行：${survivors.join(', ') || '（无）'}`,
        'profile 现在能启动，但上面这些包不会被加载；修掉包的 dsh.bundle.patch 后重跑安装器即可登记回来。',
      ].join('\n'),
    )
  }

  return {
    profileRoot: paths.profileRoot,
    dependencies,
    bundles: finalBundles,
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
