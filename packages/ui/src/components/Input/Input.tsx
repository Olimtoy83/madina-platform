import type { InputHTMLAttributes } from 'react'
import './Input.css'

export type InputSize =
  | 'sm'
  | 'md'
  | 'lg'

export interface InputProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'size'
  > {
  size?: InputSize
  error?: boolean
  fullWidth?: boolean
}

export function Input({
  size = 'md',
  error = false,
  fullWidth = false,
  className = '',
  ...props
}: InputProps) {
  const classes = [
    'mb-input',
    `mb-input--${size}`,
    error ? 'mb-input--error' : '',
    fullWidth ? 'mb-input--full-width' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <input
      className={classes}
      aria-invalid={error || undefined}
      {...props}
    />
  )
}
