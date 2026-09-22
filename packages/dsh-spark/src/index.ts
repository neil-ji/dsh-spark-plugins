/**
 * dsh-spark Host entry: mounts SparkService (ctx.spark), EmergeService
 * (ctx.emerge); registers agent-facing tools and the unified event stream
 * (`ctx.remote.spark.events()`).
 *
 * 2026-09-21：ScriptService（ctx.script）随脚本沉淀库迁出到独立插件 `dsh-script`。
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the `ctx.typert` host augmentation (register/withdraw).
import type {} from '@deepseek-ai/dsh-typert-registry'
import { SPARK_HOST_CONTRIBUTION } from 'dsh-spark-wire'
import { SparkService } from './spark-service.ts'
import { EmergeService } from './emerge-service.ts'
import { ValenceService } from './valence-service.ts'
import type { SparkConfig } from './spark-service.ts'
import { SparkEventsService } from './events-service.ts'
import { registerSparkTools } from './tool.ts'

export { SparkService, SparkNotFoundError } from './spark-service.ts'
export type { SparkConfig } from './spark-service.ts'
export { EmergeService } from './emerge-service.ts'
export type { EmergeConfig, EmergeRunResult } from './emerge-service.ts'
export { ValenceService } from './valence-service.ts'
export type { ValenceConfig, ValenceRunStats } from './valence-service.ts'
export { JsonlSparkStorage, SparkStoreConflictError, migrateSparkRecord, SPARK_STORE_VERSION } from './storage.ts'
export { renderInboxReminder } from './inbox.ts'
export { shouldReflect } from './reflect-scheduler.ts'
export { SparkMetaStore, defaultMetaPath, emptyMeta, parseMeta } from './meta-store.ts'
export type { SparkMeta, CommandFailureEntry } from './meta-store.ts'
export {
  normalizeCommand, errorSignature, isNoiseFailure, failureKey, recordFailure,
  clearFailuresForSuccess, eligibleForPromotion, pitfallsForModel, renderPitfallBriefing,
} from './command-mining.ts'
export { JsonlProposalStorage } from './proposal-storage.ts'
export { ensureJsonlPath, describeStorageError } from './jsonl-path.ts'
export type { SparkStorage, SparkRecordId } from './types.ts'
export { deriveTitle } from './types.ts'
export { registerSparkHttpRoutes } from './http.ts'
export { registerSparkTools } from './tool.ts'
export { SparkEventsService } from './events-service.ts'
export { sparkStreamFrames } from './events.ts'
export type { SparkEventSource } from './events.ts'
export { generateProposals, dedupKey, newProposalId } from './proposals.ts'

export type { SparkView, SparkCapture, SparkPatch, SparkId, SparkScope, SparkStatus, SparkStats } from 'dsh-spark-wire'
export type { ProposalView, ProposalType, ProposalLeverage, ProposalStatus, ReflectRequest } from 'dsh-spark-wire'
export type { SparkChangedEvent, SparkStreamFrame, SparkTopic } from 'dsh-spark-wire'

export const name = 'dsh-spark'
export const inject = ['webServer', 'tools', 'systemPrompt', 'typert'] as const

export function apply(ctx: Context, config: SparkConfig = {}): void {
  const _spark = new SparkService(ctx, config)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _emerge = new EmergeService(ctx)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _valence = new ValenceService(ctx)
  // 统一事件通道（ADR-001）：cordis 事件 → spark.events() stream 方法。
  ctx.typert.register(SPARK_HOST_CONTRIBUTION)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _events = new SparkEventsService(ctx)
  registerSparkTools(ctx)
  void _spark
  void _emerge
  void _valence
  void _events
}
