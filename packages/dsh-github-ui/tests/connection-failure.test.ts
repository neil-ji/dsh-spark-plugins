/**
 * 连接失败文案归一与反馈状态机的回归测试（验收项 PCQA-003 / PCQA-013）。
 *
 * 守三条不变量：
 *  - **不裸抛宿主英文技术串**：`github: GITHUB_TOKEN is not configured` 这类串
 *    必须映射成本包 locale 文案；
 *  - **未知错误也不失可读性**：带本地化前缀显示，原始串进 `detail`（title）可追查；
 *  - **反馈二选一**：失败带 `ok:false`，成功带 `ok:true`，不存在既错又「已保存」的状态。
 *
 * 同时守中英字典同 key 集（连接页两语字典必须逐 key 对齐）。
 */
import { describe, expect, it } from 'vitest'
import {
  HOST_MISSING_TOKEN_ERROR, describeActionFailure, describeConnectionFailure, succeeded,
} from '../src/client/connectionFailure.ts'
import { en, zh } from '../src/client/locales.ts'

type Key = keyof typeof zh

/** 与 dsh locale 运行时同形的取词（`{name}` 占位符替换）。 */
function bind(dict: Record<string, string>, key: Key, params?: Record<string, unknown>): string {
  const template = dict[key] ?? key
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    (params !== undefined && name in params ? String(params[name]) : match))
}

const t = (key: Key, params?: Record<string, unknown>): string => bind(zh, key, params)

describe('github 连接失败文案（PCQA-003）', () => {
  it('宿主缺令牌串映射成全中文文案，不含宿主技术串', () => {
    const failure = describeConnectionFailure(HOST_MISSING_TOKEN_ERROR, t)
    expect(failure.text).toBe('连接失败: 未配置 GitHub 访问令牌——请先粘贴 PAT 并测试连接')
    expect(failure.text).not.toContain('GITHUB_TOKEN')
    expect(failure.text).not.toContain('is not configured')
    expect(failure.text).not.toContain('MISSING_CREDENTIAL')
  })

  it('未知错误：保留原始 message 但挂本地化前缀，原始串进 detail 可追查', () => {
    const raw = 'socket hang up (ECONNRESET)'
    const failure = describeConnectionFailure(raw, t)
    expect(failure.text).toBe('连接失败: ' + raw)
    expect(failure.text.startsWith(t('testFail') + ': ')).toBe(true)
    expect(failure.detail).toBe(raw)
  })

  it('已知失败形态不把原始串落屏（detail 缺省）', () => {
    const failure = describeConnectionFailure('Bad credentials (401)', t)
    expect(failure.text).toBe('连接失败: ' + t('errInvalidToken'))
    expect(failure.text).not.toContain('401')
    expect(failure.detail).toBeUndefined()
  })

  it('空原始串退化成前缀本身，不产出「连接失败: 」这种半截文案', () => {
    expect(describeConnectionFailure('   ', t).text).toBe(t('testFail'))
  })

  it('页面动作失败走「操作失败」前缀', () => {
    expect(describeActionFailure('credentials: write failed', t).text)
      .toBe('操作失败: credentials: write failed')
    expect(describeActionFailure(HOST_MISSING_TOKEN_ERROR, t).text)
      .toBe('操作失败: ' + t('errTokenMissing'))
  })

  it('中英字典同 key 集，且两条连接失败文案都是全句（非空）', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    for (const key of ['testFail', 'errTokenMissing', 'errInvalidToken', 'actionFail'] as const) {
      expect(zh[key].length).toBeGreaterThan(0)
      expect(en[key].length).toBeGreaterThan(0)
    }
  })

  it('英文界面同样不裸抛宿主串', () => {
    const text = bind(en, 'testFail') + ': ' + bind(en, 'errTokenMissing')
    expect(text).not.toContain('GITHUB_TOKEN')
    expect(text.toLowerCase()).toContain('pat')
  })
})

describe('反馈状态机（PCQA-013）：成功 / 失败二选一', () => {
  it('失败反馈带 ok:false，成功反馈带 ok:true —— 不存在第三条路', () => {
    expect(describeConnectionFailure(HOST_MISSING_TOKEN_ERROR, t).ok).toBe(false)
    expect(describeActionFailure('boom', t).ok).toBe(false)
    expect(succeeded(t('saved')).ok).toBe(true)
    expect(succeeded(t('saved')).text).toBe('已保存')
  })
})
