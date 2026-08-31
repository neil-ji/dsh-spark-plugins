/**
 * ScriptService: host-side procedural script orchestrator (Phase 5).
 *
 * Phase 5 MVP: create / list / get / invoke / recordResult / delete.
 * Phase 5.5+: tool-call auto-suggestion when an agent's recent tool
 * sequence matches a script's triggers.
 */
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  scriptCaptureSchema,
  scriptListQuerySchema,
  scriptViewSchema,
  type ScriptView,
  type ScriptCapture,
  type ScriptListQuery,
  type ScriptInvokeResult,
} from 'dsh-spark-wire'
import { JsonlScriptStorage, defaultScriptsFilePath } from './script-storage.ts'
import { registerSparkHttpRoutes } from './http.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    script: ScriptService
  }
  interface Events {
    'scripts/changed'(change: { at: number; operation: 'create' | 'invoke' | 'delete' | 'result' }): void
  }
}

export interface ScriptConfig {
  filePath?: string
}

function defaultFilePath(): string {
  try {
    return defaultScriptsFilePath()
  } catch {
    const home = process.env['DSH_HOME'] ?? join(homedir(), '.dsh')
    return join(home, 'storages', 'sparks', 'scripts.jsonl')
  }
}

export class ScriptService extends Service {
  static inject = ['webServer'] as const

  private readonly filePath: string
  private storage: JsonlScriptStorage
  private httpRegistered = false

  constructor(ctx: Context, config: ScriptConfig = {}) {
    super(ctx, 'script')
    this.filePath = config.filePath ?? defaultFilePath()
    this.storage = new JsonlScriptStorage(this.filePath)
    this.ensureDir()
      .then(() => this.ensureRegistered(ctx))
      .catch(error => { ctx.logger?.error?.('script: init failed: ' + String(error)) })
  }

  private async ensureDir(): Promise<void> {
    const idx = this.filePath.lastIndexOf('/')
    const dir = idx >= 0 ? this.filePath.slice(0, idx) : this.filePath
    await fs.mkdir(dir, { recursive: true })
  }

  private ensureRegistered(ctx: Context): void {
    if (this.httpRegistered) return
    registerSparkHttpRoutes(ctx, ctx.spark as Parameters<typeof registerSparkHttpRoutes>[1], this)
    this.httpRegistered = true
  }

  async create(input: unknown, now: number = Date.now()): Promise<ScriptView> {
    const parsed: ScriptCapture = scriptCaptureSchema.parse(input)
    const record: ScriptView = scriptViewSchema.parse({
      id: randomUUID(),
      name: parsed.name,
      description: parsed.description,
      steps: parsed.steps,
      triggers: parsed.triggers,
      scope: parsed.scope,
      workspacePath: parsed.workspacePath,
      invocationCount: 0,
      successCount: 0,
      failureCount: 0,
      createdAt: now,
      updatedAt: now,
      lastInvokedAt: null,
      sourceSparkId: parsed.sourceSparkId,
    })
    await this.storage.append(record)
    this.ctx.emit('scripts/changed', { at: now, operation: 'create' })
    return record
  }

  async list(input: unknown = {}): Promise<ScriptView[]> {
    const q: ScriptListQuery = typeof input === 'object' && input !== null && Object.keys(input as object).length > 0
      ? scriptListQuerySchema.parse(input)
      : { limit: 100 }
    const all = await this.storage.readAll()
    let filtered = all
    if (q.scope !== undefined) filtered = filtered.filter(s => s.scope === q.scope)
    if (q.q !== undefined && q.q.trim().length > 0) {
      const needle = q.q.toLowerCase()
      filtered = filtered.filter(s =>
        s.name.toLowerCase().includes(needle) || s.description.toLowerCase().includes(needle))
    }
    filtered.sort((a, b) => b.updatedAt - a.updatedAt)
    return filtered.slice(0, q.limit ?? 100)
  }

  async get(id: string): Promise<ScriptView | null> {
    return this.storage.get(id)
  }

  async invoke(id: string, now: number = Date.now()): Promise<ScriptInvokeResult> {
    const current = await this.storage.get(id)
    if (current === null) throw new Error('script not found: ' + id)
    const updated = await this.storage.patch(id, {
      invocationCount: current.invocationCount + 1,
      lastInvokedAt: now,
    }, now)
    if (updated === null) throw new Error('script disappeared mid-invoke: ' + id)
    const successRate = updated.invocationCount === 0
      ? 0
      : updated.successCount / updated.invocationCount
    this.ctx.emit('scripts/changed', { at: now, operation: 'invoke' })
    return { script: updated, successRate }
  }

  async recordResult(id: string, success: boolean, now: number = Date.now()): Promise<ScriptView | null> {
    const current = await this.storage.get(id)
    if (current === null) return null
    const patch: Partial<ScriptView> = success
      ? { successCount: current.successCount + 1 }
      : { failureCount: current.failureCount + 1 }
    const updated = await this.storage.patch(id, patch, now)
    if (updated !== null) {
      this.ctx.emit('scripts/changed', { at: now, operation: 'result' })
    }
    return updated
  }

  async delete(id: string, now: number = Date.now()): Promise<boolean> {
    const removed = await this.storage.remove(id)
    if (removed) {
      this.ctx.emit('scripts/changed', { at: now, operation: 'delete' })
    }
    return removed
  }

  setStorageForTest(storage: JsonlScriptStorage): void {
    this.storage = storage
  }
}
