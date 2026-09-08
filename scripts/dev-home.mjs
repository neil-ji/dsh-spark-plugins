#!/usr/bin/env node
/**
 * 沙箱 home 供给（线 2/3 共用）：幂等创建 .dev/home 与 dev profile，不碰 ~/.dsh。
 *
 * 用法：
 *   node scripts/dev-home.mjs                 # init（默认，幂等）
 *   node scripts/dev-home.mjs init --force    # 覆盖已生成的 profile 清单 / home 补丁
 *   node scripts/dev-home.mjs seed            # 从 ~/.dsh 复制 settings.yaml（显式动作）
 *   node scripts/dev-home.mjs seed --credentials   # 额外复制 .credentials.yaml（含密钥，谨慎）
 *   node scripts/dev-home.mjs doctor          # 校验补丁可组合 + 链接产物存在
 *   node scripts/dev-home.mjs reset --yes     # 删除整个 .dev/home
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  BUNDLES_BASE,
  DEV_DIR,
  DEV_PLUGIN_ENTRY,
  HOME_PATCH,
  LOG_DIR,
  PORT,
  PROFILE,
  PROFILE_DIR,
  PROFILE_MANIFEST,
  PROFILE_PATCH,
  PROFILE_WORKSPACE,
  REAL_DSH_HOME,
  SANDBOX_HOME,
  SANDBOX_WORKSPACE,
  STATE_FILE,
  exists,
  fileUrl,
  log,
  readJson,
  readText,
  runDsh,
  writeJson,
  writeText,
  yaml,
} from './dev-shared.mjs'

const argv = process.argv.slice(2)
const command = (argv[0] ?? 'init').replace(/^--/, '')
const has = (flag) => argv.includes(flag)

const PROFILE_WORKSPACE_TEXT = 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n'

const WORKSPACE_README = `# 沙箱工作区

dev 实例的默认 cwd（\`pnpm sandbox:up\` 会把 dsh 的工作目录指到这里），
这样插件/agent 写出来的文件落在这个目录里，而不是仓库源码树。

想让 dev 实例直接对仓库操作，用 \`pnpm sandbox:up -- --cwd <repo>\`。
`

function init() {
  const force = has('--force')
  log.step(`初始化沙箱 home：${SANDBOX_HOME}`)
  mkdirSync(PROFILE_DIR, { recursive: true })
  mkdirSync(SANDBOX_WORKSPACE, { recursive: true })
  mkdirSync(join(DEV_DIR, 'fixtures'), { recursive: true })
  mkdirSync(LOG_DIR, { recursive: true })

  // profile 清单：bundles 只放官方两个 bundle，插件包由 dev-profile link 追加
  if (!exists(PROFILE_MANIFEST) || force) {
    writeJson(PROFILE_MANIFEST, {
      name: `dsh-profile-${PROFILE}`,
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: [...BUNDLES_BASE], patchReload: 'live' } },
    })
    log.info(`写入 ${PROFILE_MANIFEST}`)
  } else {
    log.info('profile 清单已存在（保留）')
  }

  if (!exists(PROFILE_WORKSPACE) || force) {
    writeText(PROFILE_WORKSPACE, PROFILE_WORKSPACE_TEXT)
    log.info(`写入 ${PROFILE_WORKSPACE}`)
  }

  if (!exists(PROFILE_PATCH) || force) {
    writeText(PROFILE_PATCH, '# 由 scripts/dev-profile.mjs link 生成；手改会被下次 link 覆盖。\n[]\n')
    log.info(`写入 ${PROFILE_PATCH}`)
  }

  // home 层只放「环境级」行：dev 控制面板/探针。插件行一律放 profile 层，
  // 这样坏行只毁掉 dev profile，而不是这个 home 下的每个 profile。
  const desiredHomePatch = yaml([
    {
      insert: [
        { id: 'dev-control', name: fileUrl(DEV_PLUGIN_ENTRY) },
      ],
    },
  ])
  const header = '# 沙箱 home 补丁层：只放环境级 dev 行（控制面板/探针），插件行在 profile 层。\n'
  if (!exists(HOME_PATCH) || force) {
    writeText(HOME_PATCH, header + desiredHomePatch)
    log.info(`写入 ${HOME_PATCH}`)
  } else if (readText(HOME_PATCH).includes('dev-control')) {
    log.info('home 补丁已含 dev-control（保留）')
  } else {
    log.warn(`${HOME_PATCH} 已存在且不含 dev-control；用 --force 覆盖，或手工加入：`)
    log.info(desiredHomePatch.trimEnd())
  }

  if (!exists(join(SANDBOX_WORKSPACE, 'README.md'))) {
    writeText(join(SANDBOX_WORKSPACE, 'README.md'), WORKSPACE_README)
  }

  log.ok(`沙箱就绪：DSH_HOME=${SANDBOX_HOME} profile=${PROFILE}`)
  log.info('下一步：pnpm sandbox:link   （把工作区插件链接进 dev profile）')
  log.info(`启动：  pnpm sandbox:up     （dsh --profile ${PROFILE} --port ${PORT} --no-open）`)
}

function reset() {
  if (!has('--yes')) {
    log.fail('reset 会删除整个 .dev/home（含沙箱会话/存储）。确认请加 --yes')
    process.exit(1)
  }
  rmSync(SANDBOX_HOME, { recursive: true, force: true })
  rmSync(STATE_FILE, { force: true })
  rmSync(LOG_DIR, { recursive: true, force: true })
  log.ok('已删除 .dev/home、state.json、logs/')
}

function seed() {
  const targets = [['settings.yaml', join(REAL_DSH_HOME, 'settings.yaml')]]
  if (has('--credentials')) targets.push(['.credentials.yaml', join(REAL_DSH_HOME, '.credentials.yaml')])
  for (const [name, source] of targets) {
    const dest = join(SANDBOX_HOME, name)
    if (!exists(source)) {
      log.warn(`源不存在，跳过：${source}`)
      continue
    }
    if (exists(dest) && !has('--force')) {
      log.warn(`${dest} 已存在，跳过（--force 覆盖）`)
      continue
    }
    cpSync(source, dest)
    log.ok(`复制 ${source} → ${dest}（快照，不会反向写回）`)
  }
  const envExample = join(SANDBOX_HOME, '.env.example')
  if (!exists(envExample)) {
    writeText(envExample, [
      '# 沙箱 provider 凭据：复制成 .env 后填写。注意 DSH_* 名字在 .env 里被禁止。',
      '# DASHSCOPE_API_KEY=',
      '# DEEPSEEK_API_KEY=',
      '# TENCENT_API_KEY=',
      '',
    ].join('\n'))
    log.info(`写入 ${envExample}`)
  }
}

function doctor() {
  let failures = 0
  log.step('校验沙箱配置')

  for (const file of [PROFILE_MANIFEST, PROFILE_PATCH, PROFILE_WORKSPACE, HOME_PATCH]) {
    if (exists(file)) log.ok(`存在 ${file}`)
    else {
      log.fail(`缺失 ${file}（先跑 pnpm sandbox:init）`)
      failures++
    }
  }

  if (!exists(DEV_PLUGIN_ENTRY)) {
    log.fail(`缺失 dev 控制插件入口 ${DEV_PLUGIN_ENTRY}`)
    failures++
  }

  if (exists(PROFILE_MANIFEST)) {
    const manifest = readJson(PROFILE_MANIFEST)
    for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
      const target = String(spec).replace(/^link:/, '')
      const linked = exists(target)
      log.info(`${linked ? '✓' : '✗'} 链接依赖 ${name} → ${target}`)
      if (!linked) failures++
    }
  }

  // 真正的问题几乎都出在补丁组合：用 dsh 自己的 dump 当解析器
  log.step('dsh --dump-config（补丁组合校验）')
  try {
    const output = runDsh(['--profile', PROFILE, '--dump-config'])
    const rows = output.split('\n').filter((line) => /^\s*-?\s*id:/.test(line)).length
    log.ok(`补丁可组合，展开 ${rows} 行`)
  } catch (error) {
    log.fail(`补丁组合失败：${String(error.stderr ?? error.message).split('\n').slice(0, 6).join('\n')}`)
    failures++
  }

  if (failures === 0) log.ok('doctor 通过')
  else {
    log.fail(`doctor 发现 ${failures} 个问题`)
    process.exit(1)
  }
}

switch (command) {
  case 'init':
    init()
    break
  case 'reset':
    reset()
    break
  case 'seed':
    seed()
    break
  case 'doctor':
    doctor()
    break
  default:
    log.fail(`未知子命令 ${command}（可用：init | seed | doctor | reset）`)
    process.exit(1)
}
