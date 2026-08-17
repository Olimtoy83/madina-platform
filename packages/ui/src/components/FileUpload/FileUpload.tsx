import {
  useId,
  useRef,
  type ChangeEvent,
  type DragEvent,
  type InputHTMLAttributes,
} from 'react'
import './FileUpload.css'

export interface FileUploadProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'type' | 'onChange'
  > {
  label?: string
  error?: string
  hint?: string
  onFilesChange?: (files: File[]) => void
}

export function FileUpload({
  label,
  error,
  hint,
  id: providedId,
  className = '',
  onFilesChange,
  disabled,
  ...props
}: FileUploadProps) {
  const generatedId = useId()
  const inputId = providedId ?? generatedId
  const inputRef = useRef<HTMLInputElement>(null)

  const classes = [
    'mb-file-upload',
    error ? 'mb-file-upload--error' : '',
    disabled ? 'mb-file-upload--disabled' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const emitFiles = (files: FileList | null) => {
    if (!files || files.length === 0) {
      return
    }

    onFilesChange?.(Array.from(files))
  }

  const handleChange = (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    emitFiles(event.target.files)
  }

  const handleDragOver = (
    event: DragEvent<HTMLLabelElement>,
  ) => {
    event.preventDefault()
  }

  const handleDrop = (
    event: DragEvent<HTMLLabelElement>,
  ) => {
    event.preventDefault()

    if (disabled) {
      return
    }

    emitFiles(event.dataTransfer.files)
  }

  return (
    <div className={classes}>
      {label && (
        <span className="mb-file-upload__label">
          {label}
        </span>
      )}

      <label
        htmlFor={inputId}
        className="mb-file-upload__dropzone"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <span className="mb-file-upload__title">
          Choose files
        </span>

        <span className="mb-file-upload__description">
          Click to browse or drag and drop files here
        </span>

        {hint && (
          <span className="mb-file-upload__hint">
            {hint}
          </span>
        )}

        <input
          {...props}
          ref={inputRef}
          id={inputId}
          type="file"
          className="mb-file-upload__input"
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            error
              ? `${inputId}-error`
              : undefined
          }
          onChange={handleChange}
        />
      </label>

      {error && (
        <span
          id={`${inputId}-error`}
          className="mb-file-upload__error"
          role="alert"
        >
          {error}
        </span>
      )}
    </div>
  )
}
