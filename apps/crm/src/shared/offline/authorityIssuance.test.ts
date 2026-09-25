import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpError } from '../api/httpClient'
import { AuthorityIssuanceIntegrityError, beginAuthorityIssuance, beginRenewedAuthorityIssuance, classifyAuthorityIssuanceError } from './authorityIssuance'

const auth = { user: null, isLoading: false, error: null } as never
afterEach(() => vi.unstubAllGlobals())

describe('authority issuance input and outcome policy', () => {
  it.each([
    { locationId: '', expiresAt: new Date(Date.now() + 60_000).toISOString(), permitCount: 1, productIds: ['p'] },
    { locationId: 'l', expiresAt: 'not-iso', permitCount: 1, productIds: ['p'] },
    { locationId: 'l', expiresAt: new Date(Date.now() - 60_000).toISOString(), permitCount: 1, productIds: ['p'] },
    { locationId: 'l', expiresAt: new Date(Date.now() + 60_000).toISOString(), permitCount: 0, productIds: ['p'] },
    { locationId: 'l', expiresAt: new Date(Date.now() + 60_000).toISOString(), permitCount: 1, productIds: [] },
    { locationId: 'l', expiresAt: new Date(Date.now() + 60_000).toISOString(), permitCount: 1, productIds: ['p', 'p'] },
  ])('rejects invalid input before touching identity or network', async input => {
    await expect(beginAuthorityIssuance(input, auth)).rejects.toBeInstanceOf(AuthorityIssuanceIntegrityError)
  })

  it.each([
    [401, 'AUTH_HOLD'], [403, 'ACCESS_HOLD'], [408, 'PENDING'], [429, 'PENDING'],
    [500, 'PENDING'], [503, 'PENDING'], [400, 'REVIEW_HOLD'], [404, 'REVIEW_HOLD'], [409, 'REVIEW_HOLD'],
  ] as const)('classifies HTTP %i as %s without relying on response text', (status, expected) => {
    expect(classifyAuthorityIssuanceError(new HttpError(status, 'arbitrary'))).toBe(expected)
  })

  it('retains an uncertain network result and reviews unexpected failures', () => {
    expect(classifyAuthorityIssuanceError(new TypeError('Failed to fetch'))).toBe('PENDING')
    expect(classifyAuthorityIssuanceError(new Error('unexpected'))).toBe('REVIEW_HOLD')
  })
})

describe('public completed-renewal gate', () => {
  const input = { locationId: 'location-1', expiresAt: new Date(Date.now() + 60_000).toISOString(), permitCount: 1, productIds: ['product-1'] }

  it('rejects an invalid completed command identity before storage access', async () => {
    await expect(beginRenewedAuthorityIssuance('', input, auth)).rejects.toBeInstanceOf(AuthorityIssuanceIntegrityError)
  })

  it('rejects NONE before generating a replacement command', async () => {
    const request: { transaction: { abort: ReturnType<typeof vi.fn> }; onupgradeneeded?: (event: { oldVersion: number }) => void; onerror?: () => void } = { transaction: { abort: vi.fn() } }
    const open = vi.fn(() => {
      queueMicrotask(() => { request.onupgradeneeded?.({ oldVersion: 0 }); request.onerror?.() })
      return request
    })
    vi.stubGlobal('indexedDB', { open })
    await expect(beginRenewedAuthorityIssuance('completed-1', input, auth)).rejects.toBeInstanceOf(AuthorityIssuanceIntegrityError)
    expect(open).toHaveBeenCalledTimes(1)
  })
})
