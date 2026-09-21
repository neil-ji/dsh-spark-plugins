/**
 * Spark UI Kit — 从 0 复刻 docs/spark-ui-kit-demo 的组件封装。
 *
 * 主题：消费 `--spk-*` CSS 变量（`dsh-ui-kit/tokens.css` 提供，
 * `body[data-theme="dark" | "light"]` 切换）。五模块 accent：
 * `--spk-acc-spark / hippomemo / finance / github / npm`。
 */

// token 层自注入：import dsh-ui-kit 时把 --spk-*/--dsw-* token 写到 document.head。
// 必须从 barrel 再导出 sparkTokenLayer/sparkTokenCss，否则 rolldown 会把 cx.ts 里对该 .mjs 的
// 引用当作"未使用的副作用"整棵剪掉，页面 --spk-* 变 empty → 组件被冲淡成低对比灰。
// 模块由 build/build.mjs 生成 dist/styles/tokens.mjs（幂等，id=dsh-ui-kit/tokens）。
// sparkTokenCss：供 rolldown 打包的消费者（如 hippomemo/tsdown）显式拿 CSS 字符串走
// injectPluginStyle 注入；sparkTokenLayer 仅供持有副作用。
export { sparkTokenCss, sparkTokenLayer } from './styles/tokens.mjs'

// 基础
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './components/Button.tsx'
export { Input, Textarea, type InputProps, type TextareaProps } from './components/Input.tsx'
export { SearchInput, type SearchInputProps } from './components/SearchInput.tsx'
export { Checkbox, type CheckboxProps } from './components/Checkbox.tsx'

// 标识
export { Pill, type PillProps, type PillTone } from './components/Pill.tsx'
export { StateDot, type StateDotProps, type DotStatus } from './components/StateDot.tsx'

// 容器与列表
export { SegmentedControl, type SegmentedControlProps, type SegmentedOption } from './components/SegmentedControl.tsx'
export { ListRow, type ListRowProps } from './components/ListRow.tsx'
export { Disclosure, type DisclosureProps } from './components/Disclosure.tsx'
export { SettingsCard, Stat, StatGrid, type SettingsCardProps, type StatProps } from './components/SettingsCard.tsx'

// 面板骨架（插件面板统一骨架，火花基线：见各组件头注释）
export { PanelShell, type PanelShellProps } from './components/PanelShell.tsx'
export { Card, type CardProps } from './components/Card.tsx'
export { EmptyState, type EmptyStateProps } from './components/EmptyState.tsx'

export { Menu, type MenuProps, type MenuItem } from './components/Menu.tsx'
// 表格通用件（UI-UX-SPEC §3.5）：Action 列「…」下拉 + 文本列两行截断
export { RowActions, type RowActionsProps, type RowActionsItem } from './components/RowActions.tsx'
export { CellText, type CellTextProps } from './components/CellText.tsx'

// 浮层与反馈
export { Modal, type ModalProps } from './components/Modal.tsx'
export { toast, Toaster, type ToastItem, type ToastTone, type ToasterProps } from './components/Toast.tsx'

// 图表与金额
export {
  DonutChart, BarChart, StackedBar, TrendChart,
  CHART_PALETTE, OTHER_CHART_COLOR, niceCeil,
  type ChartDatum, type TrendPoint,
  type DonutChartProps, type BarChartProps, type StackedBarProps, type TrendChartProps,
} from './components/Charts.tsx'
export { Money, formatMicros, formatMicrosExact, formatMoneyMicros, formatMoneyMicrosExact, type MoneyProps, type MoneySize } from './components/Money.tsx'

// 终端与图表
export { TerminalBlock, type TerminalBlockProps, type TerminalLine, type TerminalTone } from './components/TerminalBlock.tsx'
export { Sparkline, type SparklineProps } from './components/Sparkline.tsx'

// 图标：lucide-react 驱动的工作区唯一图标层（规范见 components/icons.tsx 头注释）
export {
  IconBranch, IconChevronDown, IconChevronLeft, IconChevronRight, IconChevronUp,
  IconDollar, IconEdit, IconEllipsis, IconGithub, IconPackage, IconPlus, IconSparkles,
  IconThink, IconTrash, IconWarning, type IconProps,
} from './components/icons.tsx'

// 遗留命名（0.3.x，@deprecated）：指向新图标，待下游迁移后移除
export {
  IconChevronDownOutline14, IconChevronUpOutline14, IconChevronLeftOutline14, IconChevronRightOutline14,
  IconPlusOutline16, IconTrashOutline16, IconEditOutline16, IconBranchOutline16,
  IconThinkOutline16, IconWarningOutline16,
} from './components/icons.tsx'

export { cx } from './cx.js'
