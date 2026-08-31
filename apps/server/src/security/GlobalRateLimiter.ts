export const GLOBAL_RATE_LIMIT_MAX_REQUESTS = 240
export const GLOBAL_RATE_LIMIT_WINDOW_MS = 60 * 1000

const MAX_TRACKED_SOURCES = 10_000

export interface GlobalRateLimitResult {
  allowed: boolean
  retryAfterSeconds?: number
}

export class GlobalRateLimiter {
  private readonly requestsBySource = new Map<string, number[]>()

  check(source: string, now = Date.now()): GlobalRateLimitResult {
    const requests = this.activeRequests(source, now)

    if (requests.length < GLOBAL_RATE_LIMIT_MAX_REQUESTS) {
      return { allowed: true }
    }

    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((requests[0] + GLOBAL_RATE_LIMIT_WINDOW_MS - now) / 1000),
      ),
    }
  }

  record(source: string, now = Date.now()): void {
    const requests = this.activeRequests(source, now)

    if (!this.requestsBySource.has(source)) {
      this.evictOldestSourceIfNeeded()
    }

    requests.push(now)
    this.requestsBySource.set(source, requests)
  }

  private activeRequests(source: string, now: number): number[] {
    const requests = this.requestsBySource.get(source) ?? []
    const active = requests.filter((request) =>
      now - request < GLOBAL_RATE_LIMIT_WINDOW_MS,
    )

    if (active.length === 0) {
      this.requestsBySource.delete(source)
    } else {
      this.requestsBySource.set(source, active)
    }

    return active
  }

  private evictOldestSourceIfNeeded(): void {
    if (this.requestsBySource.size < MAX_TRACKED_SOURCES) return

    const oldestSource = this.requestsBySource.keys().next().value
    if (oldestSource !== undefined) this.requestsBySource.delete(oldestSource)
  }
}
