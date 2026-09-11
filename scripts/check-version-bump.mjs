/**
 * 版本纪律闸门：**同一个 commit 里改了插件的发布输入，就必须改这个包的 version**。
 *
 * 为什么需要它：dsh 的 client-modules 按「插件版本」缓存产物字节，改了码不 bump 版本，
 * 宿主会继续供旧字节（README「版本纪律」一节，2026-09 反复踩过）。靠人记必然漏，
 * 所以做成闸门：逐个 commit 检查 `packages/<pkg>/` 的**非注释**改动是否伴随版本变更。
 *
 * 判定细则：
 *  - 只算「发布输入」：`src/**`、`build.mjs`、`tsdown.config.mjs`、`cordis.patch.yml`、
 *    `package.json`；测试 / 文档 / 产物（lib、dist）不算。
 *  - 只改注释/空白的文件不算改动（剥离注释后逐字节比较），避免"加一行说明就得发版"。
 *  - merge commit 跳过（它的改动属于被合并的分支，各自已在那些 commit 里检查过）。
 *
 * 用法：
 *   node scripts/check-version-bump.mjs [--base <ref>] [--json] [--warn-only]
 * 基线解析顺序：--base → $DSH_VERSION_BASE → origin/$GITHUB_BASE_REF → 最近的 v* tag → HEAD^
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { stripComments } from './check-architecture.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** 发布输入：这些路径下的改动会影响产物字节。 */
const SHIPPING_RE = /^(src\/|build\.mjs$|tsdown\.config\.mjs$|cordis\.patch\.yml$|package\.json$)/
/** 明确不影响发布产物的路径。 */
const NON_SHIPPING_RE = /^(tests?\/|.*\.md$|lib\/|dist\/|\.pack-profile\/)/

/** 判断一个仓库相对路径是否属于发布输入。 */
export function isShippingInput(relPathInPackage) {
  const path = relPathInPackage.split('\\').join('/')
  if (NON_SHIPPING_RE.test(path)) return false
  return SHIPPING_RE.test(path)
}

/**
 * 把 commit 的改动文件按包归组，只保留发布输入。
 * @param {string[]} files - 仓库相对路径（POSIX）
 * @returns {Map<string, string[]>} packages/<dir> → 该包下的发布输入文件
 */
export function shippingInputsByPackage(files) {
  const map = new Map()
  for (const file of files) {
    const match = /^(packages\/[^/]+)\/(.+)$/.exec(file.split('\\').join('/'))
    if (match === null) continue
    const [, pkgRel, inner] = match
    if (!isShippingInput(inner)) continue
    const list = map.get(pkgRel) ?? []
    list.push(file)
    map.set(pkgRel, list)
  }
  return map
}

/** 剥离注释与空白后比较：只有注释/格式变化的文件不算发布改动。 */
export function isRealChange(before, after) {
  const normalize = (text) => stripComments(text).replace(/\s+/g, ' ').trim()
  return normalize(before) !== normalize(after)
}

/**
 * 判定一个 commit 是否违规（纯函数，便于单测）。
 * @param {{files: string[], realChanges: (file: string) => boolean, versionBefore: (pkgRel: string) => string | undefined, versionAfter: (pkgRel: string) => string | undefined}} input
 * @returns {{violations: {pkgRel: string, files: string[], from?: string, to?: string}[], checked: number}}
 */
export function evaluateCommit({ files, realChanges, versionBefore, versionAfter }) {
  const violations = []
  let checked = 0
  for (const [pkgRel, inputs] of shippingInputsByPackage(files)) {
    const changed = inputs.filter((file) => realChanges(file))
    if (changed.length === 0) continue
    checked += 1
    const from = versionBefore(pkgRel)
    const to = versionAfter(pkgRel)
    // 新包（before 不存在）或包被删除（after 不存在）不算违规。
    if (from === undefined || to === undefined) continue
    if (from !== to) continue
    violations.push({ pkgRel, files: changed, from, to })
  }
  return { violations, checked }
}

/* ──────────────────────────── git 管线 ──────────────────────────── */

const git = (args) => execFileSync('git', args, {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  // stderr 必须吞掉：`git show <ref>:<path>` 在文件新增/删除时会以 1 退出，
  // 那是预期路径（由 catch 处理），不该把 fatal 噪音喷进 CI 日志。
  stdio: ['ignore', 'pipe', 'pipe'],
})

function resolveBase(explicit) {
  if (explicit !== undefined) return explicit
  if (process.env.DSH_VERSION_BASE !== undefined && process.env.DSH_VERSION_BASE !== '') return process.env.DSH_VERSION_BASE
  const baseRef = process.env.GITHUB_BASE_REF
  if (baseRef !== undefined && baseRef !== '') {
    try {
      git(['rev-parse', '--verify', `origin/${baseRef}`])
      return `origin/${baseRef}`
    } catch { /* 本地没有该远端分支，继续回退 */ }
  }
  try {
    git(['rev-parse', '--verify', 'HEAD^'])
    return 'HEAD^'
  } catch { /* 首个 commit */ }
  try {
    return git(['describe', '--tags', '--abbrev=0', '--match', 'v*']).trim()
  } catch {
    return null
  }
}

const showFile = (ref, path) => {
  try {
    return git(['show', `${ref}:${path}`])
  } catch {
    return null
  }
}

const versionOf = (ref, pkgRel) => {
  const text = showFile(ref, `${pkgRel}/package.json`)
  if (text === null) return undefined
  try {
    return JSON.parse(text).version
  } catch {
    return undefined
  }
}

function parseArgs(argv) {
  const options = { base: undefined, json: false, warnOnly: false, sinceRelease: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') options.json = true
    else if (arg === '--warn-only') options.warnOnly = true
    else if (arg === '--since-release') options.sinceRelease = true
    else if (arg === '--base') options.base = argv[index + 1]
    else if (arg.startsWith('--base=')) options.base = arg.slice('--base='.length)
  }
  return options
}

function main(argv) {
  const options = parseArgs(argv)
  const base = options.sinceRelease
    ? (() => {
        try {
          return git(['describe', '--tags', '--abbrev=0', '--match', 'v*']).trim()
        } catch {
          return null
        }
      })()
    : resolveBase(options.base)
  if (base === null) {
    console.log('══ 版本纪律 ══\n  ok    没有可比基线（首个 commit），跳过')
    return
  }
  let commits = []
  try {
    commits = git(['log', '--no-merges', '--format=%H', `${base}..HEAD`]).split('\n').filter(Boolean)
  } catch (error) {
    console.log(`══ 版本纪律 ══\n  warn  无法解析基线 ${base}：${String(error.message).split('\n')[0]}`)
    return
  }
  const findings = []
  for (const sha of commits) {
    const files = git(['show', '--name-only', '--format=', sha]).split('\n').map((line) => line.trim()).filter(Boolean)
    if (files.length === 0) continue
    const cache = new Map()
    const realChanges = (file) => {
      if (!cache.has(file)) {
        const after = showFile(sha, file)
        const before = showFile(`${sha}^`, file)
        // 新增文件：before 为 null → 算真实改动；删除文件：after 为 null → 算真实改动。
        cache.set(file, before === null || after === null ? true : isRealChange(before, after))
      }
      return cache.get(file)
    }
    const { violations } = evaluateCommit({
      files,
      realChanges,
      versionBefore: (pkgRel) => versionOf(`${sha}^`, pkgRel),
      versionAfter: (pkgRel) => versionOf(sha, pkgRel),
    })
    const subject = git(['show', '-s', '--format=%s', sha]).trim()
    for (const violation of violations) {
      findings.push({ sha: sha.slice(0, 8), subject, ...violation })
    }
  }
  const report = { base, commits: commits.length, violations: findings }
  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
    process.exitCode = findings.length > 0 && !options.warnOnly ? 1 : 0
    return
  }
  console.log(`══ 版本纪律（基线 ${base}，检查 ${commits.length} 个 commit） ══`)
  if (findings.length === 0) {
    console.log('  ok    每个改动发布输入的 commit 都带了版本 bump')
  }
  for (const finding of findings) {
    console.log(`  FAIL  ${finding.sha} ${finding.pkgRel}@${finding.from} 未 bump（改了 ${finding.files.length} 个发布输入）`)
    for (const file of finding.files.slice(0, 5)) console.log(`          ${file}`)
    if (finding.files.length > 5) console.log(`          … 其余 ${finding.files.length - 5} 个`)
    console.log(`          提交：${finding.subject}`)
  }
  const verdict = findings.length > 0 ? (options.warnOnly ? 'WARN' : 'FAIL') : 'PASS'
  console.log(`\n合计：${findings.length} 个 commit 漏 bump\n结果：${verdict}`)
  console.log('（处置：在漏 bump 的那个 commit 里抬 version，或追加一个只抬版本的 commit 后 rebase 合并；')
  console.log('  确实只想改注释/测试时无需 bump —— 闸门剥离注释后逐字节比较，注释改动不会触发）')
  process.exitCode = findings.length > 0 && !options.warnOnly ? 1 : 0
}

if (process.argv[1] !== undefined && process.argv[1].split('\\').join('/').endsWith('scripts/check-version-bump.mjs')) {
  main(process.argv.slice(2))
}
