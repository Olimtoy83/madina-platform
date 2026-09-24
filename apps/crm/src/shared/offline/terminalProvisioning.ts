import { RETAIL_OFFLINE_SIGNATURE_ALGORITHM } from '@madina/retail'
import { HttpError, requestJson } from '../api/httpClient'
import { TerminalIdentityError, enrollTerminalIdentity, generateTerminalIdentity, loadPendingTerminalOperation, loadTerminalIdentity, prepareTerminalEnrollment, prepareTerminalRotation, promoteTerminalRotation, type TerminalIdentity } from './terminalIdentity'

type TerminalBase = { locationId: string; currentKeyVersion: number; revoked: boolean }
type TerminalCommand = TerminalBase & { id: string }
type TerminalRead = TerminalBase & { terminalId: string }
export type TerminalProvisioningState = 'UNINITIALIZED' | 'KEY_GENERATED' | 'ENROLLED' | 'ROTATION_PENDING' | 'REVOKED' | 'SERVER_MISMATCH' | 'IDENTITY_LOST' | 'UNAVAILABLE'
export class TerminalProvisioningError extends Error {}
const root = '/api/v1/retail/locations'
const id = () => crypto.randomUUID()
const terminalUrl = (locationId: string, terminalId: string) => `${root}/${encodeURIComponent(locationId)}/offline-terminals/${encodeURIComponent(terminalId)}`

function terminal(value: unknown, locationId: string, identifier: 'id'): TerminalCommand
function terminal(value: unknown, locationId: string, identifier: 'terminalId'): TerminalRead
function terminal(value: unknown, locationId: string, identifier: 'id' | 'terminalId'): TerminalCommand | TerminalRead {
  const result = (value as { terminal?: Record<string, unknown> })?.terminal
  if (!result || typeof result[identifier] !== 'string' || !result[identifier].trim() || result.locationId !== locationId || typeof result.currentKeyVersion !== 'number' || !Number.isSafeInteger(result.currentKeyVersion) || result.currentKeyVersion <= 0 || typeof result.revoked !== 'boolean') throw new TerminalProvisioningError('Retail Offline Terminal response is invalid.')
  return result as TerminalCommand | TerminalRead
}
function active(value: TerminalIdentity, locationId: string): void {
  if (value.state !== 'ENROLLED' || value.locationId !== locationId || !value.terminalId || !value.currentKeyVersion) throw new TerminalProvisioningError('Retail Offline Terminal Location binding is invalid.')
}
export async function getTerminalProvisioningState(): Promise<TerminalProvisioningState> {
  try {
    const value = await loadTerminalIdentity()
    if (!value) return 'UNINITIALIZED'
    const pending = await loadPendingTerminalOperation()
    return pending?.kind === 'rotation' ? 'ROTATION_PENDING' : value.state
  } catch (error) { if (error instanceof TerminalIdentityError) return 'IDENTITY_LOST'; throw error }
}
export async function beginTerminalEnrollment(locationId: string): Promise<TerminalIdentity> {
  let value = await loadTerminalIdentity()
  if (!value) {
    try { value = await generateTerminalIdentity() }
    catch (error) {
      if (!(error instanceof TerminalIdentityError)) throw error
      value = await loadTerminalIdentity()
      if (!value) throw error
    }
  }
  if (value.state === 'ENROLLED') throw new TerminalProvisioningError('Retail Offline Terminal identity is already enrolled.')
  const pending = await prepareTerminalEnrollment(id(), locationId)
  const response = await requestJson<{ terminal: TerminalCommand }>(`${root}/${encodeURIComponent(locationId)}/offline-terminals`, { method: 'POST', body: { commandId: pending.commandId, keyAlgorithm: RETAIL_OFFLINE_SIGNATURE_ALGORITHM, publicKey: pending.publicKey } })
  const result = terminal(response, locationId, 'id')
  if (result.revoked || result.currentKeyVersion !== 1) throw new TerminalProvisioningError('Retail Offline Terminal enrollment response is invalid.')
  return enrollTerminalIdentity({ terminalId: result.id, locationId, currentKeyVersion: result.currentKeyVersion, commandId: pending.commandId })
}
export async function reconcileTerminal(locationId: string): Promise<TerminalProvisioningState> {
  let value: TerminalIdentity | undefined
  try { value = await loadTerminalIdentity() } catch (error) { if (error instanceof TerminalIdentityError) return 'IDENTITY_LOST'; throw error }
  if (!value) return 'IDENTITY_LOST'
  if (value.state !== 'ENROLLED') return 'KEY_GENERATED'
  active(value, locationId)
  let pending: Awaited<ReturnType<typeof loadPendingTerminalOperation>>
  try { pending = await loadPendingTerminalOperation() } catch (error) { if (error instanceof TerminalIdentityError) return 'IDENTITY_LOST'; throw error }
  try {
    const result = terminal(await requestJson<{ terminal: TerminalRead }>(terminalUrl(locationId, value.terminalId!)), locationId, 'terminalId')
    if (result.terminalId !== value.terminalId) return 'SERVER_MISMATCH'
    if (result.revoked) return 'REVOKED'
    if (pending?.kind === 'rotation') return result.currentKeyVersion === value.currentKeyVersion || result.currentKeyVersion === value.currentKeyVersion! + 1 ? 'ROTATION_PENDING' : 'SERVER_MISMATCH'
    return result.currentKeyVersion === value.currentKeyVersion ? 'ENROLLED' : 'SERVER_MISMATCH'
  } catch (error) {
    if (error instanceof HttpError) return error.status === 404 ? 'SERVER_MISMATCH' : 'UNAVAILABLE'
    return error instanceof TerminalProvisioningError ? 'SERVER_MISMATCH' : 'UNAVAILABLE'
  }
}
export async function beginTerminalKeyRotation(locationId: string): Promise<TerminalIdentity> {
  const value = await loadTerminalIdentity()
  if (!value) throw new TerminalProvisioningError('Retail Offline Terminal identity is missing.')
  active(value, locationId)
  // Validate any persisted pending material before making even the detail request.
  const prior = await loadPendingTerminalOperation()
  if (prior && (prior.kind !== 'rotation' || prior.locationId !== locationId)) throw new TerminalProvisioningError('Retail Offline Terminal provisioning is already pending.')
  const detail = terminal(await requestJson<{ terminal: TerminalRead }>(terminalUrl(locationId, value.terminalId!)), locationId, 'terminalId')
  if (detail.terminalId !== value.terminalId || detail.revoked || (detail.currentKeyVersion !== value.currentKeyVersion && !(prior?.kind === 'rotation' && detail.currentKeyVersion === value.currentKeyVersion! + 1))) throw new TerminalProvisioningError('Retail Offline Terminal cannot rotate in its current server state.')
  // Detail alone does not prove which public key was accepted. Recovery always replays the receipt.
  const pending = await prepareTerminalRotation(id())
  if (pending.locationId !== locationId || pending.kind !== 'rotation') throw new TerminalProvisioningError('Retail Offline Terminal pending rotation is invalid.')
  const response = await requestJson<{ terminal: TerminalCommand }>(`${terminalUrl(locationId, value.terminalId!)}/keys/rotate`, { method: 'POST', body: { commandId: pending.commandId, keyAlgorithm: RETAIL_OFFLINE_SIGNATURE_ALGORITHM, publicKey: pending.publicKey } })
  const result = terminal(response, locationId, 'id')
  if (result.revoked || result.id !== value.terminalId) throw new TerminalProvisioningError('Retail Offline Terminal rotation response is invalid.')
  return promoteTerminalRotation({ terminalId: result.id, locationId, currentKeyVersion: result.currentKeyVersion, commandId: pending.commandId })
}
