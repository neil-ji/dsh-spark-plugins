/**
 * 首次启动时种子脚本（Phase 5 + 2026-09-16）。
 *
 * 问题：之前 scripts.jsonl 为空 → C 档「最近工具序列命中脚本 triggers」永远无法
 * 命中 → 用户跑了 pnpm sandbox:install / pnpm check:all 也不会被建议调现成
 * 脚本。结果：脚本目录永远是空的，「开箱即用」永远不开箱。
 *
 * 修复：在 SparkService init 末尾判断 scripts.jsonl 是否为空；为空时塞 3 条
 * 最常用的命令链。**只在文件不存在或为空时写**，绝不覆盖已有脚本。
 *
 * 三条选择标准（2026-09-16）：
 *   1. **sandbox:install**：开发者改完插件源码后必跑（重装 + 验证）；
 *   2. **check:all**：合并前必跑（架构闸门 + 版本纪律 + 反差审计 + 价格自洽）；
 *   3. **release:pack**：发布新版本前的打包（pnpm 链 → 打包 tarball → install-profile 复用）。
 *
 * 设计要点（与 AGENTS.md §0 铁律一致）：
 *   - **不轮询、不写死时间**：种子只在脚本存储为空时跑一次（事件驱动 = storage init）；
 *   - **可重入**：检测空文件才写，避免覆盖用户后续创建的自定义脚本；
 *   - **不引入新依赖**：种子在 host 包内部用 ScriptService.create，不外露 API。
 */

import type { ScriptCapture } from 'dsh-spark-wire'
import type { ScriptService } from './script-service.ts'
import { JsonlScriptStorage, defaultScriptsFilePath } from './script-storage.ts'

/** 3 条开箱即用脚本（顺序 = 在脚本目录里的默认排序）。 */
const SEED_SCRIPTS: ScriptCapture[] = [
  {
    name: '安装插件到沙箱',
    description: '把改完的插件源码重装到真宿主沙箱（sandbox:install）。改完代码后必跑。',
    steps: [
      { kind: 'instruction', payload: 'cd F:\\AgentStudio\\dsh-spark-plugins' },
      { kind: 'tool-call', payload: 'pnpm sandbox:install' },
    ],
    triggers: ['sandbox:install', 'install sandbox', 'install plugin'],
    scope: 'project',
    workspacePath: null,
    sourceSparkId: null,
  },
  {
    name: '跑全套闸门',
    description: '合并前跑一次 check:all（架构闸门 + 价格自洽 + 对比度审计 + 版本纪律）。',
    steps: [
      { kind: 'instruction', payload: 'cd F:\\AgentStudio\\dsh-spark-plugins' },
      { kind: 'tool-call', payload: 'pnpm check:all' },
    ],
    triggers: ['check:all', 'pnpm check', 'run gates'],
    scope: 'project',
    workspacePath: null,
    sourceSparkId: null,
  },
  {
    name: '打包发布',
    description: '把全部插件打成 tarball（pnpm release:pack）。发版前用，产物写到 .pack-profile/。',
    steps: [
      { kind: 'instruction', payload: 'cd F:\\AgentStudio\\dsh-spark-plugins' },
      { kind: 'tool-call', payload: 'pnpm release:pack' },
    ],
    triggers: ['release:pack', 'pack release', 'pack tarball'],
    scope: 'project',
    workspacePath: null,
    sourceSparkId: null,
  },
]

/**
 * 若 scripts.jsonl 不存在或为空，则写入种子脚本。
 * 通过 ScriptService.create 走统一写入路径（写入事件、updateMeta 等都已挂在它身上）。
 * 失败只记日志——种子失败不应该让整个 plugin 启动崩。
 */
export async function seedDefaultScripts(script: ScriptService): Promise<void> {
  try {
    // 独立走 storage 直读，避免与 ScriptService.list 的语义耦合；
    // empty array → 没自定义脚本 → 触发种子。
    const probe = new JsonlScriptStorage(defaultScriptsFilePath())
    const existing = await probe.readAll()
    if (existing.length > 0) return
    for (const capture of SEED_SCRIPTS) {
      // 通过 ScriptService.create 写入（而不是直接调 storage.append），
      // 这样 scripts/changed 事件正确 emit，下游订阅者能立刻看到目录变化。
      await script.create(capture).catch(error => {
        // eslint-disable-next-line no-console
        console.warn('[dsh-spark] seed script failed: ' + String(capture.name) + ' — ' + String(error))
      })
    }
  } catch (error) {
    // 种子是 best-effort；记录后跳过，不阻断 plugin 启动。
    // eslint-disable-next-line no-console
    console.warn('[dsh-spark] seed default scripts skipped: ' + String(error))
  }
}
