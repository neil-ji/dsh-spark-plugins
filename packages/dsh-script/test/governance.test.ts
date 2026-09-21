/**
 * 治理不变量回归（Spec §8 A1：INV-8 / INV-11 + §6.2 取代链）。
 *
 * 治理动作的正确性靠纯函数守住：状态迁移只能改 status/修订字段、取代链不能断、
 * 物理删除只允许已归档、计量补丁不可凭空造数。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { scriptViewSchema, type ScriptView } from 'dsh-script-wire'
import {
  ScriptService,
  canPurge,
  invokePatch,
  resultPatch,
  revisionFor,
  statusPatch,
} from '../src/script-service.ts'
import { isVisible } from '../src/scope.ts'

const NOW = 1_700_000_000_000

function record(overrides: Partial<ScriptView> = {}): ScriptView {
  return scriptViewSchema.parse({
    id: overrides.id ?? 's1',
    name: overrides.name ?? '跑全套闸门',
    description: overrides.description ?? '合并前跑一次 check:all',
    steps: overrides.steps ?? [{ kind: 'tool-call', payload: 'pnpm check:all' }],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  })
}

test('物理删除只允许已归档条目（其余状态只能迁移，不能消失）', () => {
  assert.equal(canPurge(record({ status: 'archived' })), true)
  for (const status of ['active', 'candidate', 'superseded'] as const) {
    assert.equal(canPurge(record({ status })), false, status + ' 不该允许物理删除')
  }
})

test('取代链：superseded 必须带取代者 id，否则拒绝（链不能断）', () => {
  assert.deepEqual(statusPatch('superseded', 'new-id'), { status: 'superseded', supersededBy: 'new-id' })
  assert.throws(() => statusPatch('superseded', null), /必须带 supersededBy/)
  assert.deepEqual(statusPatch('archived', null), { status: 'archived' })
})

test('状态迁移可逆：归档 → 回 active 只改 status，不动修订字段', () => {
  const archived = statusPatch('archived', null)
  assert.equal(archived.status, 'archived')
  assert.equal('supersededBy' in archived, false)
  assert.equal('revision' in archived, false, '状态迁移不得改修订号')
  assert.equal('updatedBy' in archived, false, '作者只在写入时判定')
})

test('取代链上的新记录修订号 = 被取代者 + 1；无前驱则 1', () => {
  assert.equal(revisionFor(null), 1)
  assert.equal(revisionFor(record({ revision: 3 })), 4)
})

test('计量补丁：调用 / 结果各自可加，且不改历史成功数', () => {
  const base = record({ invocationCount: 2, successCount: 1, failureCount: 1 })
  assert.deepEqual(invokePatch(base, NOW + 5), { invocationCount: 3, lastInvokedAt: NOW + 5 })
  assert.deepEqual(resultPatch(base, true), { successCount: 2 })
  assert.deepEqual(resultPatch(base, false), { failureCount: 2 })
})

test('过期不等于删除：记录仍在，只是不可见（治理面仍能审计）', () => {
  const expired = record({ scope: 'global', expiresAt: NOW - 1 })
  assert.equal(isVisible(expired, '/repo', NOW), false)
  assert.equal(isVisible(record({ scope: 'global', expiresAt: NOW + 1 }), '/repo', NOW), true)
  assert.equal(isVisible(record({ scope: 'global', expiresAt: null }), '/repo', NOW), true)
})

test('成功率口径单源：补丁落库后才由服务重算（UI 侧不累计）', () => {
  const before = record({ invocationCount: 4, successCount: 3 })
  assert.equal(ScriptService.successRate(before), 0.75)
  // 记一次成功：先按计量补丁合并，再由服务算 —— 单一入口，没有第二处除法。
  const after = { ...before, ...resultPatch(before, true) }
  assert.equal(ScriptService.successRate(after), 1)
  assert.equal(ScriptService.successRate(record({ invocationCount: 0, successCount: 0 })), 0)
})
