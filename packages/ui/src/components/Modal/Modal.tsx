import {
  useEffect,
  useId,
  useRef,
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

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

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
  const modalRef = useRef<HTMLDivElement>(null)
  const previousFocusRef =
    useRef<HTMLElement | null>(null)

  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    if (!open) {
      return
    }

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null

    const modal = modalRef.current

    if (!modal) {
      return
    }

    const getFocusableElements = () =>
      Array.from(
        modal.querySelectorAll<HTMLElement>(
          focusableSelector,
        ),
      ).filter(
        (element) =>
          !element.hasAttribute('disabled') &&
          element.getAttribute('aria-hidden') !== 'true',
      )

    const focusInitialElement = () => {
      const focusableElements =
        getFocusableElements()

      const initialElement =
        focusableElements[0] ?? modal

      initialElement.focus()
    }

    const animationFrameId =
      window.requestAnimationFrame(
        focusInitialElement,
      )

    const handleKeyDown = (
      event: KeyboardEvent,
    ) => {
      if (
        event.key === 'Escape' &&
        closeOnEscape
      ) {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key !== 'Tab') {
        return
      }

      const focusableElements =
        getFocusableElements()

      if (focusableElements.length === 0) {
        event.preventDefault()
        modal.focus()
        return
      }

      const firstElement =
        focusableElements[0]
      const lastElement =
        focusableElements[
        focusableElements.length - 1
        ]

      const activeElement =
        document.activeElement

      if (event.shiftKey) {
        if (
          activeElement === firstElement ||
          !modal.contains(activeElement)
        ) {
          event.preventDefault()
          lastElement?.focus()
        }

        return
      }

      if (
        activeElement === lastElement ||
        !modal.contains(activeElement)
      ) {
        event.preventDefault()
        firstElement?.focus()
      }
    }

    document.addEventListener(
      'keydown',
      handleKeyDown,
    )

    return () => {
      window.cancelAnimationFrame(
        animationFrameId,
      )

      document.removeEventListener(
        'keydown',
        handleKeyDown,
      )

      previousFocusRef.current?.focus()
    }
  }, [
    open,
    closeOnEscape,
    onClose,
  ])

  useEffect(() => {
    if (!open) {
      return
    }

    const previousOverflow =
      document.body.style.overflow

    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow =
        previousOverflow
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
        ref={modalRef}
        className={classes}
        role="dialog"
        aria-modal="true"
        aria-labelledby={
          title
            ? titleId
            : undefined
        }
        aria-describedby={
          description
            ? descriptionId
            : undefined
        }
        tabIndex={-1}
        onMouseDown={(event) =>
          event.stopPropagation()
        }
        {...props}
      >
        <div className="mb-modal__header">
          {(title || description) && (
            <div className="mb-modal__header-content">
              {title && (
                <h2
                  id={titleId}
                  className="mb-modal__title"
                >
                  {title}
                </h2>
              )}

              {description && (
                <p
                  id={descriptionId}
                  className="mb-modal__description"
                >
                  {description}
                </p>
              )}
            </div>
          )}

          <button
            type="button"
            className="mb-modal__close"
            onClick={onClose}
            aria-label="Закрыть модальное окно"
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