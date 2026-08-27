export const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 5
export const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000

const MAX_TRACKED_SOURCES = 10_000

export interface LoginRateLimitResult {
  allowed: boolean
  retryAfterSeconds?: number
}

export class LoginRateLimiter {
  private readonly attemptsBySource = new Map<string, number[]>()

  check(
    source: string,
    now = Date.now(),
  ): LoginRateLimitResult {
    const attempts = this.activeAttempts(source, now)

    if (attempts.length < LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
      return { allowed: true }
    }

    const oldestAttempt = attempts[0]
    const retryAfterMilliseconds =
      oldestAttempt + LOGIN_RATE_LIMIT_WINDOW_MS - now

    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil(retryAfterMilliseconds / 1000),
      ),
    }
  }

  recordFailure(
    source: string,
    now = Date.now(),
  ): void {
    const attempts = this.activeAttempts(source, now)

    if (!this.attemptsBySource.has(source)) {
      this.evictOldestSourceIfNeeded()
    }

    attempts.push(now)
    this.attemptsBySource.set(source, attempts)
  }

  private activeAttempts(
    source: string,
    now: number,
  ): number[] {
    const attempts = this.attemptsBySource.get(source) ?? []
    const activeAttempts = attempts.filter((attempt) =>
      now - attempt < LOGIN_RATE_LIMIT_WINDOW_MS
    )

    if (activeAttempts.length === 0) {
      this.attemptsBySource.delete(source)
    } else {
      this.attemptsBySource.set(source, activeAttempts)
    }

    return activeAttempts
  }

  private evictOldestSourceIfNeeded(): void {
    if (this.attemptsBySource.size < MAX_TRACKED_SOURCES) {
      return
    }

    const oldestSource = this.attemptsBySource.keys().next().value

    if (oldestSource !== undefined) {
      this.attemptsBySource.delete(oldestSource)
    }
  }
}
