import {
  useEffect,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import './Drawer.css'

export type DrawerSize =
  | 'sm'
  | 'md'
  | 'lg'

export type DrawerPlacement =
  | 'left'
  | 'right'

export interface DrawerProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  open: boolean
  onClose: () => void
  title?: ReactNode
  size?: DrawerSize
  placement?: DrawerPlacement
  closeOnOverlayClick?: boolean
  closeOnEscape?: boolean
}

export function Drawer({
  open,
  onClose,
  title,
  size = 'md',
  placement = 'right',
  closeOnOverlayClick = true,
  closeOnEscape = true,
  className = '',
  children,
  ...props
}: DrawerProps) {
  useEffect(() => {
    if (!open || !closeOnEscape) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, closeOnEscape, onClose])

  useEffect(() => {
    if (!open) {
      return
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  if (!open) {
    return null
  }

  const classes = [
    'mb-drawer',
    `mb-drawer--${size}`,
    `mb-drawer--${placement}`,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const handleOverlayMouseDown = () => {
    if (closeOnOverlayClick) {
      onClose()
    }
  }

  return (
    <div
      className="mb-drawer__overlay"
      role="presentation"
      onMouseDown={handleOverlayMouseDown}
    >
      <div
        className={classes}
        role="dialog"
        aria-modal="true"
        aria-labelledby={
          title
            ? 'mb-drawer-title'
            : undefined
        }
        onMouseDown={(event) => {
          event.stopPropagation()
        }}
        {...props}
      >
        <div className="mb-drawer__header">
          {title && (
            <h2
              id="mb-drawer-title"
              className="mb-drawer__title"
            >
              {title}
            </h2>
          )}

          <button
            type="button"
            className="mb-drawer__close"
            onClick={onClose}
            aria-label="Закрыть панель"
          >
            ×
          </button>
        </div>

        <div className="mb-drawer__body">
          {children}
        </div>
      </div>
    </div>
  )
}
