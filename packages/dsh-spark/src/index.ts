/**
 * dsh-spark Host entry: mounts SparkService (ctx.spark), EmergeService
 * (ctx.emerge), ScriptService (ctx.script); registers agent-facing tools.
 */
import type { Context } from '@deepseek-ai/cordis'
import { SparkService } from './spark-service.ts'
import { EmergeService } from './emerge-service.ts'
import { ScriptService } from './script-service.ts'
import { ValenceService } from './valence-service.ts'
import type { SparkConfig } from './spark-service.ts'
import { registerSparkHttpRoutes } from './http.ts'
import { registerSparkTools } from './tool.ts'

export { SparkService, SparkNotFoundError, SparkHippoUnavailableError } from './spark-service.ts'
export type { SparkConfig } from './spark-service.ts'
export { EmergeService } from './emerge-service.ts'
export type { EmergeConfig, EmergeRunResult } from './emerge-service.ts'
export { ScriptService } from './script-service.ts'
export type { ScriptConfig } from './script-service.ts'
export { ValenceService } from './valence-service.ts'
export type { ValenceConfig, ValenceRunStats } from './valence-service.ts'
export { JsonlSparkStorage } from './storage.ts'
export { JsonlProposalStorage } from './proposal-storage.ts'
export { JsonlScriptStorage, defaultScriptsFilePath } from './script-storage.ts'
export type { SparkStorage, SparkChangedEvent, SparkRecordId, HippoPutInput } from './types.ts'
export { deriveTitle, buildHippoInputFromSpark } from './types.ts'
export { registerSparkHttpRoutes } from './http.ts'
export { registerSparkTools } from './tool.ts'
export { generateProposals, dedupKey, newProposalId } from './proposals.ts'

export type { SparkView, SparkCapture, SparkPatch, SparkCrystallize, SparkCrystallized, SparkId, SparkScope, SparkStatus } from 'dsh-spark-wire'
export type { ProposalView, ProposalType, ProposalLeverage, ProposalStatus, ReflectRequest } from 'dsh-spark-wire'
export type { ScriptView, ScriptStep, ScriptStepKind, ScriptCapture, ScriptInvokeResult } from 'dsh-spark-wire'

export const name = 'dsh-spark'
export const inject = ['webServer'] as const

export function apply(ctx: Context, config: SparkConfig = {}): void {
  const _spark = new SparkService(ctx, config)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _emerge = new EmergeService(ctx)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _script = new ScriptService(ctx)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _valence = new ValenceService(ctx)
  registerSparkTools(ctx)
  void _spark
  void _emerge
  void _script
  void _valence
}
