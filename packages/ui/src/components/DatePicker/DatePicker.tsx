import {
  useId,
  type ChangeEvent,
  type InputHTMLAttributes,
} from 'react'
import './DatePicker.css'

export interface DatePickerProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'type'
  > {
  label?: string
  error?: string
}

export function DatePicker({
  label,
  error,
  id: providedId,
  className = '',
  ...props
}: DatePickerProps) {
  const generatedId = useId()
  const inputId = providedId ?? generatedId

  const classes = [
    'mb-date-picker',
    error ? 'mb-date-picker--error' : '',
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
      {label && (
        <label
          className="mb-date-picker__label"
          htmlFor={inputId}
        >
          {label}
        </label>
      )}

      <input
        {...props}
        id={inputId}
        type="date"
        className="mb-date-picker__input"
        aria-invalid={error ? true : undefined}
        aria-describedby={
          error
            ? `${inputId}-error`
            : undefined
        }
        onChange={handleChange}
      />

      {error && (
        <span
          id={`${inputId}-error`}
          className="mb-date-picker__error"
          role="alert"
        >
          {error}
        </span>
      )}
    </div>
  )
}
