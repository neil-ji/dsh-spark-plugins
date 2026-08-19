// Textarea: multi-line text input atom matching the Input chrome
// (same tokens, focus ring, placeholder color).

import type { TextareaHTMLAttributes } from 'react'
import clsx from 'clsx'
import css from './Textarea.module.css'

/**
 * Render a multi-line text area; native textarea attributes pass through.
 */
export function Textarea({ className, ...rest }: {
  className?: string | undefined
} & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx(css.textarea, className)} {...rest} />
}
