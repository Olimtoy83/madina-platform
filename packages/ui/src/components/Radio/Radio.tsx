import {
  useId,
  type ChangeEvent,
  type InputHTMLAttributes,
} from 'react'
import './Radio.css'

export interface RadioProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'type'
  > {
  label?: string
  error?: string
}

export function Radio({
  label,
  error,
  id: providedId,
  className = '',
  disabled,
  ...props
}: RadioProps) {
  const generatedId = useId()
  const inputId = providedId ?? generatedId

  const classes = [
    'mb-radio',
    error ? 'mb-radio--error' : '',
    disabled ? 'mb-radio--disabled' : '',
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
        className="mb-radio__label"
        htmlFor={inputId}
      >
        <input
          {...props}
          id={inputId}
          type="radio"
          className="mb-radio__input"
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
          className="mb-radio__control"
          aria-hidden="true"
        />

        {label && (
          <span className="mb-radio__text">
            {label}
          </span>
        )}
      </label>

      {error && (
        <span
          id={`${inputId}-error`}
          className="mb-radio__error"
          role="alert"
        >
          {error}
        </span>
      )}
    </div>
  )
}
