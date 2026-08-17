import type { HTMLAttributes } from 'react'
import './Spinner.css'

export type SpinnerSize = 'sm' | 'md' | 'lg'

export interface SpinnerProps
  extends HTMLAttributes<HTMLSpanElement> {
  size?: SpinnerSize
  label?: string
}

export function Spinner({
  size = 'md',
  label = 'Loading',
  className = '',
  ...props
}: SpinnerProps) {
  const classes = [
    'mb-spinner',
    `mb-spinner--${size}`,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <span
      {...props}
      className={classes}
      role="status"
      aria-label={label}
    >
      <span
        className="mb-spinner__circle"
        aria-hidden="true"
      />
    </span>
  )
}
