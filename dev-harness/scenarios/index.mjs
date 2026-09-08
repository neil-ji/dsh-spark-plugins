/**
 * dev 场景注册表 —— 线 1（harness）与线 2（沙箱 dsh）共用的「触发按钮」定义。
 *
 * 每个场景：{ id, title, kind, description?, params?, run(host, args) }
 *   host = { ctx, root, entries(), probe(), repoRoot, home }
 *
 * 约定：mutating 场景必须可逆（改产物后自动还原），且只允许写
 * <repo>/packages/**\/lib 与 $DSH_HOME/storages/**。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

const posix = (p) => p.split(sep).join('/')

function packageDirs(repoRoot) {
  const root = join(repoRoot, 'packages')
  if (!existsSync(root)) return new Map()
  const map = new Map()
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = join(root, entry.name)
    const manifest = join(dir, 'package.json')
    if (!existsSync(manifest)) continue
    try {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
      if (typeof pkg.name === 'string') map.set(pkg.name, { dir, pkg })
    } catch {
      /* 忽略无法解析的清单 */
    }
  }
  return map
}

function resolvePackage(repoRoot, name) {
  if (typeof name !== 'string' || name === '') throw new Error('package 参数必填')
  const found = packageDirs(repoRoot).get(name)
  if (found === undefined) throw new Error(`未知包 ${name}`)
  return found
}

/** 被 touch 过的产物原始字节（用于 restore-artifacts 兜底还原）。 */
const touchedOriginals = new Map()

/** 在 profile node_modules 里找已安装的产物（install 通道的保真对象）。 */
function installedArtifact(home, packageName, artifactRel) {
  if (typeof home !== 'string' || home === '') throw new Error('DSH_HOME 未设置')
  const profilesDir = join(home, 'profiles')
  if (!existsSync(profilesDir)) throw new Error(`profiles 目录不存在：${profilesDir}`)
  for (const entry of readdirSync(profilesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const file = join(profilesDir, entry.name, 'node_modules', packageName, artifactRel)
    if (existsSync(file)) return file
  }
  throw new Error(`在 ${profilesDir}/*/node_modules/${packageName}/${artifactRel} 找不到已安装产物`)
}

/** 修改一个已构建产物以触发 HMR；可选自动还原。 */
function touchArtifact(host, packageName, artifactRel, restoreMs, where = 'repo') {
  const file =
    where === 'installed'
      ? installedArtifact(host.home, packageName, artifactRel)
      : join(resolvePackage(host.repoRoot, packageName).dir, artifactRel)
  if (!existsSync(file)) throw new Error(`产物不存在：${file}（先 pnpm -r build 或 sandbox:install）`)
  const before = readFileSync(file)
  if (!touchedOriginals.has(file)) touchedOriginals.set(file, before)
  const marker = `\n// dev-control touch ${new Date().toISOString()}\n`
  writeFileSync(file, Buffer.concat([before, Buffer.from(marker)]))
  const after = statSync(file)
  const report = {
    package: packageName,
    where,
    file,
    relFile: posix(relative(host.repoRoot, file)),
    bytesBefore: before.length,
    bytesAfter: after.size,
    mtimeMs: after.mtimeMs,
    restored: false,
  }
  const delay = Number(restoreMs ?? 0)
  if (Number.isFinite(delay) && delay > 0) {
    setTimeout(() => {
      writeFileSync(file, before)
      report.restored = true
    }, delay).unref?.()
    report.restoreInMs = delay
  }
  return report
}

/** 只允许写 $DSH_HOME/storages 下的相对路径。 */
function storageTarget(home, target) {
  if (typeof home !== 'string' || home === '') throw new Error('DSH_HOME 未设置')
  if (typeof target !== 'string' || target === '') throw new Error('target 参数必填')
  const base = join(home, 'storages')
  const abs = resolve(base, target)
  if (abs !== base && !abs.startsWith(base + sep)) throw new Error(`拒绝越界路径：${target}`)
  return abs
}

export const scenarios = [
  {
    id: 'ping',
    title: '探活',
    kind: 'safe',
    description: '确认控制平面在线（面板/CI 的首个断言）。',
    run: () => ({ ok: true, at: new Date().toISOString() }),
  },
  {
    id: 'entries',
    title: '列出 loader 条目',
    kind: 'safe',
    description: '每个条目的 id / specifier / fiber 状态（2 = ACTIVE）。',
    run: (host) => host.entries(),
  },
  {
    id: 'client-graph',
    title: '列出客户端 boot 图',
    kind: 'safe',
    description: '当前 /plugins 图的 rev 与每个客户端插件的 rev。',
    run: (host) => {
      const modules = host.root.get('clientModules')
      if (modules === undefined) throw new Error('clientModules 服务不可用（非 web profile？）')
      const graph = modules.graph()
      return {
        rev: graph?.rev,
        entries: (graph?.entries ?? []).map((entry) => ({ id: entry.id, rev: entry.rev })),
      }
    },
  },
  {
    id: 'touch-client-bundle',
    title: '触发客户端 HMR',
    kind: 'mutating',
    description: '给指定包的 lib/client.js 追加一行注释（默认 2s 后还原），验证 /plugins/events 的 rebuilt 帧。',
    params: [
      { name: 'package', label: '包名', default: 'dsh-connector-npm-ui' },
      { name: 'restoreMs', label: '还原延迟(ms)', default: 2000 },
      { name: 'where', label: 'repo|installed', default: 'repo' },
    ],
    run: (host, args) =>
      touchArtifact(host, args.package ?? 'dsh-connector-npm-ui', 'lib/client.js', args.restoreMs ?? 2000, args.where ?? 'repo'),
  },
  {
    id: 'touch-host-bundle',
    title: '触发宿主 HMR',
    kind: 'mutating',
    description: '给指定包的 lib/index.js 追加一行注释（默认 2s 后还原）。需要 profile 补丁里的 hmr 行覆盖该包 lib。',
    params: [
      { name: 'package', label: '包名', default: 'dsh-spark' },
      { name: 'restoreMs', label: '还原延迟(ms)', default: 2000 },
      { name: 'where', label: 'repo|installed', default: 'repo' },
    ],
    run: (host, args) =>
      touchArtifact(host, args.package ?? 'dsh-spark', 'lib/index.js', args.restoreMs ?? 2000, args.where ?? 'repo'),
  },
  {
    id: 'restore-artifacts',
    title: '还原被改动的产物',
    kind: 'safe',
    description: '把所有 touch-* 场景改过的 lib 产物写回原始字节（验收收尾用）。',
    run: () => {
      const restored = []
      for (const [file, bytes] of touchedOriginals) {
        writeFileSync(file, bytes)
        restored.push(file)
      }
      touchedOriginals.clear()
      return { restored }
    },
  },
  {
    id: 'clear-storage',
    title: '清空插件存储',
    kind: 'mutating',
    description: '删除 $DSH_HOME/storages 下的文件或目录（相对路径，禁止越界）。',
    params: [{ name: 'target', label: '相对路径', default: 'sparks.jsonl' }],
    run: (host, args) => {
      const abs = storageTarget(host.home, args.target)
      if (!existsSync(abs)) return { deleted: false, path: abs }
      rmSync(abs, { recursive: true, force: true })
      return { deleted: true, path: abs }
    },
  },
  {
    id: 'write-fixture',
    title: '写入存储 fixture',
    kind: 'mutating',
    description: '把 .dev/fixtures/<fixture> 复制到 $DSH_HOME/storages/<target>，用于构造确定性数据。',
    params: [
      { name: 'fixture', label: 'fixture 文件', default: '' },
      { name: 'target', label: '目标相对路径', default: '' },
    ],
    run: (host, args) => {
      if (!args.fixture) throw new Error('fixture 参数必填（.dev/fixtures 下的文件名）')
      const source = resolve(join(host.repoRoot, '.dev', 'fixtures'), args.fixture)
      const fixtureRoot = resolve(join(host.repoRoot, '.dev', 'fixtures'))
      if (!source.startsWith(fixtureRoot + sep) && source !== fixtureRoot) throw new Error('fixture 越界')
      if (!existsSync(source)) throw new Error(`fixture 不存在：${source}`)
      const abs = storageTarget(host.home, args.target ?? args.fixture)
      mkdirSync(dirname(abs), { recursive: true })
      copyFileSync(source, abs)
      return { copied: posix(relative(host.repoRoot, source)), to: abs }
    },
  },
]
