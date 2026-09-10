/**
 * hippomemo 事件契约（唯一声明处，ADR-002）。
 *
 * 与 `dsh-spark-wire` 同形：帧 schema + typert 描述符 + 两侧 contribution 都在这里，
 * host 的 emit 与 client 的订阅引用同一份声明，客户端不再手抄
 * `(event: { operation: string; id: string })` 那种影子契约。
 *
 * 该模块**不导出到包外**（hippomemo 的客户端订阅就住在自己包里）；
 * 若将来有第二个消费者（例如 dock 直接播报记忆写入），再提成 `./wire` 子路径导出。
 */
import { z } from 'zod'
import type { InvocationDescriptor, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'

/** `hippomemo/changed` 的载荷（与 `src/types.ts` 的 `HippomemoChanged` 同形）。 */
export const hippomemoChangedEventSchema = z.object({
  operation: z.enum(['put', 'deleted']),
  id: z.string().min(1),
})

/** 基线帧：客户端收到即重新拉取一次（世代之间的窗口不回放）。 */
export const hippomemoReadyFrameSchema = z.object({
  kind: z.literal('ready'),
  at: z.number().int().nonnegative(),
})

export const hippomemoStreamFrameSchema = z.discriminatedUnion('kind', [
  hippomemoReadyFrameSchema,
  z.object({ kind: z.literal('memory'), payload: hippomemoChangedEventSchema }),
])

export type HippomemoChangedEvent = z.infer<typeof hippomemoChangedEventSchema>
export type HippomemoStreamFrame = z.infer<typeof hippomemoStreamFrameSchema>

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    /** 一条流下发记忆变更（readiness 基线 + 变更帧），signal 由传输注入。 */
    'hippomemo/events': (signal?: AbortSignal) => AsyncIterable<HippomemoStreamFrame>
  }
  interface TypertRemoteNamespaceMap {
    hippomemo: {
      events: (signal?: AbortSignal) => AsyncIterable<HippomemoStreamFrame>
    }
  }
}

/** 事件流方法描述符：`mode: 'stream'` + 取消参数 + 逐项 codec。 */
export const HIPPOMEMO_INVOCATIONS: readonly InvocationDescriptor[] = [
  {
    id: 'dsh-hippomemo#hippomemo/events',
    service: 'hippomemoEvents',
    namespace: 'hippomemo',
    method: 'events',
    mode: 'stream',
    invocation: { kind: 'direct' },
    parameters: [],
    cancellation: { parameter: 'signal' },
    result: { mode: 'strict', typeSymbol: 'dsh-hippomemo#HippomemoStreamFrame', schema: hippomemoStreamFrameSchema },
  },
]

/** 宿主侧贡献：`ctx.typert.register(HIPPOMEMO_HOST_CONTRIBUTION)`。 */
export const HIPPOMEMO_HOST_CONTRIBUTION: TypertContribution = {
  package: 'dsh-hippomemo',
  face: 'host',
  schemas: [
    { name: 'HippomemoChangedEvent', schema: hippomemoChangedEventSchema },
    { name: 'HippomemoStreamFrame', schema: hippomemoStreamFrameSchema },
  ],
  model: { services: [], events: [], objects: [] },
  invocations: [...HIPPOMEMO_INVOCATIONS],
}

/** 客户端侧贡献：`ctx.remote.$mount(HIPPOMEMO_REMOTE_CONTRIBUTION)`。 */
export const HIPPOMEMO_REMOTE_CONTRIBUTION: TypertRemoteContribution = {
  package: 'dsh-hippomemo',
  descriptors: [...HIPPOMEMO_INVOCATIONS],
}
