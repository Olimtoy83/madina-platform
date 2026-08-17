import {
  useEffect,
  type ReactNode,
} from 'react'
import './Toast.css'

export type ToastVariant =
  | 'success'
  | 'info'
  | 'warning'
  | 'error'

export type ToastSize =
  | 'sm'
  | 'md'

export interface ToastProps {
  open: boolean
  onClose: () => void
  variant?: ToastVariant
  size?: ToastSize
  title?: ReactNode
  message?: ReactNode
  duration?: number
  closable?: boolean
}

export function Toast({
  open,
  onClose,
  variant = 'info',
  size = 'md',
  title,
  message,
  duration = 4000,
  closable = true,
}: ToastProps) {
  useEffect(() => {
    if (!open || duration <= 0) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      onClose()
    }, duration)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [open, duration, onClose])

  if (!open) {
    return null
  }

  const classes = [
    'mb-toast',
    `mb-toast--${variant}`,
    `mb-toast--${size}`,
  ].join(' ')

  const role =
    variant === 'error' ||
    variant === 'warning'
      ? 'alert'
      : 'status'

  return (
    <div
      className={classes}
      role={role}
      aria-live={
        role === 'alert'
          ? 'assertive'
          : 'polite'
      }
    >
      <div className="mb-toast__content">
        {title && (
          <div className="mb-toast__title">
            {title}
          </div>
        )}

        {message && (
          <div className="mb-toast__message">
            {message}
          </div>
        )}
      </div>

      {closable && (
        <button
          type="button"
          className="mb-toast__close"
          onClick={onClose}
          aria-label="Close notification"
        >
          ×
        </button>
      )}
    </div>
  )
}
