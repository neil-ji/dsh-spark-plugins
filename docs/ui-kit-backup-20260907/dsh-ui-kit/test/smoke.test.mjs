import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as kit from '../dist/index.js'

// 冒烟测试：验证 dist 产物（可摇树模块树）导出完整、基础组件可 SSR 渲染。
// 运行时渲染（交互/DOM）不在本层覆盖——保持零额外依赖。

test('dist 导出齐全（基础组件 + 工具 + 主题）', () => {
  for (const name of [
    'Button', 'Modal', 'Pill', 'Input', 'Menu', 'Tooltip', 'HoverCard',
    'Toast', 'StateDot', 'DisclosureRow', 'JsonTree', 'TerminalBlock',
    'DiffBlock', 'ReadBlock', 'SearchBlock', 'WebBlock', 'ConnectionBanner',
    'OnboardingSurface', 'RiskConfirmation', 'FishLogo', 'BrandWordmark',
    'CodeBlock', 'JsonBlock', 'MarkdownText', 'MessageText',
    'Checkbox', 'Textarea', 'SegmentedControl', 'SearchInput',
    'ListRow', 'SettingsCardHeader', 'Money',
    'setThemePreference', 'useIsDark', 'extractMarkdownPlainText',
    'writeClipboard',
  ]) {
    assert.ok(kit[name] !== undefined, name + ' 应导出')
  }
  assert.ok(Object.keys(kit).length > 60, '导出总数应超过 60（含 icons）')
})

test('Button 可 SSR 渲染并带出 label', () => {
  const html = renderToStaticMarkup(React.createElement(kit.Button, { label: '确认' }))
  assert.ok(html.includes('确认'), 'label 文本应出现在 HTML')
  assert.ok(/<button/.test(html), '应渲染为 button 元素')
})

test('Pill / StateDot / DisclosureRow SSR 渲染不抛错', () => {
  const pill = renderToStaticMarkup(React.createElement(kit.Pill, null, 'rc.6'))
  assert.ok(pill.includes('rc.6'))
  const dot = renderToStaticMarkup(React.createElement(kit.StateDot, { state: 'ok' }))
  assert.ok(dot.length > 0)
  const row = renderToStaticMarkup(React.createElement(kit.DisclosureRow, { icon: React.createElement('i'), title: '行', open: false, expandable: true, onToggle: () => {} }))
  assert.ok(row.includes('行'))
})

test('Modal 关闭态 SSR 渲染不抛错', () => {
  const html = renderToStaticMarkup(
    React.createElement(kit.Modal, { open: false, onClose: () => {}, title: '标题' }, React.createElement('div', null, '主体')),
  )
  assert.ok(typeof html === 'string')
})

test('JsonTree 可 SSR 渲染', () => {
  const html = renderToStaticMarkup(React.createElement(kit.JsonTree, { data: { a: 1, b: [2, 3] } }))
  assert.ok(html.length > 0)
})

test('markdown 模块可解析（import 不抛错）', () => {
  assert.ok(kit.MarkdownText !== undefined)
  assert.ok(typeof kit.extractMarkdownPlainText === 'function')
})

test('Checkbox / Textarea / SegmentedControl / SearchInput SSR 渲染', () => {
  const cb = renderToStaticMarkup(React.createElement(kit.Checkbox, { checked: true, onChange: () => {}, label: '权限' }))
  assert.ok(cb.includes('权限') && cb.includes('type="checkbox"') && cb.includes('checked'))
  const ta = renderToStaticMarkup(React.createElement(kit.Textarea, { value: '多行', readOnly: true }))
  assert.ok(ta.includes('多行') && ta.includes('<textarea'))
  const seg = renderToStaticMarkup(React.createElement(kit.SegmentedControl, {
    options: [{ value: 'compact', label: '紧凑' }, { value: 'standard', label: '标准' }],
    value: 'compact',
    onChange: () => {},
  }))
  assert.ok(seg.includes('紧凑') && seg.includes('aria-pressed="true"'))
  const search = renderToStaticMarkup(React.createElement(kit.SearchInput, { value: 'abc', onChange: () => {}, onClear: () => {}, clearLabel: '清除' }))
  assert.ok(search.includes('清除') && search.includes('type="text"'))
})

test('DisclosureRow 支持 description/trailing', () => {
  const html = renderToStaticMarkup(React.createElement(kit.DisclosureRow, {
    icon: React.createElement('i'), title: 'finance 配置', description: '连接与价格', trailing: React.createElement('span', null, '未保存'),
    open: false, expandable: true, onToggle: () => {},
  }))
  assert.ok(html.includes('finance 配置') && html.includes('连接与价格') && html.includes('未保存'))
})

test('ListRow / SettingsCardHeader SSR 渲染', () => {
  const row = renderToStaticMarkup(React.createElement(kit.ListRow, {
    title: '记忆标题',
    meta: React.createElement('span', null, '全局 · 0.8'),
    muted: true,
    onClick: () => {},
    trailing: React.createElement('button', null, 'x'),
  }))
  assert.ok(row.includes('记忆标题') && row.includes('全局 · 0.8'))
  const header = renderToStaticMarkup(React.createElement(kit.SettingsCardHeader, {
    title: '记忆插件', description: '容量与召回参数', open: false, onToggle: () => {},
    trailing: React.createElement('span', null, '未保存'),
    expandLabel: '展开', collapseLabel: '收起',
  }))
  assert.ok(header.includes('记忆插件') && header.includes('容量与召回参数') && header.includes('未保存'))
})

test('Money 输出金额 + 货币码（默认 amountCode）', () => {
  // 12_340_000 micros = 12.34 CNY → 12.3 (>= 10 → 1 位小数)
  const html = renderToStaticMarkup(React.createElement(kit.Money, { micros: 12_340_000, currency: 'CNY' }))
  assert.ok(html.includes('12.3'), '应当渲染 12.3')
  assert.ok(html.includes('CNY'), '应当渲染 CNY')
  assert.ok(html.includes('class="'), '应当带 size_m* class')
})

test('Money 各档位精度（formatMicros 助手）', () => {
  // >= 100 整数；>= 10 一位小数；< 10 两位
  assert.equal(kit.formatMicros(12_340_000), '12.3')    // 12.34 → 1 位
  assert.equal(kit.formatMicros(326_000_000), '326')      // 326 → 整数
  assert.equal(kit.formatMicros(1_234_567), '1.23')       // 1.23 → 2 位
  assert.equal(kit.formatMicros(0), '0.00')               // 0
  assert.equal(kit.formatMicros(-1_000_000), '-1.00')     // 负数也能处理
})

test('Money 各种 variant 都不抛错并能 SSR 渲染', () => {
  for (const variant of ['amount', 'amountCode', 'codeAmount', 'codeOnly']) {
    for (const size of ['sm', 'md', 'lg', 'xl']) {
      const html = renderToStaticMarkup(React.createElement(kit.Money, { micros: 1_000_000, currency: 'CNY', variant, size }))
      assert.ok(typeof html === 'string' && html.length > 0, variant + '/' + size + ' 应当渲染')
    }
  }
})

test('Money amountOnly 不渲染货币码', () => {
  const html = renderToStaticMarkup(React.createElement(kit.Money, { micros: 5_000_000, currency: 'CNY', variant: 'amount' }))
  assert.ok(html.includes('5.00'))
  assert.ok(!html.includes('CNY'), 'amountOnly 不应包含货币码')
})

test('Money codeOnly 仅渲染货币码', () => {
  const html = renderToStaticMarkup(React.createElement(kit.Money, { micros: 5_000_000, currency: 'USD', variant: 'codeOnly' }))
  assert.ok(html.includes('USD'))
  assert.ok(!html.includes('5.00'), 'codeOnly 不应包含金额')
})

test('Money estimated 标记带 ~', () => {
  const html = renderToStaticMarkup(React.createElement(kit.Money, { micros: 1_000_000, currency: 'CNY', estimated: true }))
  assert.ok(html.includes('~'), 'estimated 应当带 ~ 标记')
  assert.ok(html.includes('(estimated)'), 'aria-label 应当声明 estimated')
})
