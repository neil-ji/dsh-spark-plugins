/**
 * Spark UI Kit — 从 0 复刻 docs/spark-ui-kit-demo 的组件封装。
 *
 * 主题：消费 `--spk-*` CSS 变量（`dsh-ui-kit/tokens.css` 提供，
 * `body[data-theme="dark" | "light"]` 切换）。五模块 accent：
 * `--spk-acc-spark / hippomemo / finance / github / npm`。
 */

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

export { Menu, type MenuProps, type MenuItem } from './components/Menu.tsx'

// 浮层与反馈
export { Modal, type ModalProps } from './components/Modal.tsx'
export { toast, Toaster, type ToastItem, type ToastTone, type ToasterProps } from './components/Toast.tsx'

// 终端与图表
export { TerminalBlock, type TerminalBlockProps, type TerminalLine, type TerminalTone } from './components/TerminalBlock.tsx'
export { Sparkline, type SparklineProps } from './components/Sparkline.tsx'

export { cx } from './cx.js'
