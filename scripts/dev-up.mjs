#!/usr/bin/env node
/**
 * 启动沙箱 dev 实例（线 2）：DSH_HOME=.dev/home + dsh --profile devweb --port 3997 --no-open。
 *
 * 用法：
 *   node scripts/dev-up.mjs                    # 前台启动（Ctrl-C 退出）
 *   node scripts/dev-up.mjs --detach           # 后台启动，日志写 .dev/logs/，就绪后返回
 *   node scripts/dev-up.mjs --cwd <dir>        # 指定实例工作目录（默认 .dev/workspace）
 *   node scripts/dev-up.mjs --port 3996        # 换端口
 *   node scripts/dev-up.mjs --verify           # 就绪后自动跑 dev-verify
 *
 * 常驻服务 3080 / dogfood 3999 / 逃生 3998 一律不动。
 */
import { closeSync, openSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  LOG_DIR,
  PORT,
  PROFILE,
  PROFILE_MANIFEST,
  ROOT,
  SANDBOX_HOME,
  SANDBOX_WORKSPACE,
  STATE_FILE,
  exists,
  fetchJson,
  log,
  spawnDsh,
  waitForHttp,
  writeJson,
} from './dev-shared.mjs'
import { spawnSync } from 'node:child_process'

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const value = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  return index === -1 || argv[index + 1] === undefined ? fallback : argv[index + 1]
}

const port = Number(value('port', PORT))
const profile = value('profile', PROFILE)
const cwd = value('cwd', SANDBOX_WORKSPACE)
const detach = flag('detach')
const logFile = join(LOG_DIR, `${profile}-${port}.log`)

export function ensureHome() {
  if (!exists(PROFILE_MANIFEST)) {
    log.step('沙箱尚未初始化，先执行 dev-home init')
    const result = spawnSync(process.execPath, [join(ROOT, 'scripts', 'dev-home.mjs'), 'init'], { stdio: 'inherit' })
    if (result.status !== 0) {
      log.fail('沙箱初始化失败')
      process.exit(result.status ?? 1)
    }
  }
}

/** 后台启动并等到就绪；返回 {child, url, token}。 */
export async function startDetached({ timeoutMs = 120_000, reuse = false } = {}) {
  ensureHome()
  const existing = await fetchJson(`http://127.0.0.1:${port}/__dev/probe`).catch(() => undefined)
  if (existing !== undefined) {
    if (reuse) {
      log.warn(`端口 ${port} 已有实例在跑（home=${existing.home}），复用`)
      return { pid: undefined, port, profile, home: existing.home, reused: true, logFile }
    }
    throw new Error(`端口 ${port} 已被占用（home=${existing.home}）。先停止它，或改用 --attach 复用，或换 --port`)
  }

  // 每次启动截断日志：避免把上一轮的 token/报错当成这一轮的
  log.step(`spawn: dsh --profile ${profile} --port ${port} --no-open（日志 ${logFile}）`)
  const fd = openSync(logFile, 'w')
  const child = spawnDsh({ profile, port, cwd, stdio: ['ignore', fd, fd] })
  log.info(`pid=${child.pid}，等待 URL 与探针就绪…`)
  let exited
  child.on('exit', (code) => {
    exited = code
    closeSync(fd)
  })

  const readLog = () => {
    try {
      return readFileSync(logFile, 'utf8')
    } catch {
      return ''
    }
  }

  const deadline = Date.now() + timeoutMs
  let url
  while (Date.now() < deadline) {
    if (exited !== undefined) {
      throw new Error(`dsh 启动即退出（code ${exited}）：\n` + readLog().split('\n').slice(-12).join('\n'))
    }
    const match = /(http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+)/.exec(readLog())
    if (match !== null) {
      url = match[1]
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }

  try {
    await waitForHttp(`http://127.0.0.1:${port}/__dev/probe`, { timeoutMs: Math.max(5_000, deadline - Date.now()) })
  } catch (error) {
    if (exited !== undefined) throw new Error(`dsh 启动失败（code ${exited}）：\n` + readLog().split('\n').slice(-12).join('\n'))
    throw error
  }
  const state = { pid: child.pid, port, profile, home: SANDBOX_HOME, url, logFile, startedAt: Date.now() }
  writeJson(STATE_FILE, state)
  return { child, ...state }
}

async function main() {
  if (detach) {
    const state = await startDetached()
    log.ok(`沙箱实例就绪：${state.url ?? `http://127.0.0.1:${port}/`}`)
    log.info(`控制面板：http://127.0.0.1:${port}/__dev/`)
    log.info(`诊断探针：http://127.0.0.1:${port}/__dev/probe`)
    log.info(`日志：${state.logFile} · 状态：${STATE_FILE}`)
    if (flag('verify')) {
      const { runVerify } = await import('./dev-verify.mjs')
      process.exit(await runVerify({ port, profile, attach: true }))
    }
    return
  }

  ensureHome()
  const probe = await waitForHttp(`http://127.0.0.1:${port}/__dev/probe`, { timeoutMs: 1000 })
    .then(() => fetchJson(`http://127.0.0.1:${port}/__dev/probe`))
    .catch(() => undefined)
  if (probe !== undefined) {
    log.warn(`端口 ${port} 上已有 dev 实例在跑（home=${probe.home}）`)
    log.info('要重启请先停掉它，或换 --port')
    return
  }

  log.step(`启动 dsh --profile ${profile} --port ${port} --no-open`)
  log.info(`DSH_HOME = ${SANDBOX_HOME}`)
  log.info(`cwd      = ${cwd}`)
  const child = spawnDsh({ profile, port, cwd, stdio: 'inherit' })
  const code = await new Promise((resolve) => child.on('exit', resolve))
  process.exit(code ?? 0)
}

// 作为脚本直接运行时才执行 main（被 import 时只导出工具）
if (process.argv[1] !== undefined && process.argv[1].endsWith('dev-up.mjs')) {
  await main()
}
