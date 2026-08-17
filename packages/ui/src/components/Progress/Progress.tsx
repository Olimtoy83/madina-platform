import {
  useId,
  type HTMLAttributes,
} from 'react'
import './Progress.css'

export interface ProgressProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'aria-valuenow'> {
  value: number
  max?: number
  label?: string
  showValue?: boolean
}

export function Progress({
  value,
  max = 100,
  label,
  showValue = false,
  className = '',
  ...props
}: ProgressProps) {
  const generatedId = useId()

  const safeMax = max > 0 ? max : 100
  const safeValue = Math.min(
    Math.max(value, 0),
    safeMax,
  )

  const percentage =
    (safeValue / safeMax) * 100

  const labelId = label
    ? `${generatedId}-label`
    : undefined

  const classes = [
    'mb-progress',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      {...props}
      className={classes}
    >
      {(label || showValue) && (
        <div className="mb-progress__header">
          {label && (
            <span
              id={labelId}
              className="mb-progress__label"
            >
              {label}
            </span>
          )}

          {showValue && (
            <span className="mb-progress__value">
              {Math.round(percentage)}%
            </span>
          )}
        </div>
      )}

      <div
        className="mb-progress__track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={safeValue}
        aria-labelledby={labelId}
      >
        <div
          className="mb-progress__indicator"
          style={{
            width: `${percentage}%`,
          }}
        />
      </div>
    </div>
  )
}
