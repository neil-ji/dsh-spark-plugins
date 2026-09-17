/**
 * 连接页**渲染面**回归（验收项 PCQA-006 / PCQA-013 / PCQA-019）。
 *
 * 走真 GithubSection + react-dom/server 的 SSR 输出：可访问名、展开语义、按钮形制
 * 都是 DOM 属性，只有真渲染一次才能断言。无 DOM 依赖（不需要 jsdom）。
 *
 * PCQA-013 的「同屏只有一条播报」是**类型层**保证（Feedback 是可辨识联合，
 * 失败支根本不渲染成功播报）；这里额外断言静止态不预渲染任何「已保存」。
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Button } from 'dsh-ui-kit'
import { GithubSection } from '../src/client/GithubSection.tsx'
import { zh } from '../src/client/locales.ts'
import type { GithubSettingsState } from '../src/client/store.ts'

type Key = keyof typeof zh

function bind(dict: Record<string, string>, key: Key, params?: Record<string, unknown>): string {
  const template = dict[key] ?? key
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    (params !== undefined && name in params ? String(params[name]) : match))
}

const t = (key: Key, params?: Record<string, unknown>): string => bind(zh, key, params)

const CONFIG = {
  apiBase: 'https://api.github.com',
  tokenEnv: 'GITHUB_TOKEN',
  gitName: 'neil',
  gitEmail: 'neil@example.com',
  defaultVisibility: 'private' as const,
  gitProxy: '',
  allowCreateRepo: true, allowPush: true, allowPull: true, allowPullRequest: true,
  allowReview: true, allowPages: true, allowActions: true, allowIssues: true, allowRelease: true,
}

function render(state: GithubSettingsState): string {
  const controller = {
    load: () => Promise.resolve(),
    testConnection: () => Promise.resolve(undefined),
    saveToken: () => Promise.resolve(undefined),
    removeToken: () => Promise.resolve(undefined),
    testProxy: () => Promise.resolve({ ok: true, latencyMs: 1, host: 'github.com', error: null }),
    saveConfig: () => Promise.resolve(undefined),
  }
  const useSnapshot = (selector: (snapshot: GithubSettingsState) => unknown) => selector(state)
  return renderToStaticMarkup(createElement(GithubSection, {
    controller, useSnapshot, t,
  } as never) as never)
}

/** 抓出所有完整 <button …>…</button> 元素（属性 + 可见文本）。 */
function buttonsOf(html: string): string[] {
  return [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(match => match[0])
}

/** 取一个元素的属性原文（按钮自身的属性在最前）。 */
function attr(tag: string, name: string): string | undefined {
  return new RegExp(name + '="([^"]*)"').exec(tag)?.[1]
}

const READY: GithubSettingsState = {
  status: 'ready', error: null,
  credential: { configured: true, source: 'credentials', writable: true },
  config: CONFIG, whoami: undefined,
}

/** 未配置令牌的页面（PCQA-003 的现场）。 */
const EMPTY: GithubSettingsState = {
  ...READY, credential: { configured: false, writable: true },
}

describe('github 连接页渲染面', () => {
  it('PCQA-006：默认可见性按钮的可访问名含可见文本，并暴露展开语义', () => {
    const html = render(READY)
    const button = buttonsOf(html).find(tag => attr(tag, 'aria-haspopup') !== undefined)
    expect(button).toBeDefined()
    const label = attr(button as string, 'aria-label') ?? ''
    const visible = t('private')
    // WCAG 2.5.3 Label in Name：可访问名必须包含可见文本。
    expect(label).toContain(visible)
    expect(label).toBe(t('defaultVisibilityAria', { value: visible }))
    // 按钮的可见文本本身也在。
    expect(button as string).toContain('>' + visible + '<')
    expect(attr(button as string, 'aria-haspopup')).toBe('listbox')
    expect(attr(button as string, 'aria-expanded')).toBe('false')
  })

  it('PCQA-019：测试连接与保存令牌同为 secondary，只剩保存令牌是 primary', () => {
    const secondaryClass = attr(renderToStaticMarkup(createElement(Button, { variant: 'secondary' }, 'x')), 'class')
    const primaryClass = attr(renderToStaticMarkup(createElement(Button, { variant: 'primary' }, 'x')), 'class')
    expect(secondaryClass).not.toBe(primaryClass)

    const html = render(READY)
    const testTag = buttonsOf(html).find(tag => tag.includes(t('testConnection')))
    const saveTag = buttonsOf(html).find(tag => tag.includes(t('saveToken')))
    expect(testTag).toBeDefined()
    expect(saveTag).toBeDefined()
    expect(attr(testTag as string, 'class')).toBe(secondaryClass)
    expect(attr(saveTag as string, 'class')).toBe(primaryClass)
    // 连接卡里只有一个按钮，primary 只剩「保存令牌」。
    const primaries = buttonsOf(html).filter(tag => attr(tag, 'class') === primaryClass)
    expect(primaries.length).toBe(1)
  })

  it('PCQA-019：同一张身份卡里的两个次级按钮同尺寸（私有 / 测试代理）', () => {
    const html = render(READY)
    const visibilityTag = buttonsOf(html).find(tag => attr(tag, 'aria-haspopup') !== undefined) as string
    const proxyTag = buttonsOf(html).find(tag => tag.includes(t('testProxy'))) as string
    expect(visibilityTag).toBeDefined()
    expect(proxyTag).toBeDefined()
    // 同 variant + 同 size（与工厂里的 secondary/md 完全一致）。
    expect(attr(visibilityTag, 'class')).toBe(attr(proxyTag, 'class'))
    expect(attr(visibilityTag, 'class')).toBe(attr(renderToStaticMarkup(createElement(Button, { variant: 'secondary' }, 'x')), 'class'))
  })

  it('PCQA-013：静止态不预渲染任何成功播报，空令牌页也没有裸宿主串', () => {
    for (const state of [READY, EMPTY]) {
      const html = render(state)
      // 静止态（还没有任何动作）不许有动态状态区：既没有「已保存」播报，也没有错误播报。
      expect(html).not.toContain('role="status"')
      expect(html).not.toContain('data-testid="github-connection-error"')
      expect(html).not.toContain('data-testid="github-section-notice"')
      // 未配置令牌的页面不出现宿主英文技术串。
      expect(html).not.toContain('GITHUB_TOKEN is not configured')
    }
  })
})
