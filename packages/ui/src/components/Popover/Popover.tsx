import {
  useEffect,
  useRef,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import './Popover.css'

export type PopoverPlacement =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'

export interface PopoverProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'content'> {
  open: boolean
  onClose?: () => void
  content: ReactNode
  placement?: PopoverPlacement
  closeOnOutsideClick?: boolean
  closeOnEscape?: boolean
  children: ReactNode
}

export function Popover({
  open,
  onClose,
  content,
  placement = 'bottom',
  closeOnOutsideClick = true,
  closeOnEscape = true,
  children,
  className = '',
  ...props
}: PopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || !closeOnEscape || !onClose) {
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
    if (!open || !closeOnOutsideClick || !onClose) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target

      if (
        target instanceof Node &&
        !rootRef.current?.contains(target)
      ) {
        onClose()
      }
    }

    document.addEventListener(
      'pointerdown',
      handlePointerDown,
    )

    return () => {
      document.removeEventListener(
        'pointerdown',
        handlePointerDown,
      )
    }
  }, [open, closeOnOutsideClick, onClose])

  const classes = [
    'mb-popover',
    `mb-popover--${placement}`,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      ref={rootRef}
      className="mb-popover__root"
    >
      <div className="mb-popover__trigger">
        {children}
      </div>

      {open && (
        <div
          className={classes}
          role="dialog"
          {...props}
        >
          {content}
        </div>
      )}
    </div>
  )
}
