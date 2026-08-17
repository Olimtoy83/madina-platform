import type { HTMLAttributes } from 'react'
import './Badge.css'

export type BadgeVariant =
  | 'default'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'

export type BadgeSize = 'sm' | 'md'

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
  size?: BadgeSize
  dot?: boolean
}

export function Badge({
  variant = 'default',
  size = 'md',
  dot = false,
  className = '',
  children,
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
      {...props}
      className={classes}
    >
      {dot && (
        <span
          className="mb-badge__dot"
          aria-hidden="true"
        />
      )}

      <span className="mb-badge__content">
        {children}
      </span>
    </span>
  )
}
