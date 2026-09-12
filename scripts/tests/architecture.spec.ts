/**
 * 架构闸门的回归测试。
 *
 * 两条最重要的断言是「拿真实仓库跑一遍」：孤包 = 0、边界违规 = 0、契约硬漂移 = 0。
 * 它们是整个 monorepo 的结构不变量 —— 谁把宿主半边 import 了 react、谁把 `<pkg>/embed`
 * 从插件里直接引、谁加了没登记进 registry 的包，这里立刻会红，且报得比 CI 更早。
 *
 * 另有一组纯函数单测，覆盖闸门自身的解析与判定（import 解析 / 角色推断 / 契约抽取），
 * 因为闸门本身写错会静默放过违规。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ALLOWED_EDGES,
  CONTRACTS,
  checkFileBoundaries,
  collectImports,
  extractDeclarations,
  extractInjectList,
  extractMembers,
  extractSourceLocations,
  findBoundaryViolations,
  findContractDrift,
  findInjectGaps,
  findOrphanPackages,
  findSecondProducts,
  halfOf,
  implementationLine,
  implementsMethod,
  inferRole,
  stripComments,
} from '../check-architecture.mjs'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
/** 角色查询表：模拟一个含各类角色的 workspace。 */
const roleOf = (name: string): string | undefined => ({
  'dsh-spark-dock': 'app',
  'dsh-ui-kit': 'ui-kit',
  'dsh-spark-plugin-kit': 'plugin-kit',
  'dsh-spark-wire': 'wire',
  'dsh-connector-github-ui': 'client',
  'dsh-connector-github': 'host',
  'dsh-connector-npm': 'host',
  'dsh-spark-finance': 'host',
  'dsh-spark-finance-client': 'client',
})[name]

describe('角色推断', () => {
  it('按包名 / dsh.client 声明判角色', () => {
    expect(inferRole({ name: 'dsh-spark-dock' })).toBe('app')
    expect(inferRole({ name: 'dsh-ui-kit' })).toBe('ui-kit')
    expect(inferRole({ name: 'dsh-spark-plugin-kit' })).toBe('plugin-kit')
    expect(inferRole({ name: 'dsh-connector-wire' })).toBe('wire')
    expect(inferRole({ name: 'dsh-connector-github-ui', dsh: { client: { platform: 'web' } } })).toBe('client')
    expect(inferRole({ name: 'dsh-connector-github' })).toBe('host')
  })

  it('只有 app 不受依赖边限制（它是唯一组装者）', () => {
    expect(ALLOWED_EDGES.app).toBeUndefined()
    expect(ALLOWED_EDGES.host).not.toContain('ui-kit')
    expect(ALLOWED_EDGES['ui-kit']).toEqual([])
  })
})

describe('import 解析', () => {
  it('剥掉注释里的假 import', () => {
    const source = [
      '/** 说明：所有插件图标一律 import { IconX } from \'dsh-ui-kit\' */',
      "import { Card } from 'dsh-ui-kit' // 注释里 from 'react'",
    ].join('\n')
    expect(collectImports(source)).toEqual([{ spec: 'dsh-ui-kit', typeOnly: false }])
  })

  it('多行 import 与 type-only / 裸 import / require 都要覆盖', () => {
    const source = [
      'import {',
      '  a,',
      '  b,',
      "} from 'multi/line'",
      "import type { T } from 'types-only'",
      "import './side-effect.css'",
      "const x = require('legacy')",
    ].join('\n')
    expect(collectImports(source)).toEqual([
      { spec: 'multi/line', typeOnly: false },
      { spec: 'types-only', typeOnly: true },
      { spec: './side-effect.css', typeOnly: false },
      { spec: 'legacy', typeOnly: false },
    ])
  })

  it('stripComments 不吞掉字符串里的正文', () => {
    expect(stripComments("const url = 'https://example.com/x'\n")).toContain('https://example.com/x')
  })

  it('半边判定按 src/client 切分', () => {
    expect(halfOf('packages/dsh-x/src/client/index.ts')).toBe('client')
    expect(halfOf('packages/dsh-x/src/index.ts')).toBe('host')
    expect(halfOf('packages/dsh-x/src/typert.remote-client.ts')).toBe('host')
  })
})

describe('边界规则', () => {
  const run = (input: { pkg: string, role: string, file: string, source: string }) =>
    checkFileBoundaries({
      pkg: input.pkg,
      role: input.role,
      file: input.file,
      imports: collectImports(input.source),
      roleOf,
    })

  it('宿主半边不得运行时 import react / ui-kit', () => {
    const violations = run({
      pkg: 'dsh-connector-github',
      role: 'host',
      file: 'packages/dsh-connector-github/src/index.ts',
      source: "import { useState } from 'react'\nimport { Card } from 'dsh-ui-kit'",
    })
    const codes = violations.map((entry) => entry.code)
    expect(codes).toContain('host-react')
    expect(codes).toContain('host-ui-kit')
    // ui-kit 不在 host 的允许边里，所以同一条 import 还会撞上依赖边规则 —— 这是有意的重复报。
    expect(codes).toContain('edge/host->ui-kit')
  })

  it('宿主半边 type-only 引 react 类型不算运行时耦合', () => {
    const violations = run({
      pkg: 'dsh-connector-github',
      role: 'host',
      file: 'packages/dsh-connector-github/src/index.ts',
      source: "import type { ReactNode } from 'react'",
    })
    expect(violations).toEqual([])
  })

  it('跨宿主依赖：运行时禁止，type-only 放行（npm 用 GitHubService 类型）', () => {
    const file = 'packages/dsh-connector-npm/src/launch.ts'
    expect(run({
      pkg: 'dsh-connector-npm', role: 'host', file, source: "import type { GitHubService } from 'dsh-connector-github'",
    })).toEqual([])
    const runtime = run({
      pkg: 'dsh-connector-npm', role: 'host', file, source: "import { GitHubService } from 'dsh-connector-github'",
    })
    expect(runtime.map((entry) => entry.code)).toEqual(['edge/host->host'])
  })

  it('只有 app 能组装插件 UI 产物（/embed），client 只能吃库的 /client', () => {
    const embed = run({
      pkg: 'dsh-connector-github', role: 'host', file: 'packages/dsh-connector-github/src/index.ts',
      source: "import { GithubSection } from 'dsh-connector-github-ui/embed'",
    })
    expect(embed.map((entry) => entry.code)).toContain('embed-outside-app')

    const kit = run({
      pkg: 'dsh-connector-github-ui', role: 'client', file: 'packages/dsh-connector-github-ui/src/client/index.ts',
      source: "import { bindSnapshotSelector } from 'dsh-spark-plugin-kit/client'",
    })
    expect(kit).toEqual([])

    expect(run({
      pkg: 'dsh-connector-github', role: 'host', file: 'packages/dsh-connector-github/src/index.ts',
      source: "import { bindSnapshotSelector } from 'dsh-spark-plugin-kit/client'",
    }).map((entry) => entry.code)).toContain('client-entry-outside-client')
  })

  it('平台子路径（@deepseek-ai/dsh-client-*/client）不算插件 UI 产物', () => {
    expect(run({
      pkg: 'dsh-spark-plugin-kit', role: 'plugin-kit', file: 'packages/dsh-plugin-kit/src/client/context.ts',
      source: "import type { SettingsScopeBinder } from '@deepseek-ai/dsh-client-ui-settings/client'",
    })).toEqual([])
  })

  it('F7：dock 的 fairy 呈现层不得 import 领域契约或插件 UI', () => {
    expect(run({
      pkg: 'dsh-spark-dock', role: 'app', file: 'packages/dsh-spark-dock/src/client/fairy/fairyEvents.ts',
      source: "import type { SparkStreamFrame } from 'dsh-spark-wire'",
    }).map((entry) => entry.code)).toContain('fairy-domain-import')

    expect(run({
      pkg: 'dsh-spark-dock', role: 'app', file: 'packages/dsh-spark-dock/src/client/fairy/fairyEvents.ts',
      source: "import { onAnnouncement, publishAnnouncement } from 'dsh-spark-plugin-kit/client'",
    })).toEqual([])
  })

  it('ui-kit 零平台依赖、wire 协议纯净、自引用不算跨包', () => {
    expect(run({
      pkg: 'dsh-ui-kit', role: 'ui-kit', file: 'packages/dsh-ui-kit/src/index.ts',
      source: "import { Context } from '@deepseek-ai/cordis'",
    }).map((entry) => entry.code)).toEqual(['ui-kit-platform'])

    expect(run({
      pkg: 'dsh-connector-wire', role: 'wire', file: 'packages/dsh-connector-wire/src/index.ts',
      source: "import { Context } from '@deepseek-ai/cordis'",
    }).map((entry) => entry.code)).toEqual(['wire-cordis'])

    expect(run({
      pkg: 'dsh-ui-kit', role: 'ui-kit', file: 'packages/dsh-ui-kit/src/components/icons.tsx',
      source: "import { IconSparkles } from 'dsh-ui-kit'",
    })).toEqual([])
  })
})

describe('契约抽取', () => {
  it('按 implementation ?? method 落实现名', () => {
    const source = [
      "      method: 'proxy.test',",
      "      implementation: 'proxyTestRemote',",
      '      // ----',
      "      method: 'events',",
      "      mode: 'stream',",
    ].join('\n')
    expect(extractDeclarations(source)).toEqual([
      { method: 'proxy.test', implementation: 'proxyTestRemote' },
      { method: 'events', implementation: 'events' },
    ])
  })

  it('sourceLocation 与 members 抽取', () => {
    const source = [
      "        method: 'getBalance',",
      "        sourceLocation: { file: 'packages/dsh-finance/src/index.ts', line: 96, column: 3 },",
      "        method: 'getLedger',",
      "        sourceLocation: { file: 'packages/dsh-finance/src/index.ts', line: 117, column: 3 },",
    ].join('\n')
    expect(extractSourceLocations(source)).toEqual([
      { method: 'getBalance', file: 'packages/dsh-finance/src/index.ts', line: 96 },
      { method: 'getLedger', file: 'packages/dsh-finance/src/index.ts', line: 117 },
    ])
    expect(extractMembers("members: [\n  { name: 'a', kind: 'method' },\n  { name: 'b', kind: 'method' },\n]")).toEqual(['a', 'b'])
  })

  it('实现定位跳过注释行', () => {
    const host = [
      'class Finance {',
      '  /** 见 listProviders 的说明 */',
      '  async listProviders(signal?: AbortSignal) {',
      '  }',
      '}',
    ].join('\n')
    expect(implementationLine(host, 'listProviders')).toBe(3)
    expect(implementsMethod(host, 'listProviders')).toBe(true)
    expect(implementsMethod(host, 'refreshBalance')).toBe(false)
    expect(implementationLine(host, 'refreshBalance')).toBeNull()
  })
})

describe('inject 面覆盖', () => {
  it('从 client 入口读出 inject 列表', () => {
    expect(extractInjectList("export const inject = ['locale', 'remote'] as const")).toEqual(['locale', 'remote'])
    expect(extractInjectList("export const inject = ['locale', 'remote', 'remote.credentials', 'slots']")).toEqual(['locale', 'remote', 'remote.credentials', 'slots'])
    expect(extractInjectList('const x = 1')).toBeNull()
  })

  it('真实仓库：client 插件用到的平台服务都写进了 inject', () => {
    const { violations, checked } = findInjectGaps(ROOT)
    expect(violations).toEqual([])
    // 五个出 web 客户端产物的插件（dock + github / npm / finance / hippomemo）
    expect(checked).toBeGreaterThanOrEqual(5)
  })
})

describe('单产物（P4）', () => {
  it('真实仓库：没有包再导出 / 构建 ./embed 第二产物', () => {
    const { violations, checked } = findSecondProducts(ROOT)
    expect(violations).toEqual([])
    expect(checked).toBeGreaterThanOrEqual(15)
  })
})

describe('真实仓库不变量', () => {
  it('没有孤包：每个 packages/* 都在 registry 闭包内', () => {
    const { orphans, total } = findOrphanPackages(ROOT)
    expect(orphans).toEqual([])
    expect(total).toBeGreaterThan(10)
  })

  it('依赖边界零违规', () => {
    const { violations, files } = findBoundaryViolations(ROOT)
    expect(violations).toEqual([])
    expect(files).toBeGreaterThan(50)
  })

  it('契约零漂移：实现存在、单源自洽、无 sourceLocation 告警', () => {
    const { failures, warnings, results } = findContractDrift(ROOT)
    expect(failures).toEqual([])
    expect(results.length).toBeGreaterThanOrEqual(5)
    // P5 之后 finance 也吃 wire 单源，描述符不再手抄 sourceLocation —— 告警必须为 0。
    expect(warnings).toEqual([])
  })

  it('契约单源：finance 的两份手抄 manifest 已删除，wire 成为唯一源', () => {
    const finance = CONTRACTS.find((entry) => entry.id === 'finance')
    expect(finance?.wire).toBe('packages/dsh-finance-wire/src/index.ts')
    expect(finance !== undefined && 'twin' in finance).toBe(false)
    for (const gone of [
      'packages/dsh-finance/src/typert.host.ts',
      'packages/dsh-finance/src/typert.remote-client.ts',
    ]) {
      expect(existsSync(join(ROOT, gone))).toBe(false)
    }
    // host 用 ctx.typert.register 显式注册，client $mount 同一份描述符。
    const host = readFileSync(join(ROOT, 'packages/dsh-finance/src/index.ts'), 'utf8')
    expect(host).toContain("ctx.inject(['typert']")
    expect(host).toContain('typertCtx.typert.register(FINANCE_HOST_CONTRIBUTION)')
    const client = readFileSync(join(ROOT, 'packages/dsh-finance-client/src/client/index.ts'), 'utf8')
    expect(client).toContain('FINANCE_REMOTE_CONTRIBUTION')
  })

  it('--strict-locations 在真实仓库上不再有可升级项', () => {
    const { failures } = findContractDrift(ROOT, { strictLocations: true })
    expect(failures).toEqual([])
  })
})
