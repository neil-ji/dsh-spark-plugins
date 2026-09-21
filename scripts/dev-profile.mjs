#!/usr/bin/env node
/**
 * dev profile 的 link 通道（线 2 日常开发循环）：把工作区插件以 pnpm `link:` 依赖
 * 链接进沙箱 profile，让包自己的 cordis.patch.yml 原样生效，从而同时拿到
 * 「真实 loader/真实槽位」与「改码即热更」。
 *
 * 为什么不用 file:// 行：包自己的 patch 里会引用其它包名（含 `pkg/subpath` 多行插件），
 * 而 `link:` 让这些名字能从 profile 的 node_modules 解析到仓库目录，
 * 于是 patch 无需重写、config 无需复制，且 client-modules 解析出的真实路径
 * 就是仓库里的 lib/client.js（客户端 HMR 与宿主 HMR 都成立）。
 *
 * 用法：
 *   node scripts/dev-profile.mjs link                 # 链接全部已登记插件
 *   node scripts/dev-profile.mjs link dsh-spark       # 只链接指定包（自动补其 patch 引用闭包）
 *   node scripts/dev-profile.mjs list                 # 包画像（是否有产物 / 是否已链接）
 *   node scripts/dev-profile.mjs status               # 当前 profile 会加载什么
 *   node scripts/dev-profile.mjs unlink               # 清空链接与插件 bundle 行
 */
import { existsSync, lstatSync, readFileSync, rmSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import {
  BUNDLES_BASE,
  PORT,
  PROFILE,
  PROFILE_DIR,
  PROFILE_MANIFEST,
  PROFILE_PATCH,
  PROFILE_WORKSPACE,
  ROOT,
  SANDBOX_HOME,
  describePackage,
  exists,
  log,
  readJson,
  readText,
  registeredPlugins,
  runPnpm,
  runShell,
  workspacePackages,
  writeJson,
  writeText,
  yaml,
} from './dev-shared.mjs'

const argv = process.argv.slice(2)
const command = (argv[0] ?? 'link').replace(/^--/, '')
const requested = argv.slice(1).filter((arg) => !arg.startsWith('--'))
const force = argv.includes('--force')

const PATCH_HEADER = [
  '# 本文件由 scripts/dev-profile.mjs link 生成 —— 手改会被下次 link 覆盖。',
  '# 插件行以 pnpm link: 依赖 + dsh.profile.bundles 的形式生效（包自己的 cordis.patch.yml）。',
  '# 需要临时覆盖某行配置时，用 home 层补丁或 dsh --patch 覆盖层。',
].join('\n')

const posix = (p) => p.split(sep).join('/')

/** 从包的 bundle patch 文本里提取行引用到的包名（只认 workspace 里存在的名字）。 */
function referencedPackages(patchText, known) {
  const found = new Set()
  for (const line of patchText.split('\n')) {
    const match = /^\s*-?\s*name:\s*'?([^'#\n]+?)'?\s*$/.exec(line)
    if (match === null) continue
    const specifier = match[1].trim()
    if (specifier === '' || specifier.startsWith('@') || specifier.startsWith('cordis:') || specifier.startsWith('file:')) continue
    const packageName = specifier.split('/')[0]
    if (known.has(packageName)) found.add(packageName)
  }
  return found
}

/** 选定包 + 其 patch 引用闭包。 */
function selectPlugins(names) {
  const packages = workspacePackages()
  const registry = registeredPlugins()
  const byName = new Map(registry.map((record) => [record.name, record]))
  const seed = names.length === 0 ? registry.map((record) => record.name) : names
  const selected = new Map()
  const queue = [...seed]
  while (queue.length > 0) {
    const name = queue.shift()
    if (selected.has(name)) continue
    const record = byName.get(name)
    if (record === undefined) {
      const known = packages.get(name)
      if (known === undefined) {
        log.warn(`未知包 ${name}（既不在 plugin-registry.json，也不在 packages/），已跳过`)
        continue
      }
      const described = describePackage(known)
      selected.set(name, described)
      continue
    }
    selected.set(name, record)
    const patchRel = record.pkg.dsh?.bundle?.patch
    if (patchRel === undefined) continue
    const patchPath = join(record.dir, patchRel)
    if (!exists(patchPath)) continue
    for (const dep of referencedPackages(readText(patchPath), packages)) {
      if (!selected.has(dep)) queue.push(dep)
    }
  }
  return [...selected.values()]
}

/**
 * 清空 profile 的 node_modules / lockfile。
 * link 与 install 两种形态的 node_modules 布局不同（junction vs 拷贝），
 * Windows 下混着改会让 pnpm 在 rename 阶段 EPERM；沙箱 profile 每次切模式都从干净态装。
 */
function resetProfileModules() {
  const modules = join(PROFILE_DIR, 'node_modules')
  if (existsSync(modules)) {
    rmSync(modules, { recursive: true, force: true })
    log.info('已清理 profile node_modules（link/install 模式切换残留）')
  }
  const lock = join(PROFILE_DIR, 'pnpm-lock.yaml')
  if (existsSync(lock)) rmSync(lock, { force: true })
}

/** 一个 bundle 包能否安全加载：宿主入口（若有）与客户端产物（若声明）都齐。 */
const usable = (record) =>
  record.entryRel === undefined || (record.entryReady && (!record.clientHalf || record.clientReady))

/** 生成 profile 补丁：hmr 行（窄监听根）+ 可选的额外行。 */
function buildProfilePatch(linked) {
  const roots = []
  for (const record of linked) {
    const libDir = join(record.dir, 'lib')
    if (existsSync(libDir)) roots.push(posix(relative(ROOT, libDir)))
  }
  roots.sort()

  const baseUrl = posix(relative(PROFILE_DIR, ROOT)) + '/'
  const entries = []
  if (roots.length > 0) {
    entries.push({
      id: 'hmr',
      disabled: false,
      config: {
        base: baseUrl,
        root: roots,
        ignored: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
      },
    })
  }
  if (entries.length === 0) return PATCH_HEADER + '\n[]\n'
  return PATCH_HEADER + '\n' + yaml(entries)
}

function link() {
  const linked = selectPlugins(requested)
  if (linked.length === 0) {
    log.fail('没有可链接的包（先 pnpm -r build 生成 lib/ 产物）')
    process.exit(1)
  }

  const manifest = exists(PROFILE_MANIFEST)
    ? readJson(PROFILE_MANIFEST)
    : { name: `dsh-profile-${PROFILE}`, private: true, dependencies: {} }
  manifest.dependencies = manifest.dependencies ?? {}
  for (const key of Object.keys(manifest.dependencies)) {
    if (String(manifest.dependencies[key]).startsWith('file:')) {
      log.info(`清理旧的 tarball 依赖 ${key}`)
      delete manifest.dependencies[key]
    }
  }

  const notBuilt = []
  const skipped = []
  for (const record of linked) {
    manifest.dependencies[record.name] = 'link:' + record.dir
    if (record.entryRel !== undefined && !record.entryReady) notBuilt.push(record.name)
    if (record.clientHalf && !record.clientReady) notBuilt.push(`${record.name}(client)`)
  }

  // 能作为 bundle 行加载的条件：声明了 bundle 补丁；宿主入口存在（或本来就没有入口，
  // 例如只带 cordis.patch.yml 的安装入口包）；声明了 dsh.client 的包其客户端产物必须存在，
  // 否则 client-modules 会在激活时 fail-loud 打断整个实例。
  const loadable = (record) =>
    record.bundlePatch &&
    (record.entryRel === undefined || record.entryReady) &&
    (!record.clientHalf || record.clientReady)
  const bundleNames = linked.filter(loadable).map((record) => record.name)
  for (const record of linked) {
    if (record.bundlePatch && !loadable(record)) skipped.push(record.name)
  }
  manifest.dsh = manifest.dsh ?? { profile: {} }
  manifest.dsh.profile = { ...manifest.dsh.profile, bundles: [...BUNDLES_BASE, ...bundleNames], patchReload: 'live' }
  writeJson(PROFILE_MANIFEST, manifest)
  log.ok(`profile 依赖：${linked.length} 个 link: 包；bundle 行：${bundleNames.length} 个`)

  writeText(PROFILE_WORKSPACE, 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')
  writeText(PROFILE_PATCH, buildProfilePatch(linked))
  const hmrRoots = linked.filter((record) => existsSync(join(record.dir, 'lib'))).length
  log.ok(`profile 补丁已写入（宿主 HMR 监听 ${hmrRoots} 个 lib 目录）`)

  if (notBuilt.length > 0) {
    log.warn(`以下包缺少构建产物，已作为 link 依赖但不会加载：${notBuilt.join(', ')}`)
    log.info('先跑 pnpm -r build 再重试 link')
  }
  if (skipped.length > 0) {
    log.warn(`以下 bundle 包因产物不全被跳过（不加载）：${skipped.join(', ')}`)
  }

  log.step('pnpm install（只建 junction，不联网）')
  resetProfileModules()
  runPnpm(['install', '--prod', '--config.confirmModulesPurge=false'], { cwd: PROFILE_DIR })

  log.ok(`完成。启动：pnpm sandbox:up（dsh --profile ${PROFILE} --port ${PORT} --no-open）`)
  log.info('改 packages/*/src 后跑该包 build（或 pnpm -r build）：客户端自动热替换，宿主按 hmr 行热更。')
}

/**
 * install 通道：走与普通用户一致的 pack→tarball 路径装进沙箱 profile。
 * 与 link 通道互斥（同一个 profile 不能既 link 又 install）。
 */
function install() {
  const selected = selectPlugins(requested)
  const strict = argv.includes('--strict')
  const wantBuild = argv.includes('--build')

  // 0) 产物预检：缺产物的包会在 tarball 里缺入口，宁可先报清楚
  const missing = selected.filter((record) => !usable(record)).map((record) => record.name)
  if (missing.length > 0 && !strict) {
    log.fail(`以下包缺构建产物，无法保真安装：${missing.join(', ')}`)
    log.info('先 `pnpm -r build`，或用 `pnpm --filter <pkg> build` 逐个补齐；')
    log.info('确实要连带暴露打包问题，用 `--strict`（会让沙箱实例启动失败）。')
    process.exit(1)
  }

  // 1) 先把 bundles 写好（install-profile 不动它），install 的插件才有行可加载
  const manifest = exists(PROFILE_MANIFEST)
    ? readJson(PROFILE_MANIFEST)
    : { name: `dsh-profile-${PROFILE}`, private: true, dependencies: {} }
  const bundleNames = selected.filter((record) => record.bundlePatch && (strict || usable(record))).map((record) => record.name)
  const skipped = selected.filter((record) => record.bundlePatch && !bundleNames.includes(record.name)).map((record) => record.name)
  manifest.dsh = manifest.dsh ?? { profile: {} }
  manifest.dsh.profile = { ...manifest.dsh.profile, bundles: [...BUNDLES_BASE, ...bundleNames], patchReload: 'live' }
  // 依赖交给 install-profile 写（它会清掉 link: 残留）
  writeJson(PROFILE_MANIFEST, manifest)
  writeText(PROFILE_PATCH, PATCH_HEADER.replace('link 生成', 'install 生成') + '\n[]\n')

  if (skipped.length > 0) {
    log.warn(`以下包缺产物，本次不作为 bundle 行（--strict 可强制纳入以暴露打包问题）：${skipped.join(', ')}`)
  }

  // 2) 走 tarball 安装
  log.step(`tarball 安装（profile=${PROFILE} home=${SANDBOX_HOME}）`)
  resetProfileModules()
  const only = selected.map((record) => record.name).join(',')
  const buildFlag = wantBuild ? '' : ' --no-build'
  runShell(
    `node ${JSON.stringify(join(ROOT, 'scripts', 'install-profile.mjs'))} ${PROFILE} --home ${JSON.stringify(SANDBOX_HOME)} --only ${only}${buildFlag}`,
    { cwd: ROOT },
  )

  // 3) 校验解析结果：必须是拷贝（HardLink/Copy），不能是 junction（活链接）
  const linked = []
  for (const record of selected) {
    const installed = join(PROFILE_DIR, 'node_modules', record.name)
    if (!existsSync(installed)) {
      linked.push(`${record.name}: 未安装`)
      continue
    }
    const stat = lstatSync(installed)
    const kind = stat.isSymbolicLink() ? 'symlink/junction(✗ 活链接)' : 'copy/hardlink(✓)'
    linked.push(`${record.name}: ${kind}`)
  }
  log.step('解析形态校验')
  for (const line of linked) log.info(line)
  const bad = linked.filter((line) => line.includes('✗') || line.includes('未安装'))
  if (bad.length > 0) {
    log.fail(`有 ${bad.length} 个包不是 tarball 拷贝形态，install 通道不保真`)
    process.exitCode = 1
  } else {
    log.ok('全部为 tarball 拷贝形态（与用户安装一致）')
  }
  // 4) 启动冒烟：装成功 ≠ 起得来。这一步真的起一个实例（默认临时端口），断言
  //    「不抛异常 + 页面能开 + 每个模块不崩」——`install-profile` 只打印过那行命令。
  if (argv.includes('--no-smoke')) {
    log.warn('--no-smoke：跳过启动冒烟（pnpm sandbox:smoke 可单独跑）')
  } else {
    log.step('启动冒烟（真的起一个实例：不抛异常 / 页面能开 / 模块不崩）')
    try {
      runShell(`node ${JSON.stringify(join(ROOT, 'dev-harness', 'boot-check.mjs'))}`, { cwd: ROOT })
    } catch {
      log.fail('启动冒烟未通过：装出来的宿主起不来或页面崩（日志见上；--no-smoke 可临时跳过）')
      process.exit(1)
    }
  }
  log.info(`启动：pnpm sandbox:up（install 通道无 HMR，改码需重跑 sandbox:install + 重启）`)
}

function unlink() {  if (!exists(PROFILE_MANIFEST)) {
    log.warn('profile 不存在，无需 unlink')
    return
  }
  const manifest = readJson(PROFILE_MANIFEST)
  manifest.dependencies = {}
  manifest.dsh = manifest.dsh ?? { profile: {} }
  manifest.dsh.profile = { ...manifest.dsh.profile, bundles: [...BUNDLES_BASE], patchReload: 'live' }
  writeJson(PROFILE_MANIFEST, manifest)
  writeText(PROFILE_PATCH, PATCH_HEADER + '\n[]\n')
  log.ok('已清空 link 依赖、插件 bundle 行与 profile 补丁（node_modules 下次 install 时收敛）')
}

function list() {
  const manifest = exists(PROFILE_MANIFEST) ? readJson(PROFILE_MANIFEST) : { dependencies: {}, dsh: {} }
  const bundles = new Set(manifest.dsh?.profile?.bundles ?? [])
  const registry = new Map(registeredPlugins().map((record) => [record.name, record]))
  log.step('workspace 包画像（★ = plugin-registry 已登记）')
  const rows = [...workspacePackages().values()].map(describePackage).sort((a, b) => a.name.localeCompare(b.name))
  for (const record of rows) {
    const hostMark = record.entryRel === undefined ? '  —  ' : record.entryReady ? 'host✓' : 'host✗'
    const marks = [
      registry.has(record.name) ? '★' : ' ',
      record.bundlePatch ? 'bundle' : '      ',
      hostMark,
      record.clientHalf ? (record.clientReady ? 'client✓' : 'client✗') : '        ',
      record.name in (manifest.dependencies ?? {}) ? 'linked' : '      ',
      bundles.has(record.name) ? 'in-bundles' : '          ',
    ]
    console.log(`  ${marks.join('  ')}  ${record.name}  (${record.rel})`)
  }
  log.info('host✗ = 声明了入口但还没构建（pnpm -r build）；host— = 本来就没有宿主入口（纯 patch 安装包）')
}

function status() {
  if (!exists(PROFILE_MANIFEST)) {
    log.fail(`profile 不存在：${PROFILE_DIR}（先 pnpm sandbox:init）`)
    process.exit(1)
  }
  const manifest = readJson(PROFILE_MANIFEST)
  log.step(`沙箱 profile：${PROFILE}  (${PROFILE_DIR})`)
  log.info(`DSH_HOME = ${join(PROFILE_DIR, '..', '..')}`)
  console.log('  bundles:')
  for (const name of manifest.dsh?.profile?.bundles ?? []) console.log('    - ' + name)
  console.log('  link 依赖:')
  for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
    console.log(`    - ${name} → ${String(spec).replace(/^link:/, '')}`)
  }
  const patch = exists(PROFILE_PATCH) ? readText(PROFILE_PATCH).trim() : '(缺失)'
  console.log('  profile 补丁:')
  for (const line of patch.split('\n')) console.log('    ' + line)
}

switch (command) {
  case 'link':
    link()
    break
  case 'install':
    install()
    break
  case 'unlink':
    unlink()
    break
  case 'list':
    list()
    break
  case 'status':
    status()
    break
  default:
    log.fail(`未知子命令 ${command}（可用：link | install | unlink | list | status）`)
    process.exit(1)
}
