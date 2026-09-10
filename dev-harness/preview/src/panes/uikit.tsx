/**
 * dsh-ui-kit 组件陈列——纯组件，无任何宿主依赖，零 dsh 最直白的一屏。
 */
import { useState } from 'react'
import {
  BarChart,
  Button,
  Checkbox,
  Disclosure,
  DonutChart,
  IconBranchOutline16,
  IconPlusOutline16,
  IconTrashOutline16,
  Input,
  ListRow,
  Menu,
  Modal,
  Money,
  Pill,
  SearchInput,
  SegmentedControl,
  SettingsCard,
  Sparkline,
  Stat,
  StatGrid,
  StateDot,
  TerminalBlock,
  Textarea,
  Toaster,
  TrendChart,
  toast,
} from 'dsh-ui-kit'

const money = (value: number): string => '¥' + (value / 1_000_000).toFixed(2)

export function UiKitPane() {
  const [segment, setSegment] = useState('overview')
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuChoice, setMenuChoice] = useState('finance')
  const [modalOpen, setModalOpen] = useState(false)
  const [checked, setChecked] = useState(true)
  const [query, setQuery] = useState('')

  const donut = [
    { key: 'deepseek', label: 'deepseek', value: 18_240_000 },
    { key: 'tencent', label: 'tencent', value: 3_120_000 },
    { key: 'openai', label: 'openai', value: 1_820_000 },
  ]
  const bars = [
    { key: 'flash', label: 'v4.1-flash', value: 12_400_000 },
    { key: 'reasoner', label: 'reasoner', value: 6_800_000 },
    { key: 'hunyuan', label: 'hunyuan-4', value: 2_100_000 },
  ]
  const trend = Array.from({ length: 14 }, (_, index) => ({
    key: 'd' + index,
    label: 'D' + (index + 1),
    value: Math.round(4_000_000 + Math.sin(index / 1.7) * 2_400_000 + index * 260_000),
  }))

  return (
    <div className="pv-pane-body pv-wide">
      <p className="pv-hint">
        <code>dsh-ui-kit</code> 是插件 UI 的公共组件层，不依赖任何 dsh 运行时——本页即纯浏览器渲染。
      </p>

      <div className="pv-grid">
        <SettingsCard title="按钮 / 分段 / 徽标" description="Button 四态 + SegmentedControl + Pill 五色" accentColor="var(--spk-acc-spark)" badge={<Pill tone="brand">v0.3.1</Pill>}>
          <div className="pv-stack">
            <div className="pv-row">
              <Button variant="primary">主要</Button>
              <Button variant="secondary">次要</Button>
              <Button variant="ghost">幽灵</Button>
              <Button variant="danger" icon={<IconTrashOutline16 />}>删除</Button>
              <Button variant="primary" loading>进行中</Button>
            </div>
            <SegmentedControl
              ariaLabel="视图"
              value={segment}
              onChange={setSegment}
              options={[{ value: 'overview', label: '总览' }, { value: 'detail', label: '明细' }, { value: 'raw', label: '原始' }]}
            />
            <div className="pv-row">
              <Pill>中性</Pill>
              <Pill tone="brand">品牌</Pill>
              <Pill tone="success">成功</Pill>
              <Pill tone="warn">警告</Pill>
              <Pill tone="error">失败</Pill>
              <Pill accentColor="var(--spk-acc-npm)" active onClick={() => {}}>可点选</Pill>
            </div>
            <div className="pv-row">
              <StateDot status="live" label="在线" />
              <StateDot status="idle" label="空闲" />
              <StateDot status="error" label="错误" />
              <StateDot status="neutral" label="未知" />
            </div>
          </div>
        </SettingsCard>

        <SettingsCard title="表单控件" description="Input / Textarea / SearchInput / Checkbox" accentColor="var(--spk-acc-github)">
          <div className="pv-stack">
            <Input label="Token" placeholder="npm_xxx" help="保存后由 agent 全权接管" />
            <Input label="超时（毫秒）" defaultValue="8000" error="必须是整数" />
            <Textarea label="价格表（JSON）" rows={3} defaultValue={'{\n  "deepseek": 2000000\n}'} />
            <SearchInput label="搜索记忆" placeholder="搜标题 / 内容 / 标签" value={query} onChange={(event) => setQuery(event.target.value)} onClear={() => setQuery('')} clearLabel="清空" />
            <Checkbox checked={checked} onChange={setChecked} label="允许 agent 自动发布" />
          </div>
        </SettingsCard>

        <SettingsCard title="金额 / 迷你图" description="Money micros 换算 + Sparkline" accentColor="var(--spk-acc-finance)">
          <div className="pv-stack">
            <div className="pv-row">
              <Money micros={128_400_000} currency="CNY" size="lg" />
              <Money micros={3_120_000} currency="CNY" size="md" muted />
            </div>
            <Sparkline data={trend.map((point) => point.value)} ariaLabel="成本趋势" />
          </div>
        </SettingsCard>

        <SettingsCard title="列表 / 折叠 / 统计" description="ListRow + Disclosure + StatGrid" accentColor="var(--spk-acc-hippomemo)">
          <StatGrid>
            <Stat label="总会话" value="37" />
            <Stat label="总成本" value={<Money micros={23_180_000} currency="CNY" size="sm" />} />
            <Stat label="缓存命中" value="87%" positive />
          </StatGrid>
          <ListRow title="dsh-spark-plugins" meta="24 会话 · 最后活跃 2 分钟前" trailing={<Pill tone="brand">主工作区</Pill>} accentColor="var(--spk-acc-spark)" onClick={() => {}} />
          <ListRow title="（已归档）旧 runner" meta="1 会话" archived />
          <Disclosure name="高级配置（JSON）" description="defaultPrice / providerDefaults / prices" defaultOpen={false}>
            <span>仅高级用户维护；保存前会做 schema 校验。</span>
          </Disclosure>
        </SettingsCard>

        <SettingsCard title="菜单 / 弹窗 / 提示" description="Menu + Modal + toast" accentColor="var(--spk-acc-npm)">
          <div className="pv-stack">
            <div className="pv-row">
              <Menu
                open={menuOpen}
                onClose={() => setMenuOpen(false)}
                anchor={<Button variant="secondary" onClick={() => setMenuOpen((open) => !open)}>选择模块</Button>}
                items={[{ id: 'github', label: 'GitHub 连接器' }, { id: 'npm', label: 'npm 发布管线' }, { id: 'finance', label: '财务审计' }]}
                selectedId={menuChoice}
                onSelect={(id) => { setMenuChoice(id); setMenuOpen(false) }}
              />
              <Button variant="primary" onClick={() => setModalOpen(true)}>打开弹窗</Button>
              <Button variant="secondary" icon={<IconPlusOutline16 />} onClick={() => { toast.success('已保存（预览提示）') }}>弹提示</Button>
            </div>
            <span className="pv-bar-meta">当前选择：{menuChoice}</span>
          </div>
        </SettingsCard>

        <SettingsCard title="图表" description="DonutChart / BarChart / TrendChart" accentColor="#14b8a6">
          <div className="pv-stack">
            <DonutChart rows={donut} centerValue={<Money micros={23_180_000} currency="CNY" size="md" />} centerLabel="总成本" ariaLabel="按 provider 成本" formatValue={money} />
            <BarChart rows={bars} ariaLabel="按模型成本" formatValue={money} axisFormatter={money} />
            <TrendChart points={trend} ariaLabel="14 天成本趋势" formatValue={money} gradientId="pv-trend" />
          </div>
        </SettingsCard>

        <SettingsCard title="终端块 / 图标" description="TerminalBlock + 图标集" accentColor="var(--spk-acc-spark)">
          <div className="pv-stack">
            <TerminalBlock
              title="pnpm preview"
              cursor
              lines={[
                { tone: 'prompt', text: '$ pnpm preview' },
                { tone: 'dim', text: 'esbuild 打包 dev-harness/preview/src/main.tsx …' },
                { tone: 'ok', text: '✓ 零 dsh 组件预览已启动 → http://127.0.0.1:5180/' },
              ]}
            />
            <div className="pv-row">
              <IconPlusOutline16 />
              <IconTrashOutline16 />
              <IconBranchOutline16 />
            </div>
          </div>
        </SettingsCard>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="发布前确认" closeLabel="取消">
        <p>这次发布会打包 12 个包，并逐个校验 sha256 后上传 Release 资产。</p>
      </Modal>
      <Toaster />
    </div>
  )
}
