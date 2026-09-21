/**
 * 服务级测试的公共夹具：**假 ctx + 临时 JSONL + 真实 `ScriptService`**。
 *
 * 抽成一份的理由与 `useApiResource.ts` 的头注一样 —— 同一个 hook/夹具被复制到两个测试文件，
 * 拆文件时最容易漏改其中一份。`cordis` 的 `Service` 构造只需要 `ctx.reflect.provide`，
 * 所以假 ctx 足够驱动**真实实现**（不是影子实现）。
 */
import assert from 'node:assert/strict'
import { appendFile, readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scriptViewSchema, type ScriptView } from 'dsh-script-wire'
import { ScriptService } from '../../src/script-service.ts'

/** 固定判定时刻（注入 now 的所有纯函数都用它，避免测试随时间漂移）。 */
export const NOW = 1_700_000_000_000

export interface RegisteredRoute {
  kind: string
  path: string
  handler: (req: unknown, res: unknown) => void
}

export interface Harness {
  readonly service: ScriptService
  readonly filePath: string
  /** 注册进假 webServer 的路由（HTTP 断言用真实 handler）。 */
  readonly routes: RegisteredRoute[]
  /** 宿主 emit 出来的事件（每项是 `ctx.emit` 的完整参数表）。 */
  readonly emits: unknown[][]
  /** `ctx.logger.warn` 收到的文本（"失败只 warn"类断言用）。 */
  readonly warnings: string[]
  /** 假 ctx 本体：测试可往上挂 `llm` / `agentDefaultModel` 这类可选服务。 */
  readonly ctx: Record<string, unknown>
  /**
   * 手动派发一个事件到已注册的处理器上。
   * 假 ctx 的 `emit` 只记录不派发（真实总线不在测试里），所以想要"事件驱动"的桥
   * 必须显式 fire —— 这也让"哪些事件该触发、哪些不该"变成可断言的事实。
   */
  readonly fire: (event: string, payload: unknown) => void
  readonly cleanup: () => Promise<void>
}

/** 建一个临时 store + 真实服务（不跑种子：测试自己造数据）。 */
export async function harness(): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-script-test-'))
  const routes: RegisteredRoute[] = []
  const emits: unknown[][] = []
  const warnings: string[] = []
  const listeners = new Map<string, ((payload: unknown) => void)[]>()
  const ctx: Record<string, unknown> = {
    // 真的把服务挂到 ctx 上（cordis `Service` 构造时调 `reflect.provide`）——
    // 假成 no-op 时 `ctx.script` 永远是 undefined，"事件驱动的桥"就断在这里，
    // 而且会以"处理器没跑"的形式表现，比报错更难查。
    reflect: { provide: (serviceName: string, value: unknown) => { ctx[serviceName] = value } },
    logger: {
      info: () => {},
      warn: (message: unknown) => { warnings.push(String(message)) },
      error: (message: unknown) => { warnings.push(String(message)) },
    },
    emit: (...args: unknown[]) => { emits.push(args) },
    effect: (callback: () => unknown) => callback(),
    on: (event: string, handler: (payload: unknown) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), handler])
      return () => {}
    },
    webServer: {
      register: (route: RegisteredRoute) => { routes.push(route); return () => {} },
    },
  }
  const filePath = join(dir, 'scripts.jsonl')
  const service = new ScriptService(ctx as never, { filePath, seed: false })
  await service.whenReady()
  const fire = (event: string, payload: unknown): void => {
    for (const handler of listeners.get(event) ?? []) handler(payload)
  }
  return { service, filePath, routes, emits, warnings, ctx, fire, cleanup: async () => { await rm(dir, { recursive: true, force: true }) } }
}

/** 完整合法的记录夹具（默认步骤带 id：否则不相干的夹具会因"同步骤 + 空 triggers"互相判重）。 */
export function record(overrides: Partial<ScriptView> = {}): ScriptView {
  const id = overrides.id ?? 's1'
  return scriptViewSchema.parse({
    id,
    name: overrides.name ?? '跑全套闸门',
    description: overrides.description ?? '合并前跑一次 check:all',
    steps: overrides.steps ?? [{ kind: 'tool-call', payload: 'pnpm check:all # ' + id }],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  })
}

/** 走真实写入口径落一条（`save` 只接受写输入，计量/状态由宿主维护）。 */
export async function seed(service: ScriptService, input: Partial<Record<string, unknown>> = {}): Promise<ScriptView> {
  const result = await service.save({
    name: '探针脚本',
    description: '用于回归',
    steps: [{ kind: 'tool-call', payload: 'pnpm check:all' }],
    ...input,
  }, { updatedBy: 'system' })
  assert.equal(result.kind, 'created')
  return (result as { kind: 'created'; record: ScriptView }).record
}

/** 直接落一行原始 JSON（造"缺新增字段的老记录"这类历史数据）。 */
export async function appendRaw(filePath: string, value: Record<string, unknown>): Promise<void> {
  await appendFile(filePath, JSON.stringify(value) + '\n', 'utf8')
}

/** 读原文用途的字节快照（"没写库"类断言的判据）。 */
export async function snapshot(filePath: string): Promise<string> {
  return await readFile(filePath, 'utf8')
}
