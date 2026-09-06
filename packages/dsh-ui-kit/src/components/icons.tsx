import type { CSSProperties, ReactNode } from 'react'

export interface IconProps {
  size?: number | undefined
  className?: string
}

function base(size: number | undefined, className: string | undefined, children: ReactNode, vb = 16): ReactNode {
  return (
    <svg
      viewBox={`0 0 ${vb} ${vb}`}
      width={size ?? vb}
      height={size ?? vb}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={size === undefined ? undefined : ({ width: size, height: size } as CSSProperties)}
    >
      {children}
    </svg>
  )
}

export function IconChevronDownOutline14({ size, className }: IconProps): ReactNode {
  return base(size, className, <path d="m4 6 4 4 4-4" />, 14)
}
export function IconChevronUpOutline14({ size, className }: IconProps): ReactNode {
  return base(size, className, <path d="m4 10 4-4 4 4" />, 14)
}
export function IconChevronLeftOutline14({ size, className }: IconProps): ReactNode {
  return base(size, className, <path d="m10 4-4 4 4 4" />, 14)
}
export function IconChevronRightOutline14({ size, className }: IconProps): ReactNode {
  return base(size, className, <path d="m6 4 4 4-4 4" />, 14)
}
export function IconPlusOutline16({ size, className }: IconProps): ReactNode {
  return base(size, className, <path d="M8 3.5v9M3.5 8h9" />)
}
export function IconTrashOutline16({ size, className }: IconProps): ReactNode {
  return base(size, className, (
    <>
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5 5 13h6l.5-8.5" />
      <path d="M6.8 7v3.5M9.2 7v3.5" />
    </>
  ))
}
export function IconEditOutline16({ size, className }: IconProps): ReactNode {
  return base(size, className, <path d="m11.5 2.5 2 2L6 12l-2.8.8L4 10l7.5-7.5ZM10 4l2 2" />)
}
export function IconBranchOutline16({ size, className }: IconProps): ReactNode {
  return base(size, className, (
    <>
      <circle cx="4.5" cy="3.5" r="1.7" /><circle cx="4.5" cy="12.5" r="1.7" /><circle cx="11.5" cy="6.5" r="1.7" />
      <path d="M4.5 5.2v5.6M11.5 8.2c0 2-2.5 2.4-5.3 2.7" />
    </>
  ))
}
export function IconThinkOutline16({ size, className }: IconProps): ReactNode {
  return base(size, className, (
    <>
      <path d="M8 1.8a4.4 4.4 0 0 1 2.6 7.9c-.5.4-.8 1-.8 1.6H6.2c0-.6-.3-1.2-.8-1.6A4.4 4.4 0 0 1 8 1.8Z" />
      <path d="M6.4 13.2h3.2M7 14.8h2" />
    </>
  ))
}
export function IconWarningOutline16({ size, className }: IconProps): ReactNode {
  return base(size, className, (
    <>
      <path d="M8 2.5 14 13H2L8 2.5Z" />
      <path d="M8 6.5v3" /><circle cx="8" cy="11.2" r="0.4" fill="currentColor" />
    </>
  ))
}
