export class UsernameValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsernameValidationError'
  }
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase()
}

export function validateUsername(username: string): string {
  const normalizedUsername = normalizeUsername(username)

  if (normalizedUsername.length === 0) {
    throw new UsernameValidationError('Username must not be empty.')
  }

  if (normalizedUsername.length > 128) {
    throw new UsernameValidationError(
      'Username must not exceed 128 characters.',
    )
  }

  if (/\p{Cc}/u.test(normalizedUsername)) {
    throw new UsernameValidationError(
      'Username must not contain control characters.',
    )
  }

  return normalizedUsername
}
