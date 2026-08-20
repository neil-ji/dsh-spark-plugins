#!/usr/bin/env node
/**
 * 应急逃生 dsh 入口：初始化/启动一个「纯官方」profile（web 模板：dsh-base + dsh-web-app，
 * 零第三方插件、零 monorepo 依赖），并可用它启动一个干净的 web GUI。
 *
 * 用法：
 *   node scripts/escape-profile.mjs            # 仅初始化（幂等），打印启动命令
 *   node scripts/escape-profile.mjs --boot     # 初始化 + 启动 dsh --profile escape --port 3998
 *   node scripts/escape-profile.mjs --boot 3997   # 指定端口
 *
 * 场景：3080 工作服务或 web profile 因插件/版本问题起不来时，用逃生 profile 先救回一个
 * 可用的 dsh GUI（会话/存储共用 DSH_HOME，数据不变；只是不加载任何第三方插件）。
 * 逃生 profile 的 bundles 是 in-box（从全局 dsh 安装解析，跟随 dsh 升级），不依赖本 monorepo。
 */
import { execFileSync, spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const PROFILE_NAME = process.env.DSH_ESCAPE_PROFILE ?? 'escape'
const DEFAULT_PORT = 3998

// 定位全局 dsh 安装（which dsh -> realpath -> @deepseek-ai/dsh 根），解析官方 app-boot API
function resolveDshRoot() {
  const bin = execFileSync('which', ['dsh']).toString().trim()
  if (!bin) throw new Error('dsh 不在 PATH 上，无法定位全局安装')
  const real = realpathSync(bin)
  // .../lib/node_modules/@deepseek-ai/dsh/lib/bin.js -> 向上两级
  return dirname(dirname(real))
}

async function initEscapeProfile() {
  const dshRoot = resolveDshRoot()
  const require = createRequire(join(dshRoot, 'package.json'))
  const appBootPath = require.resolve('@deepseek-ai/dsh-app-boot', { paths: [dshRoot] })
  const { initProfile, PROFILE_TEMPLATES, resolveProfileDir } = await import(appBootPath)

  const dir = resolveProfileDir(PROFILE_NAME)
  initProfile(dir, PROFILE_TEMPLATES.web)
  console.log(`[escape] profile 就绪: ${dir}`)
  console.log(`[escape] bundles: ${PROFILE_TEMPLATES.web.join(' + ')}（纯官方，无第三方插件）`)
  return dir
}

const args = process.argv.slice(2)
const bootIdx = args.indexOf('--boot')
let port = DEFAULT_PORT
if (bootIdx !== -1 && args[bootIdx + 1] && /^\d+$/.test(args[bootIdx + 1])) {
  port = Number(args[bootIdx + 1])
}

await initEscapeProfile()
console.log(`[escape] 手动启动: dsh --profile ${PROFILE_NAME} --port ${port}（--no-open 可不弹浏览器）`)

if (bootIdx !== -1) {
  console.log(`[escape] 启动 dsh --profile ${PROFILE_NAME} --port ${port} ...`)
  const child = spawn('dsh', ['--profile', PROFILE_NAME, '--port', String(port)], {
    stdio: 'inherit',
    env: { ...process.env },
  })
  const exit = await new Promise((resolve) => child.on('exit', resolve))
  process.exit(exit ?? 0)
}
