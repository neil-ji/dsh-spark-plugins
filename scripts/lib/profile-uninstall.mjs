/**
 * 「把 dsh-spark-plugins 从某个 dsh profile 里干净摘掉」的唯一实现。
 *
 * 背景：安装器（profile-install.mjs）往 profile 里写了 5 处东西，其中两处**不是**靠
 * package.json 能推断出来的，所以卸载必须靠一份「所有权记录」而不是猜：
 *
 *   1. profile/package.json  dependencies  → 16 条 `file:<绝对路径 tgz>`
 *   2. profile/package.json  dsh.profile.bundles → 本次登记的 bundle 行
 *   3. profile/pnpm-workspace.yaml overrides → 16 条钉版
 *      **这个文件是安装器整个重写的**，里面的 overrides 可能混着用户手写的条目；
 *      卸载时只能删「我们写进去的那些 tarball 路径」，不能整文件重写。
 *   4. profile/node_modules + pnpm-lock.yaml
 *   5. $DSH_HOME/spark-plugins/  缓存目录 + 所有权记录
 *
 * 关键约束：**profile 里还有别人的东西**。实测真 home 的 web profile 里就有
 * `dsh-plugin-deepeye`（非本仓库插件）及其 bundle 行 —— 所以卸载必须是外科手术式的
 * 逐条摘除，绝不能 rm -rf profile 或整体清空 bundles/dependencies。
 *
 * 所有权记录落 `$DSH_HOME/spark-plugins/install-state.json`，由安装器写入。
 * 记录不存在时（老版本装的、或用户手删了）退化为「按 tarball 路径特征识别」，
 * 见 isOwnedDependency —— 这是有意的兜底，因为卸载不能要求用户先重装一次。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { inspectBundleRow, profilePaths } from './profile-install.mjs'

/** 本工具链在 profile 目录留下的 tarball 路径特征（老版本无记录时的识别依据）。 */
const TARBALL_HINTS = [/[/\\]spark-plugins[/\\]cache[/\\]/, /[/\\]\.pack-profile[/\\]/, /[/\\]\.dev[/\\]pack[/\\]/]

export function stateFile(home) {
  return join(home, 'spark-plugins', 'install-state.json')
}

export function readState(home) {
  const file = stateFile(home)
  if (!existsSync(file)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return parsed?.schema === 1 ? parsed : undefined
  } catch {
    return undefined
  }
}

export function writeState(home, state) {
  const file = stateFile(home)
  mkdirSync(join(home, 'spark-plugins'), { recursive: true })
  writeFileSync(file, JSON.stringify({ schema: 1, ...state }, null, 2) + '\n')
  return file
}

export function clearState(home) {
  rmSync(stateFile(home), { force: true })
}

/**
 * 一条 dependency 是否归本工具链所有 —— 纯函数，可单测。
 *
 * 判据优先级：本次记录的包名 → 路径落在我们的 cache/.pack-profile/.dev/pack 下。
 * 名字在记录里但装了别的 spec（用户改用 npm 装的同名包）时**不动**：那是用户的东西。
 *
 * @param {{name: string, spec: string, ownedNames?: Set<string>}} input
 */
export function isOwnedDependency({ name, spec, ownedNames }) {
  const text = String(spec)
  if (ownedNames !== undefined && ownedNames.has(name)) {
    return text.startsWith('file:') || text.startsWith('link:')
  }
  return TARBALL_HINTS.some((pattern) => pattern.test(text))
}

/**
 * 计算卸载计划（纯函数，可单测）：决定删哪些依赖行、哪些 bundle 行、哪些 overrides。
 *
 * **不动**任何未被判定为「我们所有」的条目 —— 这是本函数存在的全部理由。
 *
 * @param {object} input
 * @param {Array<[string,string]>} input.dependencies - profile package.json 的 dependencies 条目
 * @param {string[]} input.bundles - profile dsh.profile.bundles
 * @param {string[]} input.overrides - pnpm-workspace.yaml 里已解析的 override 包名
 * @param {Set<string>} [input.ownedNames] - 安装记录里的包名（缺省则纯按路径特征识别）
 * @returns {{dependencies: string[], bundles: string[], overrides: string[]}}
 */
export function planUninstall({ dependencies, bundles, overrides, ownedNames }) {
  const removedDeps = dependencies
    .filter(([name, spec]) => isOwnedDependency({ name, spec, ownedNames }))
    .map(([name]) => name)
  const removedSet = new Set(removedDeps)

  // bundle 行：只摘「我们自己装的那些包」的行。官方 @deepseek-ai/* 与第三方
  // （如 dsh-plugin-deepeye）一律保留 —— 摘了会让用户别的东西也不加载。
  const removedBundles = bundles.filter((name) => removedSet.has(name))

  // overrides：只删命中我们 tarball 路径特征的那些。该文件由安装器重写，
  // 但用户可能往里加过自己的条目，所以不能整文件清空。
  const removedOverrides = overrides.filter((name) => removedSet.has(name))

  return { dependencies: removedDeps, bundles: removedBundles, overrides: removedOverrides }
}

/**
 * 解析 pnpm-workspace.yaml 里 overrides 段的包名（不引入 yaml 依赖：这块结构固定）。
 * @returns {{names: string[], lines: string[]}} names 为 override 键，lines 为原文行
 */
export function parseWorkspaceOverrides(text) {
  const lines = text.split('\n')
  const names = []
  let inOverrides = false
  for (const line of lines) {
    if (/^overrides:\s*$/.test(line)) {
      inOverrides = true
      continue
    }
    if (inOverrides && /^\S/.test(line) && line.trim() !== '') break
    if (!inOverrides) continue
    const match = /^\s+["']?([^"':\s]+)["']?\s*:/.exec(line)
    if (match !== null) names.push(match[1])
  }
  return { names, lines }
}

/** 从 overrides 文本里删掉指定键的行，返回新文本。 */
export function removeWorkspaceOverrides(text, names) {
  if (names.length === 0) return text
  const drop = new Set(names)
  const kept = text.split('\n').filter((line) => {
    const match = /^\s+["']?([^"':\s]+)["']?\s*:/.exec(line)
    if (match === null) return true
    return !drop.has(match[1])
  })
  // 若 overrides 段已空，把它整段去掉，别留一个悬空的 `overrides:`
  const out = []
  for (let index = 0; index < kept.length; index++) {
    if (/^overrides:\s*$/.test(kept[index])) {
      const rest = kept.slice(index + 1)
      if (rest.every((line) => line.trim() === '')) break
    }
    out.push(kept[index])
  }
  // 保留原文的结尾换行（文件末尾是 newline 时别把它吃掉）
  return out.join('\n').replace(/\n*$/, text.endsWith('\n') ? '\n' : '')
}

/**
 * 执行卸载。默认 dry-run 之外的所有写操作都在这里，调用方负责确认。
 *
 * @param {object} options
 * @param {string} options.home - DSH_HOME
 * @param {string} options.profile - profile 名
 * @param {boolean} [options.dryRun]
 * @param {boolean} [options.keepCache] - 保留 $DSH_HOME/spark-plugins 缓存
 * @param {boolean} [options.purge] - 连 node_modules/lockfile 一起清（默认清，保证收敛）
 * @param {(message: string) => void} [options.log]
 */
export function uninstallFromProfile(options) {
  const { home, profile, dryRun = false, keepCache = false, purge = true } = options
  const log = options.log ?? ((message) => console.log(message))
  const paths = profilePaths(home, profile)

  if (!existsSync(paths.manifest)) {
    log(`profile 不存在：${paths.profileRoot}（无需卸载）`)
    return { profileRoot: paths.profileRoot, removed: { dependencies: [], bundles: [], overrides: [] }, cacheRemoved: false }
  }

  const state = readState(home)
  const ownedNames = state === undefined ? undefined : new Set(state.packages ?? [])
  if (state === undefined) {
    log('!  没有找到安装记录，按 tarball 路径特征识别（老版本装的包也能摘干净）')
  }

  const manifest = JSON.parse(readFileSync(paths.manifest, 'utf8'))
  const dependencies = Object.entries(manifest.dependencies ?? {})
  const bundles = manifest.dsh?.profile?.bundles ?? []
  const workspaceText = existsSync(paths.workspace) ? readFileSync(paths.workspace, 'utf8') : ''
  const overrides = parseWorkspaceOverrides(workspaceText).names

  const plan = planUninstall({ dependencies, bundles, overrides, ownedNames })

  if (plan.dependencies.length === 0 && plan.bundles.length === 0 && plan.overrides.length === 0) {
    log('profile 里没有本工具链装的东西（无需卸载）')
    if (!keepCache && !dryRun) clearState(home)
    return { profileRoot: paths.profileRoot, removed: plan, cacheRemoved: false }
  }

  log(`将移除 ${plan.dependencies.length} 条依赖、${plan.bundles.length} 条 bundle 行、${plan.overrides.length} 条 override：`)
  for (const name of plan.dependencies) log(`  - 依赖 ${name}`)
  for (const name of plan.bundles) log(`  - bundle 行 ${name}`)
  for (const name of plan.overrides) log(`  - override ${name}`)

  // 明确报出「保留了什么」，这是用户验证「没误删」的唯一依据。
  const keptBundles = bundles.filter((name) => !plan.bundles.includes(name))
  if (keptBundles.length > 0) log(`  保留的 bundle 行：${keptBundles.join(', ')}`)

  if (dryRun) {
    log('[dry-run] 未写入任何文件')
    return { profileRoot: paths.profileRoot, removed: plan, cacheRemoved: false }
  }

  const dropDeps = new Set(plan.dependencies)
  for (const name of dropDeps) delete manifest.dependencies[name]
  const dropBundles = new Set(plan.bundles)
  manifest.dsh = manifest.dsh ?? { profile: {} }
  manifest.dsh.profile = { ...manifest.dsh.profile, bundles: bundles.filter((name) => !dropBundles.has(name)) }
  writeFileSync(paths.manifest, JSON.stringify(manifest, null, 2) + '\n')

  if (overrides.length > 0) {
    writeFileSync(paths.workspace, removeWorkspaceOverrides(workspaceText, plan.overrides))
  }

  if (purge) {
    rmSync(paths.modules, { recursive: true, force: true })
    rmSync(join(paths.profileRoot, 'pnpm-lock.yaml'), { force: true })
    log(`清理 ${paths.modules} 与 lockfile`)
  }

  // 收敛 node_modules：剩下的依赖（用户自己的插件）重新装一遍。
  // 没有剩余依赖时就没必要跑 pnpm —— 少一次对 pnpm 的依赖。
  if (Object.keys(manifest.dependencies).length > 0) {
    try {
      execSync('pnpm install --prod --config.confirmModulesPurge=false', { cwd: paths.profileRoot, stdio: 'inherit' })
    } catch (error) {
      log(`!  pnpm install 收敛失败（${String(error?.message ?? error)}）—— profile/package.json 已改好，手动跑一次 pnpm install 即可`)
    }
  } else {
    log('没有剩余依赖，跳过 pnpm install')
  }

  let cacheRemoved = false
  if (!keepCache) {
    rmSync(join(home, 'spark-plugins'), { recursive: true, force: true })
    cacheRemoved = true
    log(`已删除缓存与安装记录：${join(home, 'spark-plugins')}`)
  } else {
    clearState(home)
    log('保留缓存（--keep-cache），仅清除安装记录')
  }

  // 卸完复核：留下的 bundle 行必须仍然能解析，否则 profile 会起不来。
  const finalBundles = manifest.dsh.profile.bundles ?? []
  const broken = finalBundles
    .map((name) => ({ name, verdict: inspectBundleRow(paths.profileRoot, name) }))
    .filter((row) => row.verdict.ok !== true)
  if (broken.length > 0) {
    log('!  以下残留 bundle 行在卸载后解析不到，会在下次启动时报错（它们不是我们装的，请人工确认）：')
    for (const row of broken) log(`  - ${row.name}：${row.verdict.reason}`)
  }

  return { profileRoot: paths.profileRoot, removed: plan, cacheRemoved }
}