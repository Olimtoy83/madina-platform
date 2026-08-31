import { equal } from 'node:assert/strict'
import test from 'node:test'
import {
  GLOBAL_RATE_LIMIT_MAX_REQUESTS,
  GlobalRateLimiter,
} from './GlobalRateLimiter.js'

test('global limiter allows normal traffic and rejects a burst from one source', () => {
  const limiter = new GlobalRateLimiter()
  const now = 1_000

  for (let index = 0; index < GLOBAL_RATE_LIMIT_MAX_REQUESTS; index += 1) {
    equal(limiter.check('203.0.113.20', now).allowed, true)
    limiter.record('203.0.113.20', now)
  }

  const rejected = limiter.check('203.0.113.20', now)
  equal(rejected.allowed, false)
  equal(rejected.retryAfterSeconds, 60)
  equal(limiter.check('203.0.113.21', now).allowed, true)
})
