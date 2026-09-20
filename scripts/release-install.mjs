#!/usr/bin/env node
/**
 * 从 GitHub Release 安装 / 升级 dsh-spark-plugins（普通用户路径）。
 *
 * 不 clone 仓库、不跑 pnpm install / pnpm build：只下载 CI 预构建的 tarball，
 * 校验 sha256，然后写进目标 dsh profile（与 `dsh plugin add` 同形态的 file: 依赖 + overrides）。
 *
 * dsh 兼容策略：**只保证与最新 dsh 兼容**。清单里的 `dsh.tested` 是打包环境实际验证过的版本，
 * 本机 `dsh --version` 与之不一致只告警（`--strict-version` 可改成硬失败）。
 *
 * 本文件由 scripts/pack-release.mjs 用 esbuild 打成单文件资产 release-install.mjs 上传，
 * 也可以直接在仓库里 `node scripts/release-install.mjs ...` 跑（两者行为一致）。
 *
 * 用法：
 *   node release-install.mjs [--version v0.2.0] [--profile web] [--home <dir>]
 *                            [--only a,b] [--base-url <url|dir>] [--cache <dir>]
 *                            [--dry-run] [--force] [--strict-version]
 */
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { installIntoProfile } from './lib/profile-install.mjs'
import { writeState } from './lib/profile-uninstall.mjs'

const REPO = 'https://github.com/neil-ji/dsh-spark-plugins'
const DEFAULT_BASE = `${REPO}/releases/latest/download`

function parseArgs(argv) {
  const flags = { profile: 'web' }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--version') flags.version = argv[++index]
    else if (arg === '--tag') flags.version = argv[++index]
    else if (arg === '--profile') flags.profile = argv[++index]
    else if (arg === '--home') flags.home = argv[++index]
    else if (arg === '--cache') flags.cache = argv[++index]
    else if (arg === '--base-url') flags.baseUrl = argv[++index]
    else if (arg === '--only') flags.only = [...(flags.only ?? []), ...String(argv[++index]).split(',').map((s) => s.trim()).filter(Boolean)]
    else if (arg === '--dry-run') flags.dryRun = true
    else if (arg === '--force') flags.force = true
    else if (arg === '--strict-version') flags.strictVersion = true
    else if (arg.startsWith('--')) throw new Error(`未知参数 ${arg}`)
    else throw new Error(`未知位置参数 ${arg}`)
  }
  return flags
}

// ── 极简 semver 比较（够用即可：>=0.1.1-rc.2 <0.2.0-0 这类区间） ──────────────
function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(value).trim())
  if (match === null) return undefined
  return { major: +match[1], minor: +match[2], patch: +match[3], pre: match[4] }
}

function compareVersions(a, b) {
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1
  }
  if (a.pre === b.pre) return 0
  if (a.pre === undefined) return 1
  if (b.pre === undefined) return -1
  return a.pre < b.pre ? -1 : 1
}

export function satisfies(version, range) {
  const parsed = parseVersion(version)
  if (parsed === undefined || typeof range !== 'string' || range.trim() === '') return undefined
  // caret 的 npm 语义：major>0 锁 major；0.x 锁 minor；0.0.x 锁 patch。
  const caretUpper = (target) => {
    if (target.major > 0) return (value) => value.major === target.major
    if (target.minor > 0) return (value) => value.major === 0 && value.minor === target.minor
    return (value) => value.major === 0 && value.minor === 0 && value.patch === target.patch
  }
  for (const raw of range.trim().split(/\s+/)) {
    const match = /^(>=|<=|>|<|=|\^|~)?(.+)$/.exec(raw)
    if (match === null) continue
    const operator = match[1] ?? '='
    const target = parseVersion(match[2])
    if (target === undefined) continue
    const cmp = compareVersions(parsed, target)
    const ok =
      operator === '>=' ? cmp >= 0
      : operator === '<=' ? cmp <= 0
      : operator === '>' ? cmp > 0
      : operator === '<' ? cmp < 0
      : operator === '^' ? cmp >= 0 && caretUpper(target)(parsed)
      : operator === '~' ? cmp >= 0 && parsed.major === target.major && parsed.minor === target.minor
      : cmp === 0
    if (!ok) return false
  }
  return true
}

// ── 资产读取：https / file:// / 本地目录 ─────────────────────────────────────
function assetUrl(base, file) {
  if (/^https?:\/\//.test(base)) return new URL(file, base.endsWith('/') ? base : base + '/').href
  if (base.startsWith('file://')) return new URL(file, base.endsWith('/') ? base : base + '/').href
  return join(resolve(base), file)
}

/**
 * 下载一个资产，带重试。
 *
 * 为什么必须重试（2026-09-20 用户实测 `curl | sh` 报 `✗ fetch failed`）：
 * 安装要顺序下 16 个 tarball，而 Node 的 undici 默认**连接超时只有 10s**、
 * 且对同一 host 的突发连接很敏感 —— 实测在第 11 个包上抛
 * `UND_ERR_CONNECT_TIMEOUT`（attempted address: github.com:443）与
 * `UND_ERR_SOCKET`（other side closed）。curl 下同一个 URL 却是 200，
 * 所以这不是"网络不通"，是**客户端没有韧性**。
 *
 * 策略：指数退避重试（默认 6 次尝试），间隔 0.5s→1s→2s→4s→8s（封顶 8s）。
 * 之所以给到 6 次而不是 3~4 次：实测同一个 URL 单次耗时在 0.5s~7s 间波动，
 * 而 undici 的连接超时是 10s —— 突发时的失败是**成片**的，重试窗口太短会连
 * 几轮都落在同一段坏窗口里。6 次退避合计约 15.5s，足以跨过这类抖动。
 *
 * 5xx / 连接类错误都重试；4xx（尤其 404）**不重试** —— 那是资产真的不存在，
 * 重试没意义还会掩盖问题。失败时把底层 cause 一起报出来，不要只留
 * 一个笼统的 "fetch failed"（这正是本次排查困难的根源）。
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function fetchWithRetry(target, { attempts = 6, timeoutMs = 30_000, headers } = {}) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(target, {
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
        ...(headers === undefined ? {} : { headers }),
      })
      if (response.ok) return response
      // 4xx 是确定性的（资产不存在 / 权限），重试无意义
      if (response.status >= 400 && response.status < 500) {
        throw new Error(`下载失败 ${target} → HTTP ${response.status}`)
      }
      lastError = new Error(`下载失败 ${target} → HTTP ${response.status}`)
    } catch (error) {
      // 上面主动抛的 4xx 直接向外传，不做重试
      if (error instanceof Error && /^下载失败 .* HTTP 4\d\d$/.test(error.message)) throw error
      lastError = error
    }
    if (attempt < attempts) {
      // 指数退避，封顶 8s：500 → 1000 → 2000 → 4000 → 8000
      const delay = Math.min(8000, 500 * 2 ** (attempt - 1))
      console.log(`  ! 下载失败（${describeFetchError(lastError)}），${delay}ms 后重试 ${attempt}/${attempts - 1}…`)
      await sleep(delay)
    }
  }
  throw new Error(`下载失败 ${target}（已重试 ${attempts} 次）：${describeFetchError(lastError)}`)
}

/** 把 undici 的嵌套 cause 摊平成一句人话（"fetch failed" 单独出现毫无信息量）。 */
export function describeFetchError(error) {
  if (!(error instanceof Error)) return String(error)
  const cause = error.cause
  const code = cause?.code ?? cause?.errno
  const message = cause?.message ?? cause?.toString?.() ?? ''
  if (code !== undefined || message !== '') return `${error.message} ← ${message}${code === undefined ? '' : ` [${code}]`}`
  return error.message
}

async function readAsset(base, file) {
  const target = assetUrl(base, file)
  if (/^https?:/.test(target)) {
    const response = await fetchWithRetry(target)
    return Buffer.from(await response.arrayBuffer())
  }
  const path = target.startsWith('file://') ? fileURLToPath(target) : target
  if (!existsSync(path)) throw new Error(`资产不存在：${path}`)
  return readFileSync(path)
}

/**
 * 备用通道：`github.com` 连不上时，改走 `api.github.com` 拿同一批资产。
 *
 * 为什么需要（2026-09-20 实测）：`https://github.com/<owner>/<repo>/releases/download/...`
 * 的**第一跳就是 github.com**（拿 302 再到 objects.githubusercontent.com）。
 * 本机网络出现 `github.com` 完全不可达、而 `api.github.com` 与
 * `objects.githubusercontent.com` 都正常的情况 —— 于是安装必然失败，
 * 且重试也救不回来（整段窗口都是坏的）。
 *
 * GitHub API 提供等价下载：列出 release → 按名字取 asset id →
 * `GET /repos/{owner}/{repo}/releases/assets/{id}` + `Accept: application/octet-stream`。
 * 实测同一时刻这条路是通的，能拿到字节完全一致的资产。
 *
 * 仅在主通道最终失败且 base 是 GitHub Release URL 时启用，不做静默降级：
 * 会明确打印用了备用通道，让用户知道发生了什么。
 */
async function resolveViaApi(base) {
  const match = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/(?:download\/([^/]+)|latest\/download)\/?$/.exec(
    base.endsWith('/') ? base.slice(0, -1) : base,
  )
  if (match === null) return undefined
  const [, owner, repo, tag] = match
  const endpoint = tag === undefined
    ? `https://api.github.com/repos/${owner}/${repo}/releases/latest`
    : `https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`
  try {
    const response = await fetchWithRetry(endpoint, { attempts: 3 })
    const release = JSON.parse(Buffer.from(await response.arrayBuffer()).toString('utf8'))
    const byName = new Map((release.assets ?? []).map((asset) => [asset.name, asset]))
    return { owner, repo, byName, describe: `${owner}/${repo}@${release.tag_name}（经 api.github.com）` }
  } catch {
    return undefined
  }
}

/** 走 API 通道读一个资产的字节。 */
async function readAssetViaApi(fallback, file) {
  const asset = fallback.byName.get(file)
  if (asset === undefined) throw new Error(`api.github.com 上没有资产 ${file}`)
  const response = await fetchWithRetry(`https://api.github.com/repos/${fallback.owner}/${fallback.repo}/releases/assets/${asset.id}`, {
    headers: { accept: 'application/octet-stream' },
    attempts: 3,
  })
  return Buffer.from(await response.arrayBuffer())
}

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

function dshVersion() {
  try {
    return execSync('dsh --version', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return undefined
  }
}

// ── 主流程 ───────────────────────────────────────────────────────────────────
/**
 * 安装前必须确认 pnpm 可用。README 长期宣称「不需要 git、不需要 pnpm」，但
 * installIntoProfile 会跑 `pnpm install --lockfile-only` —— 没有 pnpm 的用户会在
 * **profile 已经被改脏之后**才炸掉。所以这里前置检查：早失败、且失败时不留痕。
 * @returns {string | undefined} pnpm 版本
 */
function assertPnpm() {
  try {
    return execSync('pnpm --version', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return undefined
  }
}

export async function releaseInstall(argv = process.argv.slice(2)) {
  const flags = parseArgs(argv)
  const log = (message) => console.log(message)
  const base = flags.baseUrl ?? (flags.version === undefined ? DEFAULT_BASE : `${REPO}/releases/download/${flags.version}`)
  const home = resolve(
    (flags.home ?? process.env['DSH_HOME'] ?? join(homedir(), '.dsh')).replace(/^~(?=$|[/\\])/, homedir()),
  )

  log(`[release-install] 来源 ${base}`)
  log(`[release-install] home=${home} profile=${flags.profile}`)

  // pnpm 前置检查：dry-run 不写 profile，不需要它
  if (!flags.dryRun) {
    const pnpm = assertPnpm()
    if (pnpm === undefined) {
      throw new Error(
        [
          '找不到 pnpm —— 安装需要它把 tarball 解析进 profile 的 node_modules。',
          '  装法（任选一）：',
          '    corepack enable                 # Node 16.9+ 自带 corepack，最省事',
          '    npm install -g pnpm             # 用 npm 全局装',
          '  装完重跑本命令即可；本次尚未改动任何 profile 文件。',
        ].join('\n'),
      )
    }
    log(`[release-install] pnpm ${pnpm}`)
  }

  // 清单也要能吃备用通道：github.com 不可达时它是**第一个**会失败的请求，
// 不在这里兜住的话，后面的下载兜底根本轮不到执行。
  let apiFallback = await (async () => {
    try {
      return { raw: await readAsset(base, 'manifest.json') }
    } catch (primaryError) {
      const via = await resolveViaApi(base)
      if (via === undefined) throw primaryError
      log(`!  ${base} 不可达，改用备用通道：${via.describe}`)
      return { raw: await readAssetViaApi(via, 'manifest.json'), via }
    }
  })()
  const manifestRaw = apiFallback.raw
  const manifest = JSON.parse(manifestRaw.toString('utf8'))
  if (manifest.schema !== 1) throw new Error(`不支持的清单 schema=${manifest.schema}`)
  log(`[release-install] 版本 ${manifest.tag}（commit ${manifest.commit ?? '?'}，构建于 ${manifest.builtAt}）`)

  // dsh 兼容性：本发布包只保证与「打包时刻的最新 dsh」兼容（清单里的 dsh.tested）
  const tested = manifest.dsh?.tested
  const compat = manifest.dsh?.compat ?? (tested === undefined ? undefined : `^${tested}`)
  const local = dshVersion()
  if (local === undefined) {
    log('!  未检测到 `dsh`（不在 PATH 上）——安装完请确认 dsh 版本满足兼容区间')
  } else if (compat !== undefined) {
    const ok = satisfies(local, compat)
    if (ok === true && tested !== undefined && local !== tested) {
      log(`!  本发布包在 dsh ${tested} 上验证（只保证最新版兼容），本机是 ${local}——继续安装，但未经本次验证`)
    } else if (ok === true) {
      log(`[release-install] dsh ${local} 与验证版本一致（compat ${compat}）`)
    } else if (ok === false) {
      const message = `本发布包只保证与 dsh ${tested} 兼容（compat ${compat}），本机是 ${local}`
      if (flags.strictVersion) throw new Error(message)
      log(`!  ${message}——继续安装，但可能不兼容；建议先升级 dsh 或跑两道闸体检`)
    }
  } else {
    log('!  清单未声明 dsh 兼容版本（打包环境没有 dsh），跳过兼容检查')
  }

  // 选定包：--only 或清单里的全部插件，再按 deps 取闭包
  const byName = new Map(manifest.packages.map((entry) => [entry.name, entry]))
  const wanted = flags.only !== undefined && flags.only.length > 0 ? flags.only : manifest.plugins
  const queue = [...wanted]
  const chosen = new Map()
  while (queue.length > 0) {
    const name = queue.shift()
    if (chosen.has(name)) continue
    const entry = byName.get(name)
    if (entry === undefined) throw new Error(`清单里没有包 ${name}（--only 写错了？）`)
    chosen.set(name, entry)
    for (const dep of Object.keys(entry.deps ?? {})) {
      if (byName.has(dep)) queue.push(dep)
    }
  }
  log(`[release-install] 需要 ${chosen.size} 个包（${wanted.length} 个插件 + 依赖闭包）`)

  // 下载 + 校验
  const cacheDir = resolve(flags.cache ?? join(home, 'spark-plugins', 'cache', manifest.tag))
  if (!flags.dryRun) mkdirSync(cacheDir, { recursive: true })
  const files = []
  // 备用通道：清单阶段可能已经解析出来了（github.com 不可达），直接复用，别重复问 API
  let fallback = apiFallback.via
  let fallbackAnnounced = fallback !== undefined
  for (const entry of chosen.values()) {
    const target = join(cacheDir, entry.file)
    let reused = false
    if (!flags.force && existsSync(target) && statSync(target).size === entry.size) {
      const digest = sha256(readFileSync(target))
      if (digest === entry.sha256) reused = true
    }
    if (!reused) {
      if (flags.dryRun) {
        log(`  [dry-run] 下载 ${entry.file}（${(entry.size / 1024).toFixed(0)} KB）`)
        continue
      }
      let buffer
      try {
        buffer = await readAsset(base, entry.file)
      } catch (primaryError) {
        // 主通道（github.com）整段不可达时改走 api.github.com。
        // 不静默降级：明确告诉用户"换了通道"，否则日志会让人误以为一直走的直连。
        if (fallback === undefined) fallback = await resolveViaApi(base)
        if (fallback === undefined) throw primaryError
        if (!fallbackAnnounced) {
          log(`!  ${base} 不可达，改用备用通道：${fallback.describe}`)
          fallbackAnnounced = true
        }
        buffer = await readAssetViaApi(fallback, entry.file)
      }
      const digest = sha256(buffer)
      if (digest !== entry.sha256) {
        throw new Error(`校验失败 ${entry.file}：期望 ${entry.sha256}，实际 ${digest}`)
      }
      writeFileSync(target, buffer)
      log(`  ✓ ${entry.name}@${entry.version}  ${(buffer.length / 1024).toFixed(0)} KB  sha256 ${digest.slice(0, 12)}…`)
    } else {
      log(`  = ${entry.name}@${entry.version}（缓存命中）`)
    }
    files.push({ name: entry.name, version: entry.version, file: target, bundle: entry.bundle === true })
  }

  if (flags.dryRun) {
    log(`[release-install] dry-run 结束（未写入 profile）。缓存目录：${cacheDir}`)
    return { manifest, cacheDir, files }
  }

  const result = installIntoProfile({
    home,
    profile: flags.profile,
    packages: files,
    registerBundles: true,
    resetModules: true,
    initBundles: manifest.defaultBundles ?? ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
    log,
  })

  // 所有权记录：卸载时靠它做外科手术式摘除（profile 里还有别人的插件，
  // 见 lib/profile-uninstall.mjs 头注释）。装完才写，装挂了就不该登记。
  writeState(home, {
    profile: flags.profile,
    tag: manifest.tag,
    installedAt: new Date().toISOString(),
    packages: files.map((entry) => entry.name),
  })

  log('')
  log(`✅ 完成：${files.length} 个包已装进 ${result.profileRoot}`)
  log(`   bundles: ${result.bundles.join(', ')}`)
  log(`   重启生效：dsh --profile ${flags.profile}`)
  log(`   卸载：sh install.sh --uninstall --profile ${flags.profile}`)
  return { manifest, cacheDir, files, result }
}

if (process.argv[1] !== undefined && /release-install\.mjs$/.test(process.argv[1])) {
  releaseInstall().catch((error) => {
    console.error(`✗ ${error?.message ?? error}`)
    process.exit(1)
  })
}
