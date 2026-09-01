// ListRow: a clickable content row (title + meta line on the left, action
// buttons pinned to the right). The clickable area is the row's own
// <button> (title/meta block); `trailing` renders in a separate actions
// column so nested interactive controls never violate button-in-button
// HTML rules. Shared by the spark plugins' browse lists.

import type { ReactNode } from 'react'
import clsx from 'clsx'
import css from './ListRow.module.css'

/**
 * One selectable list row.
 * @param props.title - primary line (ellipsis-clipped).
 * @param props.meta - secondary line under the title (scope / kind pill / dates).
 * @param props.muted - dimmed + strike-through state (archived / superseded).
 * @param props.onClick - opens/selects the row; the title+meta block is the button.
 * @param props.trailing - action cluster rendered in its own column (never nested
 *   inside the row button, so buttons/selects inside are valid HTML).
 * @param props.className - extra class merged onto the row wrapper.
 */
export interface ListRowProps {
  title: string
  meta?: ReactNode | undefined
  muted?: boolean | undefined
  onClick?: (() => void) | undefined
  trailing?: ReactNode | undefined
  className?: string | undefined
  titleClassName?: string | undefined
}

export function ListRow({ title, meta, muted = false, onClick, trailing, className, titleClassName }: ListRowProps) {
  return (
    <div className={clsx(css.row, muted && css.muted, className)}>
      <button
        type="button"
        className={clsx(css.main, muted && css.mainMuted)}
        onClick={onClick}
        title={title}
        disabled={!onClick}
      >
        <span className={clsx(css.title, titleClassName)}>{title}</span>
        {meta != null ? <span className={css.meta}>{meta}</span> : null}
      </button>
      {trailing != null ? <div className={css.actions}>{trailing}</div> : null}
    </div>
  )
}
