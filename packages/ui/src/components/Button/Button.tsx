import type { ButtonHTMLAttributes } from 'react'
import './Button.css'

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'danger'

export type ButtonSize =
  | 'sm'
  | 'md'
  | 'lg'

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
}

export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className = '',
  ...props
}: ButtonProps) {
  const classes = [
    'mb-button',
    `mb-button--${variant}`,
    `mb-button--${size}`,
    fullWidth ? 'mb-button--full-width' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      className={classes}
      {...props}
    />
  )
}
