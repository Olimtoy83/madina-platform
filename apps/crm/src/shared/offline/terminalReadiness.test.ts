import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpError } from '../api/httpClient'
import type { State } from './offlineAuthorityLedger'
import { checkTerminalReadiness } from './terminalReadiness'

const mocks = vi.hoisted(() => ({
  location: vi.fn(), terminal: vi.fn(), authority: vi.fn(), permits: vi.fn(),
  snapshot: vi.fn(), identity: vi.fn(), inspectAuthority: vi.fn(), checked: vi.fn(), eligible: vi.fn(),
  generate: vi.fn(), enroll: vi.fn(), install: vi.fn(), reserve: vi.fn(),
}))
vi.mock('../api/retailApi', () => ({
  getRetailLocation: mocks.location, getRetailOfflineTerminalDetail: mocks.terminal,
  getRetailOfflineAuthorityDetail: mocks.authority, getRetailOfflineAuthorityPermits: mocks.permits,
}))
vi.mock('./terminalIdentity', () => ({ inspectStoredTerminalIdentity: mocks.identity, generateTerminalIdentity: mocks.generate }))
vi.mock('./terminalProvisioning', () => ({ beginTerminalEnrollment: mocks.enroll }))
vi.mock('./offlineAuthorityLedger', () => ({
  readOfflineStateSnapshot: mocks.snapshot, inspectServerOfflineAuthority: mocks.inspectAuthority,
  checked: mocks.checked, eligibleForNew: mocks.eligible,
  installOfflineAuthority: mocks.install, useReserveOfflinePermit: mocks.reserve,
  time: (value: string) => Date.parse(value),
}))

const user = { id: 'user-1', role: 'manager' } as const
const auth = { user, isLoading: false, error: null }
const issuedAt = new Date(Date.now() - 60_000).toISOString()
const expiresAt = new Date(Date.now() + 3_600_000).toISOString()
const authority = { authorityId: 'authority-1', authorityVersion: 1, terminalId: 'terminal-1', terminalKeyVersion: 1, userId: user.id, locationId: 'location-1', issuedAt, expiresAt, currencyCode: 'USD', currencyExponent: 2, permitCount: 1, productPrices: [{ productId: 'product-1', unitPriceMinor: 100 }] }
const permit = { authorityId: 'authority-1', permitId: 'permit-1', sequence: 0, serverStatus: 'AVAILABLE', localState: 'AVAILABLE' }
const meta = { version: 1, terminalId: 'terminal-1', locationId: 'location-1', authorityIds: ['authority-1'], lastObservedMs: Date.now() - 30_000, knownTerminalUnsafe: false }
const terminalIdentity = { state: 'ENROLLED', terminalId: 'terminal-1', locationId: 'location-1', currentKeyVersion: 1, publicKey: 'public-only', signOfflineEnvelope: vi.fn() }
let state: State

function diagnosticDatabase() {
  const db = { version: 4, objectStoreNames: ['identity', 'offlineAuthorities', 'offlinePermits', 'offlineMeta', 'offlineSales', 'offlineSaleSync'], close: vi.fn() }
  vi.stubGlobal('indexedDB', { open: vi.fn(() => {
    const request: { result: typeof db; onsuccess?: () => void } = { result: db }
    queueMicrotask(() => request.onsuccess?.())
    return request
  }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  state = { identity: {}, meta, authorities: [{ snapshot: authority, knownRevoked: false }], permits: [permit], sales: [], saleKeys: [], sync: [], syncKeys: [] } as State
  diagnosticDatabase()
  mocks.location.mockResolvedValue({ id: 'location-1', status: 'active', type: 'store', currencyCode: 'USD', currencyExponent: 2 })
  mocks.terminal.mockResolvedValue({ terminalId: 'terminal-1', locationId: 'location-1', currentKeyVersion: 1, revoked: false })
  mocks.authority.mockResolvedValue({})
  mocks.permits.mockResolvedValue({})
  mocks.snapshot.mockImplementation(async () => state)
  mocks.identity.mockResolvedValue({ terminal: terminalIdentity })
  mocks.inspectAuthority.mockReturnValue({ snapshot: authority, revoked: false, permits: [{ permitId: 'permit-1', sequence: 0, status: 'AVAILABLE' }] })
  mocks.checked.mockImplementation(() => state.meta)
  mocks.eligible.mockReturnValue({})
})

describe('terminal readiness', () => {
  it('derives READY from coherent local and server state without returning a signing capability', async () => {
    const value = await checkTerminalReadiness('location-1', auth as never)
    expect(value).toEqual({ status: 'READY', reason: 'READY', nextAction: 'NONE_READY', requestedLocationId: 'location-1', currentLocationId: 'location-1', terminalId: 'terminal-1', terminalKeyVersion: 1, terminalRevoked: false, terminalMismatch: false, authorityId: 'authority-1', authorityExpiresAt: expiresAt, availablePermitCount: 1, serverVerified: true })
    expect(JSON.stringify(value)).not.toMatch(/privateKey|signOfflineEnvelope|public-only|signature|cookie|token/)
  })
  it('does not create identity, enrollment, authority, or a permit on any check', async () => {
    await checkTerminalReadiness('location-1', auth as never)
    expect([mocks.generate, mocks.enroll, mocks.install, mocks.reserve].map(mock => mock.mock.calls.length)).toEqual([0, 0, 0, 0])
    expect(mocks.location).toHaveBeenCalledBefore(mocks.snapshot)
  })
  it.each([
    ['UNAUTHENTICATED', { user: null }, 'AUTHENTICATE'],
    ['CAPABILITY_DENIED', { user: { id: 'operator-1', role: 'operator' } }, 'REQUEST_ACCESS'],
  ])('%s is denied before local access', async (reason, change, action) => {
    expect(await checkTerminalReadiness('location-1', { ...auth, ...change } as never)).toMatchObject({ status: 'NOT_READY', reason, nextAction: action, serverVerified: false })
    expect(mocks.snapshot).not.toHaveBeenCalled()
  })
  it.each([
    [401, 'UNAUTHENTICATED'], [403, 'LOCATION_ACCESS_DENIED'], [503, 'SERVER_UNAVAILABLE'],
  ])('distinguishes location check HTTP %i', async (status, reason) => {
    mocks.location.mockRejectedValue(new HttpError(status, 'untrusted text'))
    expect(await checkTerminalReadiness('location-1', auth as never)).toMatchObject({ reason, serverVerified: false })
    expect(mocks.snapshot).not.toHaveBeenCalled()
  })
  it('distinguishes terminal-detail 401, 403, and network failure', async () => {
    for (const [error, reason] of [[new HttpError(401, 'x'), 'UNAUTHENTICATED'], [new HttpError(403, 'x'), 'LOCATION_ACCESS_DENIED'], [new TypeError('network'), 'SERVER_UNAVAILABLE']] as const) {
      mocks.terminal.mockRejectedValueOnce(error)
      expect(await checkTerminalReadiness('location-1', auth as never)).toMatchObject({ reason, serverVerified: false })
    }
  })
  it('reports missing identity, pending provisioning, and unenrolled key separately', async () => {
    const populated = state
    state = { identity: undefined, meta: undefined, authorities: [], permits: [], sales: [], saleKeys: [], sync: [], syncKeys: [] }
    mocks.identity.mockResolvedValueOnce(undefined)
    expect(await checkTerminalReadiness('location-1', auth as never)).toMatchObject({ reason: 'IDENTITY_MISSING' })
    state = populated
    mocks.identity.mockResolvedValueOnce({ terminal: terminalIdentity, pending: { kind: 'enrollment' } })
    expect(await checkTerminalReadiness('location-1', auth as never)).toMatchObject({ reason: 'PROVISIONING_PENDING' })
    state = { identity: {}, meta: undefined, authorities: [], permits: [], sales: [], saleKeys: [], sync: [], syncKeys: [] }
    mocks.identity.mockResolvedValueOnce({ terminal: { ...terminalIdentity, state: 'KEY_GENERATED', terminalId: undefined } })
    expect(await checkTerminalReadiness('location-1', auth as never)).toMatchObject({ reason: 'TERMINAL_NOT_ENROLLED' })
  })
  it('fails closed on revoked, foreign, and wrong-version terminal detail', async () => {
    mocks.terminal.mockResolvedValueOnce({ terminalId: 'terminal-1', locationId: 'location-1', currentKeyVersion: 1, revoked: true })
    expect(await checkTerminalReadiness('location-1', auth as never)).toMatchObject({ reason: 'TERMINAL_REVOKED', terminalRevoked: true })
    mocks.identity.mockResolvedValueOnce({ terminal: { ...terminalIdentity, locationId: 'foreign' } })
    expect(await checkTerminalReadiness('location-1', auth as never)).toMatchObject({ reason: 'TERMINAL_MISMATCH', terminalMismatch: true })
    mocks.terminal.mockResolvedValueOnce({ terminalId: 'terminal-1', locationId: 'location-1', currentKeyVersion: 2, revoked: false })
    expect(await checkTerminalReadiness('location-1', auth as never)).toMatchObject({ reason: 'KEY_VERSION_MISMATCH' })
  })
  it('distinguishes missing, expired, revoked, and mismatched authority', async () => {
    state.meta = undefined
    expect(await checkTerminalReadiness('location-1', auth as never)).toMatchObject({ reason: 'AUTHORITY_MISSING' })
    state.meta = meta as State['meta']
    state.authorities[0]!.snapshot = { ...authority, expiresAt: new Date(Date.now() - 1_000).toISOString() }
    expect(await checkTerminalReadiness('location-1', auth as never)).toMatchObject({ reason: 'AUTHORITY_EXPIRED' })
    state.authorities[0]!.snapshot = authority
    mocks.inspectAuthority.mockReturnValueOnce({ snapshot: authority, revoked: true, permits: [] })
    expect(await checkTerminalReadiness('location-1', auth as never)).toMatchObject({ reason: 'AUTHORITY_REVOKED', serverVerified: false })
    mocks.inspectAuthority.mockReturnValueOnce({ snapshot: { ...authority, userId: 'foreign' }, revoked: false, permits: [] })
    expect(await checkTerminalReadiness('location-1', auth as never)).toMatchObject({ status: 'NOT_READY', reason: 'AUTHORITY_MISMATCH', serverVerified: false })
  })
  it('rejects unavailable or server-consumed permits', async () => {
    state.permits[0]!.localState = 'CONSUMED_LOCAL'
    expect(await checkTerminalReadiness('location-1', auth as never)).toMatchObject({ reason: 'PERMIT_UNAVAILABLE', serverVerified: true })
    state.permits[0]!.localState = 'AVAILABLE'
    mocks.inspectAuthority.mockReturnValueOnce({ snapshot: authority, revoked: false, permits: [{ permitId: 'permit-1', sequence: 0, status: 'CONSUMED_ACCEPTED' }] })
    expect(await checkTerminalReadiness('location-1', auth as never)).toMatchObject({ reason: 'PERMIT_UNAVAILABLE', serverVerified: true })
  })
  it('rejects a different server permit identity and a changed local profile', async () => {
    mocks.inspectAuthority.mockReturnValueOnce({ snapshot: authority, revoked: false, permits: [{ permitId: 'foreign', sequence: 0, status: 'AVAILABLE' }] })
    expect(await checkTerminalReadiness('location-1', auth as never)).toMatchObject({ status: 'NOT_READY', reason: 'AUTHORITY_MISMATCH', serverVerified: false })
    mocks.identity.mockResolvedValueOnce({ terminal: terminalIdentity }).mockResolvedValueOnce({ terminal: { ...terminalIdentity, terminalId: 'replacement' } })
    expect(await checkTerminalReadiness('location-1', auth as never)).toMatchObject({ reason: 'INTEGRITY_ERROR' })
  })
  it('fails closed on integrity failure without a partial READY', async () => {
    mocks.checked.mockImplementationOnce(() => { throw new Error('OFFLINE_STATE_LOST') })
    expect(await checkTerminalReadiness('location-1', auth as never)).toMatchObject({ reason: 'INTEGRITY_ERROR', serverVerified: false })
  })
})
