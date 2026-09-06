import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import 'dsh-ui-kit/tokens.css'
import {
  Button, Pill, Input, Menu, Tooltip, HoverCard, Toast, Modal,
  StateDot, DisclosureRow, JsonTree, TerminalBlock, DiffBlock, ReadBlock,
  SearchBlock, WebBlock, CodeBlock, JsonBlock, MarkdownText, MessageText,
  BrandWordmark, FishLogo,
  setThemePreference, useIsDark,
  IconNewChatOutline16, IconSearchOutline16, IconSettingsOutline16, IconGlobeOutline14,
  IconPlusOutline16, IconCheckOutline16, IconCopyOutline16, IconRefreshOutline16,
  IconEditOutline16, IconTrashOutline16, IconWarningOutline16, IconSendOutline16,
  IconFolderOpenOutline16, IconCodeOutline16, IconDataOutline16, IconSparkle16,
  IconThinkOutline16, IconLightOutline16, IconDarkOutline16, IconFollowsystemOutline16,
  IconGoalOutline16, IconSkillOutline16, IconArchiveOutline20, IconChevronDownOutline14,
} from 'dsh-ui-kit'
import './demo.css'

const markdownSample = [
  '# 你好，DSH',
  '',
  '这是一个 **markdown** 渲染示例，支持 GFM 表格、\`inline code\`、引用与数学公式：',
  '',
  '\`\`\`ts',
  'const greeting = (name: string) => \`你好, \${name}!\`',
  "console.log(greeting('dsh-ui-kit'))",
  '\`\`\`',
  '',
  '> 引用块：一切皆插件。',
  '',
  '| 组件 | 状态 |',
  '| --- | --- |',
  '| Button | ✅ |',
  '| Modal | ✅ |',
  '',
  '行内数学 $\\frac{1}{2} + \\frac{1}{3} = \\frac{5}{6}$ 与块级数学：',
  '',
  '$$E = mc^2$$',
  '',
  '[链接](https://deepseek.com) 与 ~~删除线~~ 与列表：',
  '- 一',
  '- 二',
  '',
].join('\n')

function App() {
  const dark = useIsDark()
  const [toast, setToast] = useState<{ text: string; seq: number } | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [disclosureOpen, setDisclosureOpen] = useState(true)

  return (
    <div className="page">
      <header className="masthead">
        <div className="brand"><FishLogo /><BrandWordmark /></div>
        <div className="theme-switch">
          <Pill active={!dark} onClick={() => setThemePreference('light')}><IconLightOutline16 /> 浅色</Pill>
          <Pill active={dark} onClick={() => setThemePreference('dark')}><IconDarkOutline16 /> 深色</Pill>
          <Pill active={false} onClick={() => setThemePreference('system')}><IconFollowsystemOutline16 /> 跟随系统</Pill>
        </div>
      </header>

      <section>
        <h2>按钮 Button</h2>
        <div className="row">
          <Button variant="primary">主要</Button>
          <Button variant="ghost">幽灵</Button>
          <Button variant="outline">描边</Button>
          <Button variant="toolbar"><IconSettingsOutline16 /> 工具栏</Button>
          <Button variant="primary" size="sm">小号</Button>
          <Button variant="ghost" size="sm" icon={<IconPlusOutline16 />}>新建</Button>
          <Button disabled>禁用</Button>
        </div>
      </section>

      <section>
        <h2>胶囊 Pill / 输入 Input</h2>
        <div className="row">
          <Pill active>已选中</Pill>
          <Pill>未选中</Pill>
          <Pill onClick={() => {}}>可点击</Pill>
          <Input placeholder="搜索会话…" icon={<IconSearchOutline16 />} style={{ width: 280 }} />
        </div>
      </section>

      <section>
        <h2>状态点 StateDot / 折叠行 DisclosureRow</h2>
        <div className="row">
          <StateDot state="done" /> 完成
          <StateDot state="warning" /> 注意
          <StateDot state="ongoing" /> 进行中
          <StateDot state="error" /> 错误
        </div>
        <DisclosureRow
          icon={<IconFolderOpenOutline16 />}
          title="tool.call.bash · 运行 pnpm test"
          open={disclosureOpen}
          expandable
          onToggle={() => setDisclosureOpen((o) => !o)}
        >
          <p style={{ margin: 0, padding: '8px 0' }}>展开内容区。</p>
        </DisclosureRow>
      </section>

      <section>
        <h2>Menu / Tooltip / HoverCard / Toast / Modal</h2>
        <div className="row">
          <Menu
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            anchor={<Button onClick={() => setMenuOpen((o) => !o)} icon={<IconChevronDownOutline14 />}>操作菜单</Button>}
            items={[
              { id: 'rename', label: '重命名', icon: <IconEditOutline16 /> },
              { id: 'copy', label: '复制链接', icon: <IconCopyOutline16 /> },
              { type: 'label', id: 'g', text: '危险区' },
              { id: 'delete', label: '删除', icon: <IconTrashOutline16 />, danger: true },
            ]}
            onSelect={(id) => { setMenuOpen(false); setToast({ text: '选中: ' + id, seq: Date.now() }) }}
          />
          <Tooltip label="悬停提示 (Tooltip)" side="bottom">
            <Button variant="ghost">悬停我</Button>
          </Tooltip>
          <HoverCard
            anchor={<Button variant="ghost">悬停看卡片</Button>}
            content={<div style={{ padding: 8 }}>HoverCard 内容，可选中复制。这里展示的是 portaled 预览卡片。</div>}
            copyText="dsh-ui-kit 示例文本"
          />
          <Button variant="ghost" onClick={() => setToast({ text: '已复制到剪贴板', seq: Date.now() })}>显示 Toast</Button>
          <Button variant="primary" onClick={() => setModalOpen(true)}>打开 Modal</Button>
        </div>
        {toast && <Toast key={toast.seq} text={toast.text} onDone={() => setToast(null)} />}
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="新建会话"
          closeLabel="关闭"
          description="创建一个新的工作会话。"
          footer={
            <>
              <Button onClick={() => setModalOpen(false)}>取消</Button>
              <Button variant="primary" onClick={() => setModalOpen(false)}>创建</Button>
            </>
          }
        >
          <Input placeholder="会话名称" autoFocus />
        </Modal>
      </section>

      <section>
        <h2>JSON 树 JsonTree</h2>
        <JsonTree
          data={{ name: 'dsh-ui-kit', version: '0.1.0', license: 'MIT', tags: ['react', 'tokens'], deps: { react: '^18', shiki: '^4' }, optional: null, ok: true }}
        />
      </section>

      <section>
        <h2>终端 TerminalBlock</h2>
        <TerminalBlock command="pnpm test -- --runInBand" cwd="~/AIGC/dsh-ui-kit" output="✓ 42 tests passed (1.2s)\n\x1b[32m  all good\x1b[0m" exitCode={0} />
        <TerminalBlock command="npm run lint" cwd="/tmp/broken" output="Error: ENOENT: no such file or directory" exitCode={2} />
        <TerminalBlock command="pnpm dev" cwd="~" running />
      </section>

      <section>
        <h2>读写 DiffBlock / ReadBlock / SearchBlock / WebBlock</h2>
        <DiffBlock
          diffs={[
            { path: 'src/theme.ts', oldText: 'export const DEFAULT_PREFERENCE = "system"', newText: 'export const DEFAULT_PREFERENCE: ThemePreference = "system"' },
            { path: 'README.md', oldText: null, newText: '# dsh-ui-kit' },
          ]}
        />
        <ReadBlock
          label="src/index.ts"
          lines={[
            { number: 1, text: "export { StateDot } from './StateDot'" },
            { number: 2, text: "export { Button } from './Button'" },
            { number: 3, text: "export { Pill } from './Pill'" },
          ]}
          totalLines={120}
        />
        <SearchBlock
          kind="matches"
          truncated
          total={42}
          files={[
            { path: 'src/theme.ts', matches: [{ lineNumber: 12, line: 'export function resolveDark' }, { lineNumber: 20, line: 'document.body.toggleAttribute' }] },
            { path: 'src/index.ts', matches: [{ lineNumber: 3, line: 'export { Pill' }] },
          ]}
        />
        <WebBlock
          kind="search"
          answer="DeepSeek Harness 是基于 Cordis 的插件化 Agent 运行时。"
          truncated={false}
          sources={[
            { url: 'https://github.com/deepseek-ai/deepseek-harness', title: 'deepseek-harness', snippet: 'Everything is a Plugin.', publishedAt: '2026-08' },
            { url: 'https://deepseek.com/harness', title: 'DeepSeek Harness', snippet: '官方站点', publishedAt: '2026-08' },
          ]}
        />
        <WebBlock kind="fetch" url="https://deepseek.com/harness" statusCode={200} truncated={false} />
      </section>

      <section>
        <h2>代码块 CodeBlock / JsonBlock</h2>
        <CodeBlock code={'const x: number = 42\nexport default x'} lang="ts" />
        <JsonBlock label="response" payload={{ ok: true, data: { id: 1, items: [1, 2, 3] } }} defaultOpen />
      </section>

      <section>
        <h2>Markdown</h2>
        <MarkdownText text={markdownSample} />
        <h3>MessageText（字面文本）</h3>
        <MessageText text="这是 **不会** 被渲染成 Markdown 的字面文本。" />
      </section>

      <section>
        <h2>图标图标库</h2>
        <div className="icons">
          {[
            <IconNewChatOutline16 />, <IconSearchOutline16 />, <IconSettingsOutline16 />, <IconGlobeOutline14 />,
            <IconPlusOutline16 />, <IconCheckOutline16 />, <IconCopyOutline16 />, <IconRefreshOutline16 />,
            <IconEditOutline16 />, <IconTrashOutline16 />, <IconWarningOutline16 />, <IconSendOutline16 />,
            <IconFolderOpenOutline16 />, <IconCodeOutline16 />, <IconDataOutline16 />, <IconSparkle16 />,
            <IconThinkOutline16 />, <IconGoalOutline16 />, <IconSkillOutline16 />, <IconArchiveOutline20 />,
          ].map((icon, i) => <span key={i} className="icon-cell">{icon}</span>)}
        </div>
      </section>

      <footer className="foot">dsh-ui-kit · 与 DeepSeek Harness Web UI 设计系统严格一致（--dsw-* tokens，MIT）</footer>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
)
