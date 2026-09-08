/**
 * 沙箱开发通道的公共层：路径、workspace 包索引、profile 文件读写、dsh 进程与 HTTP 小工具。
 *
 * 三线共用：
 *   - 线 2 link 通道：scripts/dev-home.mjs + scripts/dev-profile.mjs + scripts/dev-up.mjs
 *   - 线 2 install 通道（P1）/ 线 3（P2）：复用同一套 home/profile 供给与 dev-verify.mjs
 *
 * 所有沙箱状态都在 <ROOT>/.dev 下（已 gitignore），绝不写 ~/.dsh。
 */
import { execSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
export const DEV_DIR = join(ROOT, '.dev')
export const SANDBOX_HOME = join(DEV_DIR, 'home')
export const SANDBOX_WORKSPACE = join(DEV_DIR, 'workspace')
export const DEV_HARNESS_DIR = join(ROOT, 'dev-harness')
export const DEV_PLUGIN_ENTRY = join(DEV_HARNESS_DIR, 'dev-plugin', 'index.js')

export const PROFILE = process.env['DSH_DEV_PROFILE'] ?? 'devweb'
export const PORT = Number(process.env['DSH_DEV_PORT'] ?? 3997)
export const PROFILE_DIR = join(SANDBOX_HOME, 'profiles', PROFILE)
export const HOME_PATCH = join(SANDBOX_HOME, 'cordis.patch.yml')
export const PROFILE_PATCH = join(PROFILE_DIR, 'cordis.patch.yml')
export const PROFILE_MANIFEST = join(PROFILE_DIR, 'package.json')
export const PROFILE_WORKSPACE = join(PROFILE_DIR, 'pnpm-workspace.yaml')
export const STATE_FILE = join(DEV_DIR, 'state.json')
export const LOG_DIR = join(DEV_DIR, 'logs')
export const REAL_DSH_HOME = join(homedir(), '.dsh')

export const BUNDLES_BASE = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

// ── 基础 IO ────────────────────────────────────────────────────────────────

export const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))
export const writeJson = (file, value) => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
}
export const readText = (file) => readFileSync(file, 'utf8')
export const writeText = (file, text) => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}
export const exists = (file) => existsSync(file)

export const log = {
  step: (message) => console.log('[dev] ' + message),
  info: (message) => console.log('      ' + message),
  warn: (message) => console.warn('[dev] ⚠ ' + message),
  fail: (message) => console.error('[dev] ✗ ' + message),
  ok: (message) => console.log('[dev] ✓ ' + message),
}

export const posix = (p) => p.split(sep).join('/')
export const fileUrl = (p) => pathToFileURL(p).href

// ── workspace 包索引 ───────────────────────────────────────────────────────

let packageCache
/** 扫描 packages/* 的 package.json，返回按包名索引的 {name,dir,rel,pkg}。 */
export function workspacePackages() {
  if (packageCache !== undefined) return packageCache
  packageCache = new Map()
  const packagesDir = join(ROOT, 'packages')
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = join(packagesDir, entry.name)
    const manifest = join(dir, 'package.json')
    if (!existsSync(manifest)) continue
    try {
      const pkg = readJson(manifest)
      if (typeof pkg.name === 'string') {
        packageCache.set(pkg.name, { name: pkg.name, dir, rel: posix(relative(ROOT, dir)), pkg })
      }
    } catch (error) {
      log.warn(`跳过无法解析的 ${manifest}: ${String(error)}`)
    }
  }
  return packageCache
}

/** plugin-registry.json：{ profile, plugins: { 包名: 相对目录 } }。 */
export function registry() {
  const file = join(ROOT, 'plugin-registry.json')
  const parsed = existsSync(file) ? readJson(file) : { plugins: {} }
  return { profile: parsed.profile ?? 'web', plugins: parsed.plugins ?? {} }
}

/** 包的宿主入口文件（exports["."] 或 main）。 */
export function entryFile(pkg) {
  const fromExports = pkg.exports?.['.']
  const rel = typeof fromExports === 'string' ? fromExports : fromExports?.default
  return rel ?? pkg.main ?? undefined
}

/** 包的客户端 bundle 相对路径（exports["./client"]），无则 undefined。 */
export function clientFile(pkg) {
  const fromExports = pkg.exports?.['./client']
  const rel = typeof fromExports === 'string' ? fromExports : fromExports?.default
  return rel ?? undefined
}

export const hasBundlePatch = (pkg) => typeof pkg.dsh?.bundle?.patch === 'string'
export const hasClientHalf = (pkg) => pkg.dsh?.client?.platform === 'web'

/** 一个 workspace 包的链接可行性画像。 */
export function describePackage(record) {
  const { name, dir, rel, pkg } = record
  const entryRel = entryFile(pkg)
  const clientRel = clientFile(pkg)
  const entryAbs = entryRel === undefined ? undefined : join(dir, entryRel)
  const clientAbs = clientRel === undefined ? undefined : join(dir, clientRel)
  return {
    name,
    dir,
    rel,
    pkg,
    entryRel,
    entryAbs,
    entryReady: entryAbs !== undefined && existsSync(entryAbs),
    clientRel,
    clientAbs,
    clientReady: clientAbs !== undefined && existsSync(clientAbs),
    bundlePatch: hasBundlePatch(pkg),
    clientHalf: hasClientHalf(pkg),
  }
}

/** 已安装到 profile node_modules 的那份拷贝画像（install 通道的保真对象）。 */
export function describeInstalledPackage(profileDir, name) {
  const dir = join(profileDir, 'node_modules', name)
  const manifest = join(dir, 'package.json')
  if (!existsSync(manifest)) return undefined
  try {
    const pkg = readJson(manifest)
    return describePackage({ name, dir, rel: posix(relative(ROOT, dir)), pkg })
  } catch {
    return undefined
  }
}

/** registry 里登记、且能被链接的包（按 registry 顺序）。 */
export function registeredPlugins() {
  const packages = workspacePackages()
  const out = []
  for (const [key, rel] of Object.entries(registry().plugins)) {
    const record = [...packages.values()].find((candidate) => candidate.rel === posix(rel))
    if (record === undefined) {
      log.warn(`plugin-registry.json 里的 ${key} (${rel}) 在 packages/ 下找不到，已跳过`)
      continue
    }
    out.push(describePackage(record))
  }
  return out
}

// ── 最小 YAML 生成（只覆盖 patch 文件用到的形态） ───────────────────────────

function yamlScalar(value) {
  if (value === null) return 'null'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  const text = String(value)
  if (text === '' || /[:#{}[\],&*?|>%@`'"]/.test(text) || /^\s|\s$/.test(text)) {
    return "'" + text.replaceAll("'", "''") + "'"
  }
  return text
}

/** 生成 YAML（对象/数组/标量），保持插入顺序。 */
export function yaml(value, indent = 0) {
  const pad = '  '.repeat(indent)
  if (Array.isArray(value)) {
    if (value.length === 0) return pad + '[]\n'
    let out = ''
    for (const item of value) {
      if (item !== null && typeof item === 'object') {
        const body = yaml(item, indent + 1)
        out += pad + '- ' + body.slice(pad.length + 2)
      } else {
        out += pad + '- ' + yamlScalar(item) + '\n'
      }
    }
    return out
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value)
    if (keys.length === 0) return pad + '{}\n'
    let out = ''
    for (const key of keys) {
      const item = value[key]
      if (item !== null && typeof item === 'object') {
        const inner = yaml(item, indent + 1)
        if (inner === '  '.repeat(indent + 1) + '[]\n' || inner === '  '.repeat(indent + 1) + '{}\n') {
          out += pad + key + ': ' + inner.trim() + '\n'
        } else {
          out += pad + key + ':\n' + inner
        }
      } else {
        out += pad + key + ': ' + yamlScalar(item) + '\n'
      }
    }
    return out
  }
  return pad + yamlScalar(value) + '\n'
}

// ── dsh 进程与 HTTP ───────────────────────────────────────────────────────

export const sandboxEnv = (extra = {}) => ({ ...process.env, DSH_HOME: SANDBOX_HOME, ...extra })

/** 用 shell 起 dsh（Windows 上是 .ps1/.cmd，必须过 shell）。 */
export function spawnDsh({ profile = PROFILE, port = PORT, cwd = SANDBOX_WORKSPACE, args = [], stdio = 'inherit' }) {
  const command = ['dsh', '--profile', profile, '--port', String(port), '--no-open', ...args].join(' ')
  return spawn(command, { shell: true, stdio, cwd, env: sandboxEnv() })
}

export async function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

/** 轮询一个 URL 直到 2xx/3xx 或超时。 */
export async function waitForHttp(url, { timeoutMs = 60_000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(Math.min(5_000, timeoutMs)) })
      if (response.status < 400) return response
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await sleep(intervalMs)
  }
  throw new Error(`等待 ${url} 超时（${timeoutMs}ms）：${String(lastError)}`)
}

export async function fetchJson(url, init) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), ...init })
  const text = await response.text()
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}: ${text.slice(0, 200)}`)
  return JSON.parse(text)
}

/**
 * 订阅 /plugins/events SSE 直到收集到需要的帧或超时。
 * 永不 reject：连接/中断/解析失败都只表现为「没收到帧」，避免未处理的 rejection 打断验收。
 * @returns {{graph?: object, rebuilt: object[], all: object[]}}
 */
export async function collectPluginEvents(baseUrl, { timeoutMs = 8000, until } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const collected = { rebuilt: [], all: [] }
  let reader
  try {
    const response = await fetch(baseUrl + '/plugins/events', {
      headers: { accept: 'text/event-stream' },
      signal: controller.signal,
    })
    if (!response.ok || response.body === null) throw new Error(`SSE HTTP ${response.status}`)
    reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      let chunk
      try {
        chunk = await reader.read()
      } catch {
        break
      }
      if (chunk.done === true) break
      buffer += decoder.decode(chunk.value, { stream: true })
      let index
      while ((index = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        const dataLine = raw.split('\n').find((line) => line.startsWith('data: '))
        if (dataLine === undefined) continue
        let frame
        try {
          frame = JSON.parse(dataLine.slice(6))
        } catch {
          continue
        }
        collected.all.push(frame)
        if (frame.type === 'graph') collected.graph = frame.graph
        if (frame.type === 'rebuilt') collected.rebuilt.push(frame)
        if (until !== undefined && until(collected)) return collected
      }
    }
  } catch {
    /* 连接失败或中途断开：按「没收到帧」处理 */
  } finally {
    clearTimeout(timer)
    try {
      await reader?.cancel()
    } catch {
      /* 已关闭 */
    }
    controller.abort()
  }
  return collected
}

/** 命令行参数转义（Windows shell 下带空格/特殊字符的路径）。 */
const quote = (value) => (/[\s"&|<>^]/.test(value) ? '"' + String(value).replaceAll('"', '""') + '"' : String(value))

/** 在沙箱环境里跑一条命令（单字符串形式，避免 shell:true + args 的注入告警）。 */
export function runShell(command, { cwd = SANDBOX_WORKSPACE, stdio = 'inherit', encoding } = {}) {
  return execSync(command, { cwd, stdio, encoding, env: sandboxEnv() })
}

export const runPnpm = (args, options) => runShell('pnpm ' + args.map(quote).join(' '), options)

/** 直接调用 dsh CLI 并捕获输出（如 --dump-config）。 */
export const runDsh = (args, options = {}) =>
  runShell('dsh ' + args.map(quote).join(' '), { stdio: 'pipe', ...options, encoding: options.encoding ?? 'utf8' })

export function profileState() {
  const manifest = exists(PROFILE_MANIFEST) ? readJson(PROFILE_MANIFEST) : undefined
  return {
    home: SANDBOX_HOME,
    profile: PROFILE,
    profileDir: PROFILE_DIR,
    port: PORT,
    dependencies: manifest?.dependencies ?? {},
    bundles: manifest?.dsh?.profile?.bundles ?? [],
  }
}
