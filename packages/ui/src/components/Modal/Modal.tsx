import {
  useEffect,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import './Modal.css'

export type ModalSize =
  | 'sm'
  | 'md'
  | 'lg'
  | 'xl'

export interface ModalProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  size?: ModalSize
  closeOnOverlayClick?: boolean
  closeOnEscape?: boolean
}

export function Modal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  closeOnOverlayClick = true,
  closeOnEscape = true,
  className = '',
  children,
  ...props
}: ModalProps) {
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
    'mb-modal',
    `mb-modal--${size}`,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const handleOverlayClick = () => {
    if (closeOnOverlayClick) {
      onClose()
    }
  }

  return (
    <div
      className="mb-modal__overlay"
      role="presentation"
      onMouseDown={handleOverlayClick}
    >
      <div
        className={classes}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'mb-modal-title' : undefined}
        onMouseDown={(event) => event.stopPropagation()}
        {...props}
      >
        <div className="mb-modal__header">
          {(title || description) && (
            <div className="mb-modal__header-content">
              {title && (
                <h2
                  id="mb-modal-title"
                  className="mb-modal__title"
                >
                  {title}
                </h2>
              )}

              {description && (
                <p className="mb-modal__description">
                  {description}
                </p>
              )}
            </div>
          )}

          <button
            type="button"
            className="mb-modal__close"
            onClick={onClose}
            aria-label="Close modal"
          >
            ×
          </button>
        </div>

        <div className="mb-modal__body">
          {children}
        </div>
      </div>
    </div>
  )
}

