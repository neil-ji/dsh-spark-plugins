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
import { DeriveService } from './derive-service.ts'
import { registerSparkTools } from './tool.ts'

export { SparkService, SparkNotFoundError } from './spark-service.ts'
export type { SparkConfig } from './spark-service.ts'
export { EmergeService } from './emerge-service.ts'
export type { EmergeConfig, EmergeRunResult } from './emerge-service.ts'
export { DeriveService, runDerivationRound, DEFAULT_DERIVE_TTL_DAYS } from './derive-service.ts'
export type { DeriveDeps } from './derive-service.ts'
export type { DeriveConfig } from './derive-service.ts'
export {
  selectDerivationPairs, checkRestatement, buildDerivePrompt, parseDerivedCandidates, partitionCandidates, RESTATEMENT_THRESHOLD,
} from './derive.ts'
export type { DerivationPair, DerivedCandidate } from './derive.ts'
export { ValenceService } from './valence-service.ts'
export type { ValenceConfig, ValenceRunStats } from './valence-service.ts'
export {
  detectIntensity, extractPreferences, candidateToSparkInput, decayImportance,
  minePreferences, isRealUserMessage, buildDedupPool, isDuplicateOfPool,
  DEFAULT_INTENSITY_THRESHOLD, DEFAULT_MAX_UTTERANCE_CHARS,
} from './valence.ts'
export type {
  PreferenceCandidate, ValenceMiningResult, ValenceSkipReason, ValenceDedupPool,
} from './valence.ts'
export { JsonlSparkStorage, SparkStoreConflictError, migrateSparkRecord, SPARK_STORE_VERSION } from './storage.ts'
export { renderInboxReminder, renderRelatedReminder, lastUserText } from './inbox.ts'
export {
  tokenize, jaccard, selectRelevant, substanceTokens, boilerplateTokens, jaccardWithout,
  MIN_DOCS_FOR_BOILERPLATE, DEFAULT_BOILERPLATE_DF_RATIO,
} from './relevance.ts'
export type { RelevantSpark, SelectRelevantOptions, BoilerplateOptions } from './relevance.ts'
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
export { deriveTitle, resolveProvenance, SparkProvenanceError, SPARK_MAX_GENERATION, applyRecall, isExpiredDerived, orderForPanel } from './types.ts'
export { registerSparkHttpRoutes } from './http.ts'
export { registerSparkTools } from './tool.ts'
export { SparkEventsService } from './events-service.ts'
export { sparkStreamFrames } from './events.ts'
export type { SparkEventSource } from './events.ts'
export { generateProposals, dedupKey, newProposalId } from './proposals.ts'

export type { SparkView, SparkCapture, SparkPatch, SparkId, SparkScope, SparkStatus, SparkOrigin, SparkStats } from 'dsh-spark-wire'
export type { ProposalView, ProposalType, ProposalLeverage, ProposalStatus, ReflectRequest } from 'dsh-spark-wire'
export type { SparkChangedEvent, SparkStreamFrame, SparkTopic } from 'dsh-spark-wire'

declare module '@deepseek-ai/cordis' {
  interface Context {
    derive: DeriveService
  }
}

export const name = 'dsh-spark'
export const inject = ['webServer', 'tools', 'systemPrompt', 'typert'] as const

export function apply(ctx: Context, config: SparkConfig = {}): void {
  const _spark = new SparkService(ctx, config)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _emerge = new EmergeService(ctx)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  // 配置面透传（valence 默认开启；见 SparkConfig.valence）。
  const _valence = new ValenceService(ctx, config.valence ?? {})
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _derive = new DeriveService(ctx)
  // 统一事件通道（ADR-001）：cordis 事件 → spark.events() stream 方法。
  ctx.typert.register(SPARK_HOST_CONTRIBUTION)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _events = new SparkEventsService(ctx)
  registerSparkTools(ctx)
  void _spark
  void _emerge
  void _valence
  void _derive
  void _events
}
