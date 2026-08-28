/**
 * 插件设置卡片共享状态模型（dsh-spark-plugin-kit client）。
 *
 * 把「设置 → 插件 → 插件配置页」（settings.plugin.item）里插件配置卡片共用的
 * staged-form 状态机收敛成一个类：卡片暂存用户输入，只有保存时才通过
 * settingsScope 写回命名空间，与 shell/agent-loop 等官方插件卡片同一套语义
 * （覆盖徽标、reset、revision 校验、保存后回读）。每个插件只需提供字段 spec
 * （format/parse）+ 自己的展示组件；本模型不关心字段长什么样。
 *
 * 参考实现：dsh-spark-finance-client 的 FinanceCardController（rc.6 里官方
 * CardForm 未从 dsh-client-ui-settings-plugins 公开导出，这里按同一语义
 * 收敛到公共层供多插件复用）。
 */
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** 保存一个字段时执行的一次写入。 */
export type CardFieldWrite = { kind: 'set'; value: unknown } | { kind: 'clear' }

/** 一个字段如何在存储值 ↔ 草稿文本之间转换。 */
export interface CardFieldSpec {
  /** 命名空间 section 内的字段名。 */
  field: string
  /** 把存储值渲染成草稿文本；section 未携带该字段时返回空串。 */
  format: (value: unknown) => string
  /** 草稿文本 → 本次保存要执行的写入；草稿不是该字段接受的值时返回 undefined（阻止保存）。 */
  parse: (text: string) => CardFieldWrite | undefined
}

/** 一个控件渲染所需的字段状态。 */
export interface CardFieldState {
  /** 控件渲染的草稿文本。 */
  text: string
  /** 保存是否会留下用户层条目（覆盖徽标预览）。 */
  overridden: boolean
  /** 草稿不是该字段接受的值，会阻止保存。 */
  invalid: boolean
}

/** 所有插件卡片共享的表单状态。 */
export interface CardShellState {
  /** 命名空间未对客户端提供服务时卡片渲染为空。 */
  available: boolean
  /** 宿主文档是否接受写入。 */
  writable: boolean
  /** 表单是否持有保存会写出的编辑。 */
  dirty: boolean
  /** 是否存在无效草稿（阻止保存）。 */
  invalid: boolean
  /** 保存是否正在过线。 */
  saving: boolean
  /** 上次保存是否未按暂存落地（下次编辑/保存清除）。 */
  failed: boolean
}

/** 卡片快照：shell 状态 + 各字段状态。 */
export interface StagedSettingsCardState {
  shell: CardShellState
  fields: Record<string, CardFieldState>
}

/** 卡片插槽注入的表单动作。 */
export interface StagedCardActions {
  /** 暂存一个字段的草稿文本。 */
  edit: (field: string, text: string) => void
  /** 暂存一次清除，保存时让字段重新继承组合层。 */
  resetField: (field: string) => void
  /** 写出所有暂存编辑，然后按宿主接受的结果重新回填。 */
  save: () => void
  /** 丢弃所有暂存编辑。 */
  discard: () => void
}

/** JSON 相等（settings section 值按构造即为 JSON 数据）。 */
function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 自由文本字段：空草稿 = 清除（恢复组合层）。 */
export function textCardField(field: string): CardFieldSpec {
  return {
    field,
    format: (value) => (typeof value === 'string' ? value : ''),
    parse: (text) => (text.trim() === '' ? { kind: 'clear' } : { kind: 'set', value: text.trim() }),
  }
}

/** 正整数数字字段：空草稿 = 清除；非数字或非正整数阻止保存。 */
export function numberCardField(field: string): CardFieldSpec {
  return {
    field,
    format: (value) => (typeof value === 'number' ? String(value) : ''),
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      if (!/^\d+$/.test(trimmed)) return undefined
      const number = Number(trimmed)
      if (!Number.isSafeInteger(number) || number < 1) return undefined
      return { kind: 'set', value: number }
    },
  }
}

/** 布尔字段：由 Checkbox 驱动，草稿固定为 'true' / 'false'。 */
export function booleanCardField(field: string): CardFieldSpec {
  return {
    field,
    format: (value) => (value === true ? 'true' : value === false ? 'false' : ''),
    parse: (text) => {
      if (text === 'true') return { kind: 'set', value: true }
      if (text === 'false') return { kind: 'set', value: false }
      return text === '' ? { kind: 'clear' } : undefined
    },
  }
}

/** 单选字符串字段（如默认可见性 private/public）：只接受给定选项。 */
export function choiceCardField(field: string, choices: readonly string[]): CardFieldSpec {
  const set = new Set(choices)
  return {
    field,
    format: (value) => (typeof value === 'string' && set.has(value) ? value : ''),
    parse: (text) => {
      if (text === '') return { kind: 'clear' }
      return set.has(text) ? { kind: 'set', value: text } : undefined
    },
  }
}

type StagedEdit = { text: string; clear: boolean }
type PlannedWrite = { run: (() => Promise<boolean>) | undefined }

/**
 * 一个插件设置卡片：在一个 settings 命名空间上暂存编辑，保存时写回。
 * 通过快照 store 发布（slot 组件经快照选择器读取），scope 与本地草稿
 * 任一变化都会重建投影。
 */
export class StagedSettingsCard<T> {
  private readonly staged = new Map<string, StagedEdit>()
  private saving = false
  private failed = false

  /** 卡片快照 store（slot 渲染器绑定为 use<Name> 钩子）。 */
  readonly store: SnapshotStore<StagedSettingsCardState>

  /**
   * @param scope - 该卡片命名空间的绑定 settings scope。
   * @param specs - 卡片编辑的 section 字段。
   */
  constructor(
    private readonly scope: SettingsScope<T>,
    private readonly specs: readonly CardFieldSpec[],
  ) {
    this.store = createSnapshotStore<StagedSettingsCardState>(this.projection())
    scope.subscribe(() => this.publish())
  }

  private sectionValue(field: string): unknown {
    const value = this.scope.getSnapshot().value
    return isPlainObject(value) ? value[field] : undefined
  }

  /** 原始用户层（有则）；字段在这里的“存在”即覆盖。 */
  private userLayer(): Record<string, unknown> | undefined {
    const user = this.scope.getSnapshot().user
    return isPlainObject(user) ? user : undefined
  }

  private stored(field: string): boolean {
    const user = this.userLayer()
    return user !== undefined && Object.hasOwn(user, field)
  }

  private spec(field: string): CardFieldSpec | undefined {
    return this.specs.find(candidate => candidate.field === field)
  }

  /** 读取一个控件状态：草稿文本、覆盖标志、有效性。 */
  private fieldState(field: string): CardFieldState {
    const spec = this.spec(field)
    if (spec === undefined) return { text: '', overridden: false, invalid: false }
    const staged = this.staged.get(field)
    if (staged === undefined) {
      return { text: spec.format(this.sectionValue(field)), overridden: this.stored(field), invalid: false }
    }
    if (staged.clear) return { text: staged.text, overridden: false, invalid: false }
    const write = spec.parse(staged.text)
    return { text: staged.text, overridden: write?.kind === 'set', invalid: write === undefined }
  }

  /** 每次保存会写出的计划；无效草稿携带 undefined run（阻止保存）。 */
  private plan(): PlannedWrite[] {
    const plan: PlannedWrite[] = []
    for (const spec of this.specs) {
      const staged = this.staged.get(spec.field)
      if (staged === undefined) continue
      if (staged.clear) {
        if (this.stored(spec.field)) plan.push({ run: () => this.clearField(spec.field) })
        continue
      }
      const write = spec.parse(staged.text)
      if (write === undefined) {
        plan.push({ run: undefined })
        continue
      }
      if (write.kind === 'clear') {
        if (this.stored(spec.field)) plan.push({ run: () => this.clearField(spec.field) })
        continue
      }
      if (jsonEqual(write.value, this.sectionValue(spec.field))) continue
      plan.push({ run: () => this.storeField(spec.field, write.value) })
    }
    return plan
  }

  private shell(): CardShellState {
    const snapshot = this.scope.getSnapshot()
    const plan = this.plan()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: plan.length > 0,
      invalid: plan.some(item => item.run === undefined),
      saving: this.saving,
      failed: this.failed,
    }
  }

  private projection(): StagedSettingsCardState {
    const fields: Record<string, CardFieldState> = {}
    for (const spec of this.specs) fields[spec.field] = this.fieldState(spec.field)
    return { shell: this.shell(), fields }
  }

  private publish(): void {
    this.store.set(this.projection())
  }

  private stage(field: string, edit: StagedEdit): void {
    this.staged.set(field, edit)
    this.failed = false
    this.publish()
  }

  private async clearField(field: string): Promise<boolean> {
    await this.scope.unset(field)
    return !this.stored(field)
  }

  private async storeField(field: string, value: unknown): Promise<boolean> {
    await this.scope.set(field, value)
    const user = this.userLayer()
    return user !== undefined && Object.hasOwn(user, field) && jsonEqual(user[field], value)
  }

  /** 写出所有暂存编辑，然后按宿主接受的结果重新回填。 */
  private async save(): Promise<void> {
    const plan = this.plan()
    const writes = plan.flatMap(item => (item.run === undefined ? [] : [item.run]))
    if (plan.length === 0 || this.saving || writes.length !== plan.length) return
    this.saving = true
    this.failed = false
    this.publish()
    let landed = true
    for (const write of writes) landed = (await write()) && landed
    if (landed) this.staged.clear()
    this.saving = false
    this.failed = !landed
    this.publish()
  }

  /** 构建卡片插槽注入的表单动作（快照经 store 单独注入）。 */
  actions(): StagedCardActions {
    return {
      edit: (field, text) => this.stage(field, { text, clear: false }),
      resetField: (field) => {
        const spec = this.spec(field)
        this.stage(field, { text: spec === undefined ? '' : spec.format(this.sectionValue(field)), clear: true })
      },
      save: () => { void this.save() },
      discard: () => {
        if (this.staged.size === 0 && !this.failed) return
        this.staged.clear()
        this.failed = false
        this.publish()
      },
    }
  }
}
