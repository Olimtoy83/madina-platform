import {
  useId,
  type ChangeEvent,
  type InputHTMLAttributes,
} from 'react'
import './Switch.css'

export interface SwitchProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'type'
  > {
  label?: string
  description?: string
  error?: string
}

export function Switch({
  label,
  description,
  error,
  id: providedId,
  className = '',
  disabled,
  ...props
}: SwitchProps) {
  const generatedId = useId()
  const inputId = providedId ?? generatedId

  const classes = [
    'mb-switch',
    error ? 'mb-switch--error' : '',
    disabled ? 'mb-switch--disabled' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const handleChange = (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    props.onChange?.(event)
  }

  return (
    <div className={classes}>
      <label
        className="mb-switch__label"
        htmlFor={inputId}
      >
        <input
          {...props}
          id={inputId}
          type="checkbox"
          role="switch"
          className="mb-switch__input"
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            error
              ? `${inputId}-error`
              : description
                ? `${inputId}-description`
                : undefined
          }
          onChange={handleChange}
        />

        <span
          className="mb-switch__control"
          aria-hidden="true"
        >
          <span className="mb-switch__thumb" />
        </span>

        {(label || description) && (
          <span className="mb-switch__content">
            {label && (
              <span className="mb-switch__text">
                {label}
              </span>
            )}

            {description && (
              <span
                id={`${inputId}-description`}
                className="mb-switch__description"
              >
                {description}
              </span>
            )}
          </span>
        )}
      </label>

      {error && (
        <span
          id={`${inputId}-error`}
          className="mb-switch__error"
          role="alert"
        >
          {error}
        </span>
      )}
    </div>
  )
}
