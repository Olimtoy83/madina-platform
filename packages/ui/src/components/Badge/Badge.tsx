import type { HTMLAttributes } from 'react'
import './Badge.css'

export type BadgeVariant =
  | 'neutral'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'

export type BadgeSize =
  | 'sm'
  | 'md'

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
  size?: BadgeSize
}

export function Badge({
  variant = 'neutral',
  size = 'md',
  className = '',
  ...props
}: BadgeProps) {
  const classes = [
    'mb-badge',
    `mb-badge--${variant}`,
    `mb-badge--${size}`,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <span
      className={classes}
      {...props}
    />
  )
}
