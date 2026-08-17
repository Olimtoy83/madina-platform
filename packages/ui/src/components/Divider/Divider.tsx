import type { HTMLAttributes } from 'react'
import './Divider.css'

export type DividerOrientation = 'horizontal' | 'vertical'

export interface DividerProps
  extends HTMLAttributes<HTMLHRElement> {
  orientation?: DividerOrientation
  label?: string
}

export function Divider({
  orientation = 'horizontal',
  label,
  className = '',
  ...props
}: DividerProps) {
  const classes = [
    'mb-divider',
    `mb-divider--${orientation}`,
    label ? 'mb-divider--with-label' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  if (label && orientation === 'horizontal') {
    return (
      <div
        className={classes}
        role="separator"
        aria-label={label}
        aria-orientation="horizontal"
        {...props}
      >
        <span className="mb-divider__line" />
        <span className="mb-divider__label">
          {label}
        </span>
        <span className="mb-divider__line" />
      </div>
    )
  }

  return (
    <hr
      {...props}
      className={classes}
      aria-label={label}
      aria-orientation={orientation}
    />
  )
}
