import {
  cloneElement,
  useEffect,
  useId,
  useState,
  type ReactElement,
  type ReactNode,
  type HTMLAttributes,
} from 'react'
import './Tooltip.css'

export type TooltipPlacement =
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'

export type TooltipSize =
  | 'sm'
  | 'md'

type TooltipChildProps =
  HTMLAttributes<HTMLElement>

export interface TooltipProps {
  content: ReactNode
  children: ReactElement<TooltipChildProps>
  placement?: TooltipPlacement
  size?: TooltipSize
  delay?: number
  disabled?: boolean
}

export function Tooltip({
  content,
  children,
  placement = 'top',
  size = 'md',
  delay = 300,
  disabled = false,
}: TooltipProps) {
  const [open, setOpen] = useState(false)
  const [visible, setVisible] = useState(false)
  const tooltipId = useId()

  useEffect(() => {
    if (disabled) {
      setOpen(false)
      setVisible(false)
      return
    }

    if (!open) {
      setVisible(false)
      return
    }

    if (delay <= 0) {
      setVisible(true)
      return
    }

    const timeoutId = window.setTimeout(() => {
      setVisible(true)
    }, delay)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [open, delay, disabled])

  useEffect(() => {
    if (!visible) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [visible])

  if (disabled) {
    return children
  }

  const classes = [
    'mb-tooltip__content',
    `mb-tooltip__content--${placement}`,
    `mb-tooltip__content--${size}`,
  ].join(' ')

  const child = cloneElement(children, {
    'aria-describedby': visible
      ? tooltipId
      : undefined,
    onMouseEnter: () => setOpen(true),
    onMouseLeave: () => setOpen(false),
    onFocus: () => setOpen(true),
    onBlur: () => setOpen(false),
  })

  return (
    <span className="mb-tooltip">
      {child}

      {visible && (
        <span
          id={tooltipId}
          className={classes}
          role="tooltip"
        >
          {content}
        </span>
      )}
    </span>
  )
}