const STORAGE_PREFIX = 'madina-crm:v1:'

export function loadStorage<T>(
  key: string,
  fallback: T,
): T {
  try {
    const rawValue = localStorage.getItem(
      `${STORAGE_PREFIX}${key}`,
    )

    if (!rawValue) {
      return fallback
    }

    return JSON.parse(rawValue) as T
  } catch {
    return fallback
  }
}

export function saveStorage<T>(
  key: string,
  value: T,
) {
  try {
    localStorage.setItem(
      `${STORAGE_PREFIX}${key}`,
      JSON.stringify(value),
    )
  } catch {
    // Storage may be unavailable or full.
  }
}

export function removeStorage(key: string) {
  try {
    localStorage.removeItem(
      `${STORAGE_PREFIX}${key}`,
    )
  } catch {
    // Ignore storage errors.
  }
}
