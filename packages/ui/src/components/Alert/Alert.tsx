import type { HTMLAttributes, ReactNode } from 'react'
import './Alert.css'

export type AlertVariant =
  | 'info'
  | 'success'
  | 'warning'
  | 'danger'

export interface AlertProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  variant?: AlertVariant
  title?: ReactNode
  dismissible?: boolean
  onDismiss?: () => void
}

export function Alert({
  variant = 'info',
  title,
  dismissible = false,
  onDismiss,
  className = '',
  children,
  ...props
}: AlertProps) {
  const classes = [
    'mb-alert',
    `mb-alert--${variant}`,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const role = variant === 'info'
    ? 'status'
    : 'alert'

  return (
    <div
      className={classes}
      role={role}
      {...props}
    >
      <div className="mb-alert__content">
        {title && (
          <div className="mb-alert__title">
            {title}
          </div>
        )}

        {children && (
          <div className="mb-alert__message">
            {children}
          </div>
        )}
      </div>

      {dismissible && (
        <button
          type="button"
          className="mb-alert__dismiss"
          onClick={onDismiss}
          aria-label="Dismiss alert"
        >
          ×
        </button>
      )}
    </div>
  )
}
