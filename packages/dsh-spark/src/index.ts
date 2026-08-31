/**
 * dsh-spark Host entry: mounts SparkService (ctx.spark) and EmergeService (ctx.emerge),
 * registers the model-facing tools (spark_capture, spark_crystallize, spark_reflect),
 * and sets up the /sparks + /proposals HTTP routes.
 */
import type { Context } from '@deepseek-ai/cordis'
import { SparkService } from './spark-service.ts'
import { EmergeService } from './emerge-service.ts'
import type { SparkConfig } from './spark-service.ts'
import type { EmergeConfig } from './emerge-service.ts'
import { registerSparkHttpRoutes } from './http.ts'
import { registerSparkTools } from './tool.ts'

export { SparkService, SparkNotFoundError, SparkHippoUnavailableError } from './spark-service.ts'
export type { SparkConfig } from './spark-service.ts'
export { EmergeService } from './emerge-service.ts'
export type { EmergeConfig, EmergeRunResult } from './emerge-service.ts'
export { JsonlSparkStorage } from './storage.ts'
export { JsonlProposalStorage } from './proposal-storage.ts'
export type { SparkStorage, SparkChangedEvent, SparkRecordId, HippoPutInput } from './types.ts'
export { deriveTitle, buildHippoInputFromSpark } from './types.ts'
export { registerSparkHttpRoutes } from './http.ts'
export { registerSparkTools } from './tool.ts'
export { generateProposals, dedupKey, newProposalId } from './proposals.ts'

export type { SparkView, SparkCapture, SparkPatch, SparkCrystallize, SparkCrystallized, SparkId, SparkScope, SparkStatus } from 'dsh-spark-wire'
export type { ProposalView, ProposalType, ProposalLeverage, ProposalStatus, ReflectRequest } from 'dsh-spark-wire'

export const name = 'dsh-spark'
export const inject = ['webServer'] as const

export function apply(ctx: Context, config: SparkConfig = {}): void {
  // Instantiate SparkService first — EmergeService depends on ctx.spark.
  const _spark = new SparkService(ctx, config)
  // EmergeService self-registers as ctx.emerge and mounts /proposals routes.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _emerge = new EmergeService(ctx)
  // Register agent-facing tools (spark_capture / crystallize / reflect).
  registerSparkTools(ctx)
  void _spark
  void _emerge
}
