/**
 * dsh-spark Host entry: mounts SparkService (ctx.spark) and registers the
 * agent-facing spark_capture tool. The Web UI half lives in dsh-spark-ui.
 */
import type { Context } from '@deepseek-ai/cordis'
import { SparkService } from './spark-service.ts'
import type { SparkConfig } from './spark-service.ts'
import { registerSparkTools } from './tool.ts'

export { SparkService, SparkNotFoundError, SparkHippoUnavailableError } from './spark-service.ts'
export type { SparkConfig } from './spark-service.ts'
export { JsonlSparkStorage } from './storage.ts'
export type { SparkStorage, SparkChangedEvent, SparkRecordId, HippoPutInput } from './types.ts'
export { deriveTitle, buildHippoInputFromSpark } from './types.ts'
export { registerSparkHttpRoutes } from './http.ts'
export { registerSparkTools } from './tool.ts'

export type { SparkView, SparkCapture, SparkPatch, SparkCrystallize, SparkCrystallized, SparkId, SparkScope, SparkStatus } from 'dsh-spark-wire'

export const name = 'dsh-spark'
export const inject = ['webServer'] as const

/**
 * Mount the Spark cognitive-layer host service.
 * @param ctx - host context carrying webServer (for /sparks HTTP routes).
 * @param config - entry config (filePath, maxRecords).
 */
export function apply(ctx: Context, config: SparkConfig = {}): void {
  // Instantiate SparkService: it self-registers as ctx.spark and mounts /sparks routes.
  const _spark = new SparkService(ctx, config)
  // Register the agent-facing spark_capture tool against the live service.
  registerSparkTools(ctx)
  // Keep the local handle so future patches (disable-from-setting, hot reload) have a reference.
  void _spark
}
