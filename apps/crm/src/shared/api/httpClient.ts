export interface HttpRequestOptions
  extends Omit<RequestInit, 'body'> {
  body?: unknown
}

export class HttpError extends Error {
  readonly status: number

  constructor(
    status: number,
    message: string,
  ) {
    super(message)
    this.name = 'HttpError'
    this.status = status
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

  const response = await fetch(url, {
    ...options,
    headers,
    body:
      options.body === undefined
        ? undefined
        : JSON.stringify(options.body),
  })

  if (!response.ok) {
    let message =
      `Request failed with status ${response.status}`

    try {
      const errorBody =
        (await response.json()) as {
          message?: unknown
        }

      if (typeof errorBody.message === 'string') {
        message = errorBody.message
      }
    } catch {
      // Keep the fallback HTTP error message.
    }

    throw new HttpError(
      response.status,
      message,
    )
  }

  return (await response.json()) as T
}
