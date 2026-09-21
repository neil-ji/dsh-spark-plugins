/**
 * 首次启动时的种子脚本（空库才写，绝不覆盖用户内容）。
 *
 * 三条都是本仓库开发者最常跑的命令链；`scope: 'global'` + `workspacePath: null`
 * 表示与工作区无关（Spec §2.3 的"未绑定"规则）。失败只记日志，不阻断启动。
 */
import type { ScriptSaveInput } from 'dsh-script-wire'
import type { ScriptService } from './script-service.ts'

const REPO_HINT = '在 dsh-spark-plugins 仓库根目录（含 pnpm-workspace.yaml）下执行'

const SEED_SCRIPTS: ScriptSaveInput[] = [
  {
    name: '安装插件到沙箱',
    description: '把改完的插件源码重装到真宿主沙箱（sandbox:install）。改完代码后必跑。',
    steps: [
      { kind: 'instruction', payload: REPO_HINT },
      { kind: 'tool-call', payload: 'pnpm sandbox:install' },
    ],
    triggers: ['sandbox:install', 'install sandbox', 'install plugin'],
    tags: ['dev', 'sandbox'],
    scope: 'global',
    workspacePath: null,
    expiresAt: null,
    supersedes: null,
    sourceSessionId: null,
    sourceAgentId: null,
    sourceTurn: null,
  },
  {
    name: '跑全套闸门',
    description: '合并前跑一次 check:all（架构闸门 + 价格自洽 + 对比度审计 + 版本纪律）。',
    steps: [
      { kind: 'instruction', payload: REPO_HINT },
      { kind: 'tool-call', payload: 'pnpm check:all' },
    ],
    triggers: ['check:all', 'pnpm check', 'run gates'],
    tags: ['dev', 'gates'],
    scope: 'global',
    workspacePath: null,
    expiresAt: null,
    supersedes: null,
    sourceSessionId: null,
    sourceAgentId: null,
    sourceTurn: null,
  },
  {
    name: '打包发布',
    description: '把全部插件打成 tarball（pnpm release:pack）。发版前用，产物写到 .pack-profile/。',
    steps: [
      { kind: 'instruction', payload: REPO_HINT },
      { kind: 'tool-call', payload: 'pnpm release:pack' },
    ],
    triggers: ['release:pack', 'pack release', 'pack tarball'],
    tags: ['dev', 'release'],
    scope: 'global',
    workspacePath: null,
    expiresAt: null,
    supersedes: null,
    sourceSessionId: null,
    sourceAgentId: null,
    sourceTurn: null,
  },
]

/**
 * 空库则写入种子（可重入：只按"库是否为空"判定，不覆盖用户脚本）。
 * @param script - 脚本服务。
 * @param now - 写入时间戳（可注入，便于测试）。
 */
export async function seedDefaultScripts(script: ScriptService, now: number = Date.now()): Promise<number> {
  try {
    const existing = await script.list({ limit: 1 })
    if (existing.length > 0) return 0
    let created = 0
    for (const capture of SEED_SCRIPTS) {
      const result = await script.save(capture, { updatedBy: 'system', workspacePath: null }, now)
        .catch(error => {
          // eslint-disable-next-line no-console
          console.warn('[dsh-script] seed failed: ' + capture.name + ' — ' + String(error))
          return undefined
        })
      if (result?.kind === 'created') created += 1
    }
    return created
  } catch (error) {
    // best-effort：种子失败不该让插件启动崩；但必须有出口（不要降级成静默 return）。
    // eslint-disable-next-line no-console
    console.warn('[dsh-script] seed skipped: ' + String(error))
    return 0
  }
}
