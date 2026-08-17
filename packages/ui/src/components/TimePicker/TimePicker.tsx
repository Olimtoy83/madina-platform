import {
  useId,
  type ChangeEvent,
  type InputHTMLAttributes,
} from 'react'
import './TimePicker.css'

export interface TimePickerProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'type'
  > {
  label?: string
  error?: string
}

export function TimePicker({
  label,
  error,
  id: providedId,
  className = '',
  ...props
}: TimePickerProps) {
  const generatedId = useId()
  const inputId = providedId ?? generatedId

  const classes = [
    'mb-time-picker',
    error ? 'mb-time-picker--error' : '',
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
          className="mb-time-picker__label"
          htmlFor={inputId}
        >
          {label}
        </label>
      )}

      <input
        {...props}
        id={inputId}
        type="time"
        className="mb-time-picker__input"
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
          className="mb-time-picker__error"
          role="alert"
        >
          {error}
        </span>
      )}
    </div>
  )
}
