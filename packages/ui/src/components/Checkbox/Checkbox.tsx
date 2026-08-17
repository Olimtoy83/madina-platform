import {
  useId,
  type ChangeEvent,
  type InputHTMLAttributes,
} from 'react'
import './Checkbox.css'

export interface CheckboxProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'type'
  > {
  label?: string
  error?: string
}

export function Checkbox({
  label,
  error,
  id: providedId,
  className = '',
  disabled,
  ...props
}: CheckboxProps) {
  const generatedId = useId()
  const inputId = providedId ?? generatedId

  const classes = [
    'mb-checkbox',
    error ? 'mb-checkbox--error' : '',
    disabled ? 'mb-checkbox--disabled' : '',
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
        className="mb-checkbox__label"
        htmlFor={inputId}
      >
        <input
          {...props}
          id={inputId}
          type="checkbox"
          className="mb-checkbox__input"
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            error
              ? `${inputId}-error`
              : undefined
          }
          onChange={handleChange}
        />

        <span
          className="mb-checkbox__control"
          aria-hidden="true"
        />

        {label && (
          <span className="mb-checkbox__text">
            {label}
          </span>
        )}
      </label>

      {error && (
        <span
          id={`${inputId}-error`}
          className="mb-checkbox__error"
          role="alert"
        >
          {error}
        </span>
      )}
    </div>
  )
}
