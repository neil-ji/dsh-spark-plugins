/**
 * 宿主侧的 cordis 类型增强：服务名与事件主题（契约内容仍在 `dsh-script-wire`）。
 */
import type { ScriptsChangedEvent } from 'dsh-script-wire'
import type { ScriptService } from './script-service.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    script: ScriptService
  }
  interface Events {
    'scripts/changed'(change: ScriptsChangedEvent): void
  }
}
