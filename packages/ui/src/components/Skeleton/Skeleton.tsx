import type { HTMLAttributes } from 'react'
import './Skeleton.css'

export type SkeletonVariant =
  | 'text'
  | 'rect'
  | 'circle'

export interface SkeletonProps
  extends HTMLAttributes<HTMLDivElement> {
  variant?: SkeletonVariant
  width?: string | number
  height?: string | number
  lines?: number
}

function toCssSize(
  value?: string | number,
) {
  if (typeof value === 'number') {
    return `${value}px`
  }

  return value
}

export function Skeleton({
  variant = 'rect',
  width,
  height,
  lines = 1,
  className = '',
  style,
  ...props
}: SkeletonProps) {
  const classes = [
    'mb-skeleton',
    `mb-skeleton--${variant}`,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const skeletonStyle = {
    ...style,
    ...(width !== undefined
      ? { width: toCssSize(width) }
      : {}),
    ...(height !== undefined
      ? { height: toCssSize(height) }
      : {}),
  }

  if (variant === 'text' && lines > 1) {
    return (
      <div
        className="mb-skeleton__group"
        aria-busy="true"
        aria-live="polite"
        {...props}
      >
        {Array.from({ length: lines }).map(
          (_, index) => (
            <div
              key={index}
              className={classes}
              style={
                index === lines - 1
                  ? {
                    ...skeletonStyle,
                    width:
                      toCssSize(width) ??
                      '70%',
                  }
                  : skeletonStyle
              }
            />
          ),
        )}
      </div>
    )
  }

  return (
    <div
      className={classes}
      style={skeletonStyle}
      aria-busy="true"
      aria-live="polite"
      {...props}
    />
  )
}
