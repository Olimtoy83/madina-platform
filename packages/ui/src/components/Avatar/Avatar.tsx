import {
  useState,
  type ImgHTMLAttributes,
} from 'react'
import './Avatar.css'

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl'

export interface AvatarProps
  extends Omit<
    ImgHTMLAttributes<HTMLImageElement>,
    'alt'
  > {
  alt?: string
  fallback?: string
  size?: AvatarSize
}

export function Avatar({
  alt = '',
  fallback,
  size = 'md',
  src,
  className = '',
  ...props
}: AvatarProps) {
  const [hasError, setHasError] = useState(false)

  const classes = [
    'mb-avatar',
    `mb-avatar--${size}`,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const initials = fallback
    ? fallback
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join('')
    : ''

  if (!src || hasError) {
    return (
      <span
        className={classes}
        role="img"
        aria-label={alt || fallback}
        {...(props as Record<string, unknown>)}
      >
        {initials || '•'}
      </span>
    )
  }

  return (
    <img
      {...props}
      src={src}
      alt={alt}
      className={classes}
      onError={() => setHasError(true)}
    />
  )
}
