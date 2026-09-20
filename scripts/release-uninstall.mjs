#!/usr/bin/env node
/**
 * 从某个 dsh profile 里卸载 dsh-spark-plugins（普通用户路径）。
 *
 * 与 release-install.mjs 对称：安装器写 5 处，这里逐条反演，**不动** profile 里
 * 第三方的其它插件（真 home 里就有 dsh-plugin-deepeye）。细节见
 * lib/profile-uninstall.mjs 的头注释。
 *
 * 本文件由 scripts/pack-release.mjs 打成单文件资产 release-uninstall.mjs 上传，
 * 也可以直接在仓库里 `node scripts/release-uninstall.mjs ...` 跑。
 *
 * 用法：
 *   node release-uninstall.mjs [--profile web] [--home <dir>]
 *                              [--dry-run] [--keep-cache]
 * 退出码：0 = 成功；1 = 出错。
 */
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { uninstallFromProfile } from './lib/profile-uninstall.mjs'

function parseArgs(argv) {
  const flags = { profile: 'web' }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--profile') flags.profile = argv[++index]
    else if (arg === '--home') flags.home = argv[++index]
    else if (arg === '--dry-run') flags.dryRun = true
    else if (arg === '--keep-cache') flags.keepCache = true
    else if (arg === '--keep-modules') flags.purge = false
    else if (arg.startsWith('--')) throw new Error(`未知参数 ${arg}`)
    else throw new Error(`未知位置参数 ${arg}`)
  }
  return flags
}

export function releaseUninstall(argv = process.argv.slice(2)) {
  const flags = parseArgs(argv)
  const log = (message) => console.log(message)
  const home = resolve(
    (flags.home ?? process.env['DSH_HOME'] ?? join(homedir(), '.dsh')).replace(/^~(?=$|[/\\])/, homedir()),
  )

  log(`[release-uninstall] home=${home} profile=${flags.profile}`)
  if (flags.dryRun) log('[release-uninstall] dry-run：只打印将删什么，不写文件')

  const result = uninstallFromProfile({
    home,
    profile: flags.profile,
    dryRun: flags.dryRun === true,
    keepCache: flags.keepCache === true,
    purge: flags.purge !== false,
    log,
  })

  if (!flags.dryRun) {
    log('')
    log('✅ 卸载完成。重启 dsh 生效：dsh --profile ' + flags.profile)
    if (result.removed.bundles.length === 0 && result.removed.dependencies.length === 0) {
      log('   （本次没有条目被移除——profile 里本来就没有本工具链装的东西）')
    }
  }
  return result
}

if (process.argv[1] !== undefined && /release-uninstall\.mjs$/.test(process.argv[1])) {
  try {
    releaseUninstall()
  } catch (error) {
    console.error(`✗ ${error?.message ?? error}`)
    process.exit(1)
  }
}