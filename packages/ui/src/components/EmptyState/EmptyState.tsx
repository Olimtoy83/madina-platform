import type {
  HTMLAttributes,
  ReactNode,
} from 'react'
import './EmptyState.css'

export interface EmptyStateProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  action?: ReactNode
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className = '',
  ...props
}: EmptyStateProps) {
  const classes = [
    'mb-empty-state',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={classes}
      {...props}
    >
      {icon && (
        <div
          className="mb-empty-state__icon"
          aria-hidden="true"
        >
          {icon}
        </div>
      )}

      <div className="mb-empty-state__content">
        <h2 className="mb-empty-state__title">
          {title}
        </h2>

        {description && (
          <div className="mb-empty-state__description">
            {description}
          </div>
        )}
      </div>

      {action && (
        <div className="mb-empty-state__action">
          {action}
        </div>
      )}
    </div>
  )
}
