import type { HTMLAttributes } from 'react'
import './Card.css'

export type CardVariant =
  | 'default'
  | 'outlined'
  | 'soft'

export interface CardProps
  extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant
  padding?: 'none' | 'sm' | 'md' | 'lg'
}

export function Card({
  variant = 'default',
  padding = 'md',
  className = '',
  ...props
}: CardProps) {
  const classes = [
    'mb-card',
    `mb-card--${variant}`,
    `mb-card--padding-${padding}`,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={classes}
      {...props}
    />
  )
}
