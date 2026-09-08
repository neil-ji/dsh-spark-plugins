#!/usr/bin/env node
/**
 * 线 3：验证**已发布的 release 资产**能装、能跑（不依赖工作区源码，不构建）。
 *
 * 流程：从 `--base-url`（GitHub Release / 本地目录 / file://）下载清单与 tarball并校验
 *      → 装进沙箱 home 的 dev profile → 跑与线 2 完全相同的验收矩阵（scripts/dev-verify.mjs）。
 *
 * 用法：
 *   node scripts/remote-verify.mjs                                   # GitHub latest
 *   node scripts/remote-verify.mjs --version v0.2.0                  # 指定 tag
 *   node scripts/remote-verify.mjs --base-url dist-release           # 本地发布目录（CI 里验刚打的包）
 *   node scripts/remote-verify.mjs --fresh                           # 先清空沙箱 home
 *   node scripts/remote-verify.mjs --only dsh-spark,dsh-connector-npm
 */
import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  PORT,
  PROFILE,
  PROFILE_MANIFEST,
  ROOT,
  SANDBOX_HOME,
  log,
} from './dev-shared.mjs'
import { releaseInstall } from './release-install.mjs'
import { runVerify } from './dev-verify.mjs'

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const value = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  return index === -1 || argv[index + 1] === undefined ? fallback : argv[index + 1]
}

const port = Number(value('port', PORT))
const profile = value('profile', PROFILE)
const baseUrl = value('base-url', undefined)
const version = value('version', undefined)
const only = value('only', undefined)

async function main() {
  if (flag('fresh')) {
    log.step('清空沙箱 home')
    rmSync(SANDBOX_HOME, { recursive: true, force: true })
  }
  if (!existsSync(PROFILE_MANIFEST)) {
    log.step('初始化沙箱 home（含 dev-control 控制平面）')
    const result = spawnSync(process.execPath, [join(ROOT, 'scripts', 'dev-home.mjs'), 'init'], { stdio: 'inherit' })
    if (result.status !== 0) throw new Error('沙箱初始化失败')
  }

  log.step('从 release 资产安装到沙箱 profile')
  const installArgs = ['--home', SANDBOX_HOME, '--profile', profile, '--force']
  if (baseUrl !== undefined) installArgs.push('--base-url', baseUrl)
  if (version !== undefined) installArgs.push('--version', version)
  if (only !== undefined) installArgs.push('--only', only)
  const installed = await releaseInstall(installArgs)
  log.ok(`release ${installed.manifest.tag} 安装完成：${installed.files.length} 个包`)

  log.step('跑共享验收矩阵')
  const code = await runVerify({ port, profile, attach: false, withHostHmr: false })
  if (code !== 0) {
    log.fail('release 验收未通过')
    process.exit(code)
  }
  log.ok(`release ${installed.manifest.tag} 端到端验收通过`)
}

await main().catch((error) => {
  log.fail(String(error?.message ?? error))
  process.exit(1)
})
