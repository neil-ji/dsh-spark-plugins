/**
 * 设计系统对比度闸门（WCAG 2.1 AA）+ token 完整性闸门。
 *
 * 这是「亮暗主题对比度」的回归测试：token 层（spark-tokens.css）里任何一个
 * 语义色被改浅/改深，这里立刻会红。配对表的语义与出处见 scripts/audit-contrast.mjs。
 *
 * 失败时先跑 `pnpm check:contrast`，它会打印每一对的前景色 / 背景色 / 实测比值。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { auditDesignDocs, auditPreviewParity, auditTokenCoverage, buildTokenTables, contrast, evalSpec, parseColor, runPairs } from '../audit-contrast.mjs'

const tables = buildTokenTables()

describe('颜色工具', () => {
  it('WCAG 对比度基准值正确', () => {
    expect(contrast(parseColor('#000000')!, parseColor('#ffffff')!)).toBeCloseTo(21, 1)
    expect(contrast(parseColor('#ffffff')!, parseColor('#ffffff')!)).toBeCloseTo(1, 2)
    // #767676 是经典的白底 AA 边界灰
    expect(contrast(parseColor('#767676')!, parseColor('#ffffff')!)).toBeGreaterThan(4.5)
    expect(contrast(parseColor('#777777')!, parseColor('#ffffff')!)).toBeLessThan(4.5)
  })

  it('token 链能穿透 var() 与 fallback', () => {
    expect(evalSpec(tables.light, '--spk-label-3')).not.toBeNull()
    expect(evalSpec(tables.light, 'mix(--spk-acc-spark, 14, --spk-surface-card)')).not.toBeNull()
    expect(evalSpec(tables.light, 'var(--not-a-token)')).toBeNull()
  })
})

describe('亮/暗主题对比度', () => {
  const pairs = runPairs(tables)
  const hard = pairs.filter((p) => !p.soft)

  it.each(hard.map((p) => [p.theme, p.id, p] as const))(
    '%s · %s 达标',
    (_theme, _id, p) => {
      expect(p.ratio, `${p.id}: fg ${p.fgHex} on bg ${p.bgHex}（实测 ${p.ratio?.toFixed(2)}，要求 ${p.min}）`).not.toBeNull()
      expect(p.ratio!).toBeGreaterThanOrEqual(p.min - 0.005)
    },
  )

  it('两个主题都覆盖到正文与非文本两档', () => {
    for (const theme of ['light', 'dark'] as const) {
      const rows = hard.filter((p) => p.theme === theme)
      expect(rows.some((r) => r.min === 4.5), `${theme} 缺少正文级配对`).toBe(true)
      expect(rows.some((r) => r.min === 3.0), `${theme} 缺少非文本级配对`).toBe(true)
    }
  })

  /** 逐条钉死「曾经踩过」的具体缺陷，防止改 token 时回退。 */
  it('回归：分段控件选中项在亮色主题可见（旧值 1.14:1）', () => {
    const row = hard.find((p) => p.theme === 'light' && p.id === 'seg selected label on thumb')
    expect(row?.ratio).toBeGreaterThanOrEqual(4.5)
  })

  it('回归：品牌实底 + 反白标签在两个主题都达标（旧值 4.33:1）', () => {
    for (const theme of ['light', 'dark'] as const) {
      const row = hard.find((p) => p.theme === theme && p.id === 'on-brand on brand fill')
      expect(row?.ratio, theme).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('回归：模块 accent 文字态在亮色白底达标（旧值 1.87-4.38:1）', () => {
    for (const m of ['spark', 'hippomemo', 'finance', 'github', 'npm']) {
      const row = hard.find((p) => p.theme === 'light' && p.id === `${m} 文字态图标 on 卡片`)
      expect(row?.ratio, m).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('token 完整性', () => {
  it('插件 CSS 不引用未桥接的 --dsw-* / 未定义的 --spk-*', () => {
    const findings = auditTokenCoverage(tables)
    const errors = findings.filter((f) => f.severity === 'error')
    expect(
      errors,
      errors.map((f) => `${f.file}:${f.line} ${f.name}（无 fallback，属性会直接失效）`).join('\n'),
    ).toEqual([])
  })

  it('--spk-acc-* 的实色档与文字态档都齐备（五模块 × 两主题）', () => {
    for (const theme of ['light', 'dark'] as const) {
      for (const m of ['spark', 'hippomemo', 'finance', 'github', 'npm']) {
        expect(evalSpec(tables[theme], `--spk-acc-${m}`), `${theme} --spk-acc-${m}`).not.toBeNull()
        expect(evalSpec(tables[theme], `--spk-acc-${m}-fg`), `${theme} --spk-acc-${m}-fg`).not.toBeNull()
      }
    }
  })
})

describe('设计系统文档', () => {
  it('Source of Truth 文档不自造颜色（色值必须来自 token 层）', () => {
    const drift = auditDesignDocs()
    expect(
      drift,
      drift.map((d) => `${d.file}:${d.line} ${d.hex}`).join('\n'),
    ).toEqual([])
  })

  it('spark-dock MASTER 定调「冷灰 + DSH 品牌蓝」，不残留「暖炭/琥珀」品牌方案', () => {
    const doc = readFileSync(new URL('../../design-system/spark-dock/MASTER.md', import.meta.url), 'utf8')
    expect(doc).toContain('#4d6bfe')
    // 暖炭中性阶（v2 废弃方案的特征值）不得再作为语义取值出现
    for (const stale of ['#14120f', '#1d1a16', '#28241e', '#343028', '#faf9f6']) {
      expect(doc, `MASTER 仍残留 v2 暖炭色 ${stale}`).not.toContain(stale)
    }
  })

  it('静态设计稿的语义值与产品 token 逐值一致（唯一视觉源）', () => {
    const drift = auditPreviewParity(tables)
    expect(
      drift,
      drift.map((d) => `[${d.theme}] ${d.name}: ${d.issue}`).join('\n'),
    ).toEqual([])
  })
})
