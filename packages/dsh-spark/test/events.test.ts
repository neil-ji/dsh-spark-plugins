/**
 * 统一事件通道（ADR-001/002）的契约与桥接测试。
 *
 * 覆盖三件不变量：
 *  1. 描述符形状 —— `mode: 'stream'` + `cancellation.signal` + 逐项 codec（客户端据此
 *     生成 `AsyncIterable`，宿主据此把方法当流派发）；
 *  2. 帧契约 —— `ready` 基线帧在前，变更帧按发生顺序，且每帧都能过 wire schema；
 *  3. 取消语义 —— abort 后立即结束迭代并解除全部 cordis 订阅（不再泄漏 handler）。
 *
 * 注：`@Remote` 装饰器不可擦除（Node type-stripping 只支持可擦除语法），
 * 所以测的是被它包装的 `sparkStreamFrames()` 纯函数与 wire 描述符本身。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SPARK_HOST_CONTRIBUTION,
  SPARK_INVOCATIONS,
  SPARK_REMOTE_CONTRIBUTION,
  sparkStreamFrameSchema,
  type ProposalsChangedEvent,
  type SparkChangedEvent,
  type SparkStreamFrame,
} from 'dsh-spark-wire'
import { sparkStreamFrames, type SparkEventSource } from '../src/events.ts'

const NOW = 1_700_000_000_000

const sparkChange: SparkChangedEvent = {
  operation: 'capture',
  id: 'spk-1',
  record: {
    id: 'spk-1',
    title: 't',
    content: 'c',
    scope: 'project',
    workspacePath: null,
    status: 'active',
    tags: [],
    sourceSessionId: 'sess-1',
    sourceAgentId: null,
    sourceTurn: null,
    createdAt: NOW,
    updatedAt: NOW,
    stateChangedAt: NOW,
    deletedAt: null,
  },
  at: NOW,
}

const proposalChange: ProposalsChangedEvent = { at: NOW, newProposals: [], resolvedProposal: null }

/** 可控的事件源替身：记录订阅数，支持手工 emit。 */
function createSource(): SparkEventSource & { emit: (event: string, change: unknown) => void; subscriptions: () => number } {
  const handlers = new Map<string, Set<(change: never) => void>>()
  return {
    on(event: string, listener: (change: never) => void) {
      let set = handlers.get(event)
      if (set === undefined) { set = new Set(); handlers.set(event, set) }
      set.add(listener)
      return () => { set.delete(listener) }
    },
    emit(event, change) {
      for (const listener of handlers.get(event) ?? []) listener(change as never)
    },
    subscriptions() {
      let total = 0
      for (const set of handlers.values()) total += set.size
      return total
    },
  } as SparkEventSource & { emit: (event: string, change: unknown) => void; subscriptions: () => number }
}

/** 拉一帧（带超时，避免桥接卡死时测试挂起）。 */
function nextFrame(iterator: AsyncIterator<SparkStreamFrame>): Promise<IteratorResult<SparkStreamFrame>> {
  return Promise.race([
    iterator.next(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('frame timeout')), 1000)),
  ])
}

test('descriptor: 事件流是 stream 方法，取消参数与逐项 codec 都在契约里', () => {
  const descriptor = SPARK_INVOCATIONS[0]
  assert.equal(descriptor.namespace, 'spark')
  assert.equal(descriptor.method, 'events')
  assert.equal(descriptor.mode, 'stream')
  assert.deepEqual(descriptor.cancellation, { parameter: 'signal' })
  assert.deepEqual(descriptor.parameters, [])
  assert.equal(descriptor.result.mode, 'strict')
  assert.equal(descriptor.result.schema, sparkStreamFrameSchema)
  // 两侧 contribution 引用同一份描述符（host 注册 / client mount）
  assert.deepEqual([...SPARK_HOST_CONTRIBUTION.invocations], [...SPARK_INVOCATIONS])
  assert.deepEqual([...SPARK_REMOTE_CONTRIBUTION.descriptors], [...SPARK_INVOCATIONS])
  assert.equal(SPARK_HOST_CONTRIBUTION.package, 'dsh-spark')
})

test('frame contract: ready 基线帧在前，随后按发生顺序给变更帧且每帧过 schema', async () => {
  const source = createSource()
  const iterator = sparkStreamFrames(source)[Symbol.asyncIterator]()

  const first = await nextFrame(iterator)
  assert.equal(first.done, false)
  assert.equal(first.value?.kind, 'ready')
  assert.equal(sparkStreamFrameSchema.safeParse(first.value).success, true)

  source.emit('sparks/changed', sparkChange)
  source.emit('proposals/changed', proposalChange)

  const kinds: string[] = []
  for (let i = 0; i < 2; i += 1) {
    const frame = await nextFrame(iterator)
    assert.equal(frame.done, false)
    assert.equal(sparkStreamFrameSchema.safeParse(frame.value).success, true, '每帧都必须过 wire schema')
    kinds.push(frame.value!.kind)
  }
  assert.deepEqual(kinds, ['spark', 'proposal'], '帧序 = emit 顺序（script 主题已随脚本库迁出）')
  await iterator.return?.(undefined)
})

test('cancellation: abort 结束迭代并解除全部订阅', async () => {
  const source = createSource()
  const controller = new AbortController()
  const iterator = sparkStreamFrames(source, controller.signal)[Symbol.asyncIterator]()
  await nextFrame(iterator)
  assert.equal(source.subscriptions(), 2, '两条 cordis 事件各订阅一次')

  controller.abort()
  const ended = await nextFrame(iterator)
  assert.equal(ended.done, true, 'abort 后迭代立即结束')
  assert.equal(source.subscriptions(), 0, '订阅全部解除')
})

test('cancellation: 已 abort 的信号不会挂上订阅', async () => {
  const source = createSource()
  const controller = new AbortController()
  controller.abort()
  const iterator = sparkStreamFrames(source, controller.signal)[Symbol.asyncIterator]()
  assert.equal(source.subscriptions(), 0)
  const first = await nextFrame(iterator)
  assert.equal(first.value?.kind, 'ready', '基线帧仍然给出（消费者据此 resync 后收流）')
  const ended = await nextFrame(iterator)
  assert.equal(ended.done, true)
})

test('frame schema: 拒绝不在契约里的 kind 与缺字段的载荷', () => {
  assert.equal(sparkStreamFrameSchema.safeParse({ kind: 'nope' }).success, false)
  assert.equal(sparkStreamFrameSchema.safeParse({ kind: 'spark', payload: { operation: 'capture' } }).success, false)
  assert.equal(sparkStreamFrameSchema.safeParse({ kind: 'spark', payload: sparkChange }).success, true)
  assert.equal(sparkStreamFrameSchema.safeParse({ kind: 'ready', at: NOW }).success, true)
})
