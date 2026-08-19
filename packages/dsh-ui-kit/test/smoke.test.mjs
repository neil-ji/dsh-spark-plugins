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
