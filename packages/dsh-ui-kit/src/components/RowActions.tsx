import { useState, type ReactNode } from 'react'
import { Button } from './Button.js'
import { Menu } from './Menu.js'
import { IconEllipsis } from './icons.js'
import css from './RowActions.module.css'

export interface RowActionsItem {
  id: string
  label: ReactNode
}

export interface RowActionsProps {
  /** 可访问名（必须带行语境，如「更多操作：{行名}」）。 */
  label: string
  items: RowActionsItem[]
  onSelect: (id: string) => void
  /** 当前选中项（Menu 高亮，计费方式这类「单选 + 动作」混合菜单用）。 */
  selectedId?: string
  /** 菜单弹出方向：表格行通常向下（默认），末行可传 top。 */
  side?: 'bottom' | 'top'
  className?: string
}

/**
 * Spark UI Kit 表格 Action 列「…」下拉（UI-UX-SPEC §3.5）。
 *
 * 规则：表格行操作 >1 项时必须收敛为本组件，禁止平铺一排按钮。
 * 内部 = ellipsis 触发钮（secondary sm）+ kit Menu（Esc/外点关闭、方向键导航
 * 由 Menu 负责，这里只管开合状态与可访问名）。
 */
export function RowActions({ label, items, onSelect, selectedId, side = 'bottom', className }: RowActionsProps) {
  const [open, setOpen] = useState(false)
  return (
    <span className={css.wrap}>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        onSelect={(id) => onSelect(id)}
        items={items}
        selectedId={selectedId}
        side={side}
        className={className}
        anchor={(
          <Button
            variant="secondary"
            size="sm"
            className={css.trigger}
            aria-label={label}
            data-testid="row-actions-trigger"
            onClick={() => setOpen((v) => !v)}
          >
            <IconEllipsis size={14} />
          </Button>
        )}
      />
    </span>
  )
}
