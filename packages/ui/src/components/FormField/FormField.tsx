import type { HTMLAttributes, ReactNode } from 'react'
import './FormField.css'

export interface FormFieldProps
  extends HTMLAttributes<HTMLDivElement> {
  label?: ReactNode
  description?: ReactNode
  error?: ReactNode
  required?: boolean
  htmlFor?: string
}

export function FormField({
  label,
  description,
  error,
  required = false,
  htmlFor,
  className = '',
  children,
  ...props
}: FormFieldProps) {
  const classes = [
    'mb-form-field',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={classes}
      {...props}
    >
      {label && (
        <label
          className="mb-form-field__label"
          htmlFor={htmlFor}
        >
          {label}

          {required && (
            <span
              className="mb-form-field__required"
              aria-hidden="true"
            >
              *
            </span>
          )}
        </label>
      )}

      {description && (
        <div className="mb-form-field__description">
          {description}
        </div>
      )}

      <div className="mb-form-field__control">
        {children}
      </div>

      {error && (
        <div
          className="mb-form-field__error"
          role="alert"
        >
          {error}
        </div>
      )}
    </div>
  )
}
