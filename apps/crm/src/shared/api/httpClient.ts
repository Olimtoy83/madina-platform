export interface HttpRequestOptions
  extends Omit<RequestInit, 'body'> {
  body?: unknown
}

export type HttpResponseOptions = RequestInit

type UnauthorizedListener = () => void

const unauthorizedListeners = new Set<UnauthorizedListener>()

export class HttpError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(
    status: number,
    message: string,
    body: unknown = undefined,
  ) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.body = body
  }
}

export function subscribeToUnauthorized(
  listener: UnauthorizedListener,
): () => void {
  unauthorizedListeners.add(listener)

  return () => {
    unauthorizedListeners.delete(listener)
  }
}

function notifyUnauthorized(): void {
  for (const listener of unauthorizedListeners) {
    listener()
  }
}

export async function requestJson<T>(
  url: string,
  options: HttpRequestOptions = {},
): Promise<T> {
  const headers = new Headers(options.headers)

  if (
    options.body !== undefined &&
    !headers.has('Content-Type')
  ) {
    headers.set(
      'Content-Type',
      'application/json',
    )
  }

  const response = await requestResponse(url, {
    ...options,
    headers,
    body:
      options.body === undefined
        ? undefined
        : JSON.stringify(options.body),
  })

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

export async function requestResponse(
  url: string,
  options: HttpResponseOptions = {},
): Promise<Response> {
  const response = await fetch(url, {
    ...options,
    credentials: options.credentials ?? 'same-origin',
  })

  if (!response.ok) {
    let message =
      `Request failed with status ${response.status}`
    let body: unknown

    try {
      body = await response.json()
      const errorBody = body as {
          message?: unknown
        }

      if (typeof errorBody.message === 'string') {
        message = errorBody.message
      }
    } catch {
      // Keep the fallback HTTP error message.
    }

    const error = new HttpError(
      response.status,
      message,
      body,
    )

    if (response.status === 401) {
      notifyUnauthorized()
    }

    throw error
  }

  return response
}
