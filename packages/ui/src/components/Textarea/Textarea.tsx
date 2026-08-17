import type { TextareaHTMLAttributes } from 'react'
import './Textarea.css'

export type TextareaSize =
  | 'sm'
  | 'md'
  | 'lg'

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  size?: TextareaSize
  error?: boolean
  fullWidth?: boolean
}

export function Textarea({
  size = 'md',
  error = false,
  fullWidth = false,
  className = '',
  ...props
}: TextareaProps) {
  const classes = [
    'mb-textarea',
    `mb-textarea--${size}`,
    error ? 'mb-textarea--error' : '',
    fullWidth ? 'mb-textarea--full-width' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <textarea
      className={classes}
      aria-invalid={error || undefined}
      {...props}
    />
  )
}
