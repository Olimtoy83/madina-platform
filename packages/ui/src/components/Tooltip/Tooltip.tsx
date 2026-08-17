import {
  useState,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import './Tooltip.css'

export type TooltipPlacement =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'

export type TooltipSize =
  | 'sm'
  | 'md'

export interface TooltipProps
  extends Omit<
    HTMLAttributes<HTMLSpanElement>,
    'content'
  > {
  content: ReactNode
  placement?: TooltipPlacement
  size?: TooltipSize
  children: ReactNode
  disabled?: boolean
}

export function Tooltip({
  content,
  placement = 'top',
  size = 'md',
  children,
  disabled = false,
  className = '',
  ...props
}: TooltipProps) {
  const [open, setOpen] = useState(false)

  const classes = [
    'mb-tooltip',
    `mb-tooltip--${placement}`,
    `mb-tooltip--${size}`,
    open ? 'mb-tooltip--open' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  if (disabled) {
    return (
      <span
        {...props}
        className={className}
      >
        {children}
      </span>
    )
  }

  return (
    <span
      {...props}
      className={classes}
      onMouseEnter={(event) => {
        setOpen(true)
        props.onMouseEnter?.(event)
      }}
      onMouseLeave={(event) => {
        setOpen(false)
        props.onMouseLeave?.(event)
      }}
      onFocus={(event) => {
        setOpen(true)
        props.onFocus?.(event)
      }}
      onBlur={(event) => {
        setOpen(false)
        props.onBlur?.(event)
      }}
    >
      <span className="mb-tooltip__trigger">
        {children}
      </span>

      <span
        className="mb-tooltip__content"
        role="tooltip"
      >
        {content}
      </span>
    </span>
  )
}
