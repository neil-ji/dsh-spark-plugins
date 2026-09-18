/**
 * workspace 包索引、依赖闭包与 `pnpm pack` 的统一实现。
 *
 * 被 scripts/install-profile.mjs（源码安装）与 scripts/pack-release.mjs（发版打包）共用，
 * 保证两条路径算出的闭包、产物文件名、依赖改写完全一致。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, resolve, sep } from 'node:path'

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))
const posix = (path) => path.split(sep).join('/')

/** packages/* 下的全部 workspace 包：包名 -> {name, dir, rel, pkg}。 */
export function readWorkspacePackages(root) {
  const packagesDir = join(root, 'packages')
  const map = new Map()
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = join(packagesDir, entry.name)
    const manifest = join(dir, 'package.json')
    if (!existsSync(manifest)) continue
    try {
      const pkg = readJson(manifest)
      if (typeof pkg.name === 'string') map.set(pkg.name, { name: pkg.name, dir, rel: posix(join('packages', entry.name)), pkg })
    } catch {
      /* 非包目录 / 坏清单 */
    }
  }
  return map
}

/**
 * registry 插件 + 其 workspace 依赖闭包。
 * @param {string} root - 仓库根
 * @param {Map} packages - readWorkspacePackages 的结果
 * @param {string[]} [only] - 只装这些 registry 插件（缺省全部）
 * @returns {{selected: string[], closure: Map<string, object>}}
 */
export function computeClosure(root, packages, only) {
  const registry = readJson(join(root, 'plugin-registry.json'))
  const selected = []
  for (const [name, rel] of Object.entries(registry.plugins ?? {})) {
    if (only !== undefined && only.length > 0 && !only.includes(name)) continue
    const record = [...packages.values()].find((candidate) => candidate.rel === posix(rel))
    if (record === undefined) throw new Error(`plugin-registry.json 的 ${name} (${rel}) 在 packages/ 下找不到`)
    selected.push(name)
  }
  const closure = new Map()
  const queue = [...selected]
  while (queue.length > 0) {
    const name = queue.shift()
    if (closure.has(name)) continue
    const record = packages.get(name)
    if (record === undefined) throw new Error(`workspace 依赖 ${name} 在 packages/ 下找不到`)
    closure.set(name, record)
    for (const [dep, spec] of Object.entries(record.pkg.dependencies ?? {})) {
      if (String(spec).startsWith('workspace:')) queue.push(dep)
    }
  }
  return { selected, closure }
}

/** pnpm pack 的产物文件名（@scope/name → scope-name）。 */
export function tarballName(name, version) {
  return `${name.replace(/^@/, '').replace(/\//g, '-')}-${version}.tgz`
}

/** 把 workspace:^ / workspace:* / workspace:~ 改写成具体 semver（与 pnpm pack 一致）。 */
export function rewrittenDependencies(pkg, versionOf) {
  const out = {}
  for (const [dep, spec] of Object.entries(pkg.dependencies ?? {})) {
    const text = String(spec)
    if (!text.startsWith('workspace:')) {
      out[dep] = text
      continue
    }
    const version = versionOf(dep)
    if (version === undefined) throw new Error(`workspace 依赖 ${dep} 没有版本信息`)
    const range = text.slice('workspace:'.length)
    out[dep] = range === '*' || range === '' ? version : range === '^' ? `^${version}` : range === '~' ? `~${version}` : range
  }
  return out
}

/**
 * 对闭包里的每个包执行 `pnpm pack`。
 * @returns {Map<string, {name, version, file, bundle, plugin, deps}>}
 */
export function packClosure({ packDir, closure, selected = [], log = console.log }) {
  rmSync(packDir, { recursive: true, force: true })
  mkdirSync(packDir, { recursive: true })
  const versionOf = (name) => closure.get(name)?.pkg.version
  const packed = new Map()
  for (const [name, record] of closure) {
    execSync(`pnpm pack --pack-destination ${JSON.stringify(packDir)}`, { cwd: record.dir, stdio: 'pipe' })
    const file = join(packDir, tarballName(name, record.pkg.version))
    if (!existsSync(file)) throw new Error(`pnpm pack 未产出 ${file}`)
    packed.set(name, {
      name,
      version: record.pkg.version,
      file,
      bundle: typeof record.pkg.dsh?.bundle?.patch === 'string',
      plugin: selected.includes(name),
      deps: rewrittenDependencies(record.pkg, versionOf),
    })
    log(`  packed ${name}@${record.pkg.version}`)
  }
  return packed
}

/**
 * 产物完整性预检：声明了入口就必须有产物，声明了 dsh.client 就必须有客户端 bundle，
 * 声明了 dsh.bundle.patch 就必须有补丁文件。
 *
 * 最后一条是防「bundle 行指向一个补丁文件没打进 tarball 的包」——dsh 的 loadProfileDirectory
 * 解析得到包之后还会去读 dsh.bundle.patch 指向的文件，缺了就 fail-loud，而那时已经装到
 * 用户 profile 里了。在这里拦下来比让用户的宿主起不来便宜得多。
 */
export function missingArtifacts(closure) {
  const missing = []
  for (const [name, record] of closure) {
    const exportsMap = record.pkg.exports ?? {}
    const pick = (key) => {
      const value = exportsMap[key]
      if (typeof value === 'string') return value
      return value?.default
    }
    const entry = pick('.') ?? record.pkg.main
    const client = pick('./client')
    if (entry !== undefined && !existsSync(join(record.dir, entry))) missing.push(`${name}(${entry})`)
    if (record.pkg.dsh?.client?.platform === 'web' && client !== undefined && !existsSync(join(record.dir, client))) {
      missing.push(`${name}(${client})`)
    }
    const bundlePatch = record.pkg.dsh?.bundle?.patch
    if (typeof bundlePatch === 'string' && !existsSync(join(record.dir, bundlePatch))) {
      missing.push(`${name}(${bundlePatch} dsh.bundle.patch)`)
    }
  }
  return missing
}

export { resolve }
