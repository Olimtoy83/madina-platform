import type { SelectHTMLAttributes } from 'react'
import './Select.css'

export type SelectSize =
  | 'sm'
  | 'md'
  | 'lg'

export interface SelectProps
  extends Omit<
    SelectHTMLAttributes<HTMLSelectElement>,
    'size'
  > {
  size?: SelectSize
  error?: boolean
  fullWidth?: boolean
}

export function Select({
  size = 'md',
  error = false,
  fullWidth = false,
  className = '',
  ...props
}: SelectProps) {
  const classes = [
    'mb-select',
    `mb-select--${size}`,
    error ? 'mb-select--error' : '',
    fullWidth ? 'mb-select--full-width' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <select
      className={classes}
      aria-invalid={error || undefined}
      {...props}
    />
  )
}
