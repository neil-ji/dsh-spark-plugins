/**
 * dsh-script host 入口（Spec §7）：装配脚本沉淀库。
 *
 * 规范源：`docs/SCRIPT-LIBRARY-SPEC.md`。
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: 拉起 `ctx.typert` 的宿主增强（register/withdraw）。
import type {} from '@deepseek-ai/dsh-typert-registry'
import { SCRIPT_HOST_CONTRIBUTION } from 'dsh-script-wire'
import { ScriptService, type ScriptConfig } from './script-service.ts'
import { ScriptEventsService } from './events-service.ts'
import { registerScriptTools } from './tool.ts'
import { registerScriptInjection, type InjectionConfig } from './injection.ts'
import { InjectStateStore, defaultInjectStatePath } from './inject-state.ts'
import { defaultScriptsFilePath } from './script-storage.ts'
import type {} from './types.ts'

export const name = 'dsh-script'
export const inject = ['webServer', 'tools', 'systemPrompt', 'typert'] as const

export interface ScriptPluginConfig extends ScriptConfig {
  injection?: InjectionConfig
}

const LIST_TOOL_NAME = 'script_list'
const INVOKE_TOOL_NAME = 'script_invoke'

export function apply(ctx: Context, config: ScriptPluginConfig = {}): void {
  const service = new ScriptService(ctx, config)
  const tools = registerScriptTools(ctx)
  const stateStore = new InjectStateStore(defaultInjectStatePath(config.filePath ?? defaultScriptsFilePath()))
  registerScriptInjection(ctx, config.injection ?? {}, {
    service,
    stateStore,
    listTool: tools.listTool,
    pluginName: name,
    listToolName: LIST_TOOL_NAME,
    invokeToolName: INVOKE_TOOL_NAME,
  })
  ctx.typert.register(SCRIPT_HOST_CONTRIBUTION)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const events = new ScriptEventsService(ctx)
  void service
  void events
}

export { ScriptService } from './script-service.ts'
export type { ScriptConfig, ScriptWriteContext } from './script-service.ts'
export { ScriptEventsService } from './events-service.ts'
export { scriptStreamFrames } from './events.ts'
export type { ScriptEventSource } from './events.ts'
export { registerScriptTools } from './tool.ts'
export { registerScriptHttpRoutes } from './http.ts'
export { registerScriptInjection, renderCatalogMessage, renderCatalogText, truncateDescription } from './injection.ts'
export type { InjectionConfig, InjectionDeps } from './injection.ts'
export {
  InjectStateStore, catalogDigest, parseInjectState, pruneInjectState, defaultInjectStatePath,
} from './inject-state.ts'
export type { CatalogEntry, InjectState, SessionInjectState } from './inject-state.ts'
export {
  JsonlScriptStorage, defaultScriptsFilePath, legacyScriptsFilePath, migrateLegacyScriptStore, upgradeLegacyRecord,
} from './script-storage.ts'
export {
  ScriptService as ScriptCatalogService, validateSteps, normalizeName, stepsFingerprint, jaccard, findDuplicate,
} from './script-service.ts'
export {
  isVisible, matchesScopeFilter, workspaceMatches, projectRoot, defaultHasProjectMarker,
} from './scope.ts'
export type { HasProjectMarker } from './scope.ts'
export { collectRecentCalls, matchScripts, renderScriptSuggestion, stringifyArgs } from './script-match.ts'
export type { RecentToolCall, ScriptMatch } from './script-match.ts'
export { seedDefaultScripts } from './seed-scripts.ts'
export { SEARCH_FIELD_WEIGHTS, matchScore, normalizeNeedle, searchHits, searchableFields } from './retrieval.ts'
export type { SearchField, SearchHit, SearchableRecord } from './retrieval.ts'
export {
  buildSearchTermsPrompt, enrichRecord, parseSearchTerms, resolveConfig as resolveTermsConfig,
} from './terms.ts'
export type { EnrichableRecord, ScriptTermsConfig, TermsDeps } from './terms.ts'
export type {
  ScriptView, ScriptSummary, ScriptStep, ScriptStepKind, ScriptScope, ScriptStatus, ScriptAuthor,
  ScriptSaveInput, ScriptListQuery, ScriptInvokeResult, ScriptsChangedEvent, ScriptStreamFrame, ScriptTopic,
} from 'dsh-script-wire'
