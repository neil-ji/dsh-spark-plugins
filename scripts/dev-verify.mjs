#!/usr/bin/env node
/**
 * 沙箱验收（三线共用）：对一条真实 dsh 实例跑「隔离 / 加载 / 客户端图 / HMR」断言。
 *
 * 用法：
 *   node scripts/dev-verify.mjs                     # 自动起沙箱实例、跑断言、退出时收掉
 *   node scripts/dev-verify.mjs --attach            # 对已在跑的实例（3997）跑断言，不启停
 *   node scripts/dev-verify.mjs --with-host-hmr     # 追加宿主模块热更断言（需等 hmr 就绪，较慢）
 *   node scripts/dev-verify.mjs --port 3996         # 换端口
 *
 * 退出码：0 = 全通过；1 = 有断言失败。
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import {
  PORT,
  PROFILE,
  PROFILE_DIR,
  PROFILE_MANIFEST,
  PROFILE_PATCH,
  REAL_DSH_HOME,
  SANDBOX_HOME,
  collectPluginEvents,
  describeInstalledPackage,
  describePackage,
  exists,
  fetchJson,
  log,
  readJson,
  registeredPlugins,
  runDsh,
  sleep,
  workspacePackages,
} from './dev-shared.mjs'

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const value = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  return index === -1 || argv[index + 1] === undefined ? fallback : argv[index + 1]
}

const results = []
const record = (ok, title, detail = '') => {
  results.push({ ok, title, detail })
  const mark = ok ? '✓' : '✗'
  console.log(`  ${mark} ${title}${detail === '' ? '' : '  — ' + detail}`)
}

const samePath = (a, b) => {
  try {
    return realpathSync(a).toLowerCase() === realpathSync(b).toLowerCase()
  } catch {
    return String(a).toLowerCase() === String(b).toLowerCase()
  }
}

/** 解析 dsh --dump-config，返回组合后属于本仓库 / dev 的启用行。 */
export function composedThirdPartyRows(profile) {
  const text = runDsh(['--profile', profile, '--dump-config'])
  const rows = []
  let current
  for (const line of text.split('\n')) {
    if (line.trim() === '' || /^\s*#/.test(line)) continue
    const idMatch = /^(\s*)-?\s*id:\s*(\S+)\s*$/.exec(line)
    if (idMatch !== null) {
      current = { id: idMatch[2], indent: idMatch[1].length, disabled: false, name: undefined }
      rows.push(current)
      continue
    }
    if (current === undefined) continue
    if (current.name === undefined) {
      const nameMatch = /^\s+name:\s*'?([^'\n]+?)'?\s*$/.exec(line)
      if (nameMatch !== null) current.name = nameMatch[1].trim()
    }
    if (/^\s+disabled:\s*true\s*$/.test(line)) current.disabled = true
  }
  const packages = workspacePackages()
  const isOurs = (name) => {
    if (typeof name !== 'string') return false
    if (name.startsWith('@deepseek-ai/') || name.startsWith('cordis:')) return false
    if (name.startsWith('file:')) return true
    return packages.has(name.split('/')[0])
  }
  return rows.filter((row) => !row.disabled && isOurs(row.name))
}

function linkedPlugins() {
  if (!exists(PROFILE_MANIFEST)) return []
  const manifest = readJson(PROFILE_MANIFEST)
  const bundles = new Set(manifest.dsh?.profile?.bundles ?? [])
  const registry = new Map(registeredPlugins().map((record_) => [record_.name, record_]))
  const packages = workspacePackages()
  const out = []
  for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
    const specText = String(spec)
    let record_
    if (specText.startsWith('file:')) {
      // install 通道：断言必须针对 profile 里那份拷贝，而不是仓库源码
      record_ = describeInstalledPackage(PROFILE_DIR, name) ?? registry.get(name)
    } else {
      record_ = registry.get(name) ?? (packages.get(name) === undefined ? undefined : describePackage(packages.get(name)))
    }
    if (record_ === undefined) continue
    out.push({ ...record_, inBundles: bundles.has(name), spec: specText })
  }
  return out
}

export async function runVerify(options = {}) {
  const port = Number(options.port ?? value('port', PORT))
  const profile = options.profile ?? value('profile', PROFILE)
  const attach = options.attach ?? flag('attach')
  const withHostHmr = options.withHostHmr ?? flag('with-host-hmr')
  const base = `http://127.0.0.1:${port}`
  let started

  if (!attach) {
    const { startDetached } = await import('./dev-up.mjs')
    log.step(`启动沙箱实例（profile=${profile} port=${port}）`)
    started = await startDetached()
  } else {    log.step(`复用已有实例 ${base}`)
  }

  try {
    log.step('1/5 隔离与探针')
    let probe = await fetchJson(`${base}/__dev/probe`)
    record(samePath(probe.home, SANDBOX_HOME), 'DSH_HOME 指向沙箱', String(probe.home))
    record(!samePath(probe.home, REAL_DSH_HOME), '没有用到 ~/.dsh', String(REAL_DSH_HOME))
    record(probe.services?.webServer === true, 'webServer 服务在线')
    record(probe.services?.clientModules === true, 'clientModules 服务在线')

    log.step('2/5 组合出的第三方行全部 ACTIVE')
    const linked = linkedPlugins()
    // install 通道（deps 为 file:<tgz>）改的是 profile 里的拷贝；link 通道改的是仓库源码
    const artifactWhere = linked.some((record_) => record_.spec.startsWith('file:')) ? 'installed' : 'repo'
    record(linked.length > 0, 'profile 里有链接的插件', `${linked.length} 个（产物形态：${artifactWhere}）`)
    let rows
    try {
      rows = composedThirdPartyRows(profile)
    } catch (error) {
      record(false, '读取 dsh --dump-config', String(error?.message ?? error).split('\n')[0])
      rows = []
    }
    record(rows.length > 0, '组合结果含第三方行', `${rows.length} 行`)
    // 有些行要等依赖服务就绪才激活（finance 注入 session/credentials/llm），先等一等再断言
    const activeIds = await waitForRowsActive(base, rows.map((row) => row.id), 40_000)
    for (const row of rows) {
      record(activeIds.has(row.id), `${row.id} ACTIVE`, row.name)
    }
    const activePackages = linked.filter((record_) =>
      probe.entries.some((entry) =>
        (entry.name === record_.name || String(entry.name).startsWith(record_.name + '/')) &&
        entry.fiberState === 2 && entry.disabled !== true))
    record(activePackages.length > 0, '已激活的链接包', `${activePackages.length}/${linked.length}`)
    probe = await fetchJson(`${base}/__dev/probe`)

    log.step('3/5 客户端插件进入 boot 图')
    const clientPackages = activePackages.filter((record_) => record_.clientHalf && record_.clientReady)
    record(clientPackages.length > 0, '存在已激活且带客户端半侧的包', `${clientPackages.length} 个`)
    const graphIds = new Map((probe.clientGraph?.entries ?? []).map((entry) => [entry.id, entry.rev]))
    for (const record_ of clientPackages) {
      record(graphIds.has(record_.name), `${record_.name} 在 boot 图里`, `rev=${graphIds.get(record_.name) ?? '-'}`)
    }

    log.step('4/5 客户端 HMR（改 lib/client.js → rebuilt 帧）')
    const hmrTarget = clientPackages[0]
    if (hmrTarget === undefined) {
      record(false, '客户端 HMR 断言', '没有可用的客户端包')
    } else {
      const before = graphIds.get(hmrTarget.name)
      const collector = collectPluginEvents(base, {
        timeoutMs: 15_000,
        until: (collected) => collected.rebuilt.some((frame) => frame.id === hmrTarget.name && frame.rev !== before),
      })
      const result = await fetchJson(`${base}/__dev/scenario/touch-client-bundle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ package: hmrTarget.name, restoreMs: 3000, where: artifactWhere }),
      })
      const collected = await collector
      const frame = collected.rebuilt.find((candidate) => candidate.id === hmrTarget.name && candidate.rev !== before)
      record(frame !== undefined, `${hmrTarget.name} 收到 rebuilt 帧`, frame === undefined ? '15s 内没有新 rev' : `${before} → ${frame.rev}`)
      record(result?.result?.bytesAfter > result?.result?.bytesBefore, '产物确被改动', `${result?.result?.bytesBefore} → ${result?.result?.bytesAfter}（${artifactWhere}）`)
      await sleep(3500) // 等场景把产物还原（还原本身会再触发一次 rebuilt）
    }

    log.step('5/5 宿主模块 HMR' + (withHostHmr ? '' : '（跳过：加 --with-host-hmr 开启）'))
    const hostHmrConfigured = exists(PROFILE_PATCH) && /^\s*-?\s*id:\s*hmr\s*$/m.test(readFileSync(PROFILE_PATCH, 'utf8'))
    if (withHostHmr && !hostHmrConfigured) {
      log.info('（profile 补丁里没有 hmr 行——install 通道无宿主热更，跳过）')
    } else if (withHostHmr) {
      const ready = await waitForService(base, 'hmr', 90_000)
      const hostTarget = activePackages.find((record_) => record_.bundlePatch && record_.entryReady)
      if (!ready) {
        record(false, 'hmr 服务就绪', '90s 内未 ACTIVE（检查 profile 补丁的 hmr 行与监听根）')
      } else if (hostTarget === undefined) {
        record(false, '宿主 HMR 断言', '没有已激活且带 bundle 补丁的包')
      } else {
        const beforeReloads = (await fetchJson(`${base}/__dev/probe`)).events?.hmrReload?.length ?? 0
        const touched = await fetchJson(`${base}/__dev/scenario/touch-host-bundle`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ package: hostTarget.name, restoreMs: 3000, where: artifactWhere }),
        })
        let after = beforeReloads
        const deadline = Date.now() + 20_000
        while (Date.now() < deadline && after <= beforeReloads) {
          await sleep(1000)
          after = (await fetchJson(`${base}/__dev/probe`)).events?.hmrReload?.length ?? 0
        }
        record(after > beforeReloads, `${hostTarget.name} 触发 hmr/reload`, `reload 次数 ${beforeReloads} → ${after}（touch=${touched?.result?.file}）`)
      }
    } else {
      log.info('（宿主 HMR 断言未开启）')
    }
  } finally {
    if (started !== undefined && !attach) {
      // 收尾前先把 touch-* 场景改过的产物还原（它们的定时还原可能被进程退出打断）
      await fetchJson(`${base}/__dev/scenario/restore-artifacts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }).catch(() => undefined)
      log.step('收尾：停止本次启动的沙箱实例')
      stopDetached(started.pid)
      await waitForPortFree(port)
    }
  }

  const failed = results.filter((result) => !result.ok)
  console.log('')
  if (failed.length === 0) {
    log.ok(`全部通过（${results.length} 项）`)
    return 0
  }
  log.fail(`${failed.length}/${results.length} 项失败：`)
  for (const result of failed) console.log(`   - ${result.title}${result.detail === '' ? '' : ': ' + result.detail}`)
  return 1
}

/** 轮询探针，直到给定 id 的行全部 ACTIVE（或超时），返回当前 ACTIVE 集合。 */
async function waitForRowsActive(base, ids, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let active = new Set()
  while (Date.now() < deadline) {
    try {
      const probe = await fetchJson(`${base}/__dev/probe`)
      active = new Set(
        probe.entries.filter((entry) => entry.fiberState === 2 && entry.disabled !== true).map((entry) => entry.id),
      )
      if (ids.every((id) => active.has(id))) return active
    } catch {
      /* 实例还没稳定 */
    }
    await sleep(1000)
  }
  return active
}

async function waitForService(base, service, timeoutMs) {  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const probe = await fetchJson(`${base}/__dev/probe`)
      if (probe.services?.[service] === true) return true
    } catch {
      /* 还没起来 */
    }
    await sleep(2000)
  }
  return false
}

export function stopDetached(pid) {
  if (pid === undefined) return
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
  else spawnSync('kill', ['-TERM', '-' + String(pid)], { stdio: 'ignore' })
}

/** 等端口真正释放（Windows 上 taskkill 是异步的，立刻重开会撞 EADDRINUSE）。 */
export async function waitForPortFree(port, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const busy = await fetch(`http://127.0.0.1:${port}/__dev/probe`).then(() => true).catch(() => false)
    if (!busy) return true
    await sleep(500)
  }
  return false
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('dev-verify.mjs')) {
  process.exit(await runVerify())
}
