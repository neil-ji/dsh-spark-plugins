/**
 * Cordis-free React primitives styled only through `--dsw-*` tokens.
 */

export { StateDot } from './StateDot.tsx'
export type { StateDotState } from './StateDot.tsx'
export { DisclosureRow } from './DisclosureRow.tsx'
export type { DisclosureRowProps } from './DisclosureRow.tsx'
export { ListRow } from './ListRow.tsx'
export type { ListRowProps } from './ListRow.tsx'
export { SettingsCardHeader } from './SettingsCardHeader.tsx'
export type { SettingsCardHeaderProps } from './SettingsCardHeader.tsx'
export { Button } from './Button.tsx'
export type { ButtonProps, ButtonVariant } from './Button.tsx'
export { Checkbox } from './Checkbox.tsx'
export { Textarea } from './Textarea.tsx'
export { SegmentedControl } from './SegmentedControl.tsx'
export type { SegmentedOption } from './SegmentedControl.tsx'
export { DonutChart, BarChart, TrendChart, CHART_PALETTE, OTHER_CHART_COLOR, niceCeil } from './Charts.tsx'
export type { ChartDatum, DonutChartProps, BarChartProps, TrendPoint, TrendChartProps } from './Charts.tsx'
export { SearchInput } from './SearchInput.tsx'
export { Pill } from './Pill.tsx'
export { Input } from './Input.tsx'
export { Menu } from './Menu.tsx'
export type { MenuEntry, MenuItem, MenuSeparator, MenuLabel } from './Menu.tsx'
export { useAnchoredMaxHeight } from './useAnchoredMaxHeight.ts'
export { HoverCard } from './HoverCard.tsx'
export { Modal } from './Modal.tsx'
export { OnboardingSurface } from './OnboardingSurface.tsx'
export { RiskConfirmation } from './RiskConfirmation.tsx'
export type { RiskConfirmationProps } from './RiskConfirmation.tsx'
export { ConnectionBanner } from './ConnectionBanner.tsx'
export { FishLogo } from './FishLogo.tsx'
export { BrandWordmark } from './BrandWordmark.tsx'
export { Tooltip } from './Tooltip.tsx'
export type { TooltipSide } from './Tooltip.tsx'
export { Toast } from './Toast.tsx'
export { writeClipboard } from './clipboard.ts'
export { JsonTree } from './JsonTree.tsx'
export type { JsonTreeProps, JsonTreeLabels } from './JsonTree.tsx'
export { TerminalBlock, DEFAULT_TERMINAL_MAX_LINES } from './TerminalBlock.tsx'
export type { TerminalBlockProps, TerminalBlockLabels } from './TerminalBlock.tsx'
export { ReadBlock, DEFAULT_READ_MAX_LINES } from './ReadBlock.tsx'
export type { ReadBlockProps, ReadBlockLine } from './ReadBlock.tsx'
export { DiffBlock, DEFAULT_DIFF_MAX_LINES } from './DiffBlock.tsx'
export type { DiffBlockProps, DiffHunk } from './DiffBlock.tsx'
export { SearchBlock, DEFAULT_SEARCH_MAX_LINES } from './SearchBlock.tsx'
export type {
  SearchBlockProps, SearchMatchesBlockProps, SearchPathsBlockProps, SearchFileGroup, SearchBlockLineMatch,
} from './SearchBlock.tsx'
export { WebBlock } from './WebBlock.tsx'
export type { WebBlockProps, WebSearchBlockProps, WebFetchBlockProps, WebSourceView } from './WebBlock.tsx'
export { CodeBlock } from './markdown/CodeBlock.tsx'
export type { CodeBlockProps } from './markdown/CodeBlock.tsx'
export { JsonBlock } from './markdown/JsonBlock.tsx'
export { MarkdownText } from './markdown/MarkdownText.tsx'
export type { MarkdownCodeLabels, MarkdownFileMentions } from './markdown/MarkdownText.tsx'
export { MessageText } from './markdown/MessageText.tsx'
export { extractMarkdownPlainText } from './markdown/plain-text.ts'
export type { MarkdownPlainTextMode, MarkdownPlainTextOptions } from './markdown/plain-text.ts'
export * from './icons/index.tsx'

// Theme
export {
  THEME_PREFERENCES,
  DEFAULT_PREFERENCE,
  isThemePreference,
  resolveDark,
  applyTheme,
  setThemePreference,
  getThemePreference,
  getIsDark,
  useThemePreference,
  useIsDark,
} from './theme.ts'
export type { ThemePreference } from './theme.ts'
export { Money, formatMicros } from "./Money.tsx"
export type { MoneyProps, MoneyVariant, MoneySize } from "./Money.tsx"
