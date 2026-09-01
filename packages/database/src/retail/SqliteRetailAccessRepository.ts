import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { RetailLocation, RetailLocationStatus, RetailLocationType } from '@madina/retail'
import type { AuditEvent, CommandContext } from '@madina/shared'
import { appendAuditEvent } from '../audit/SqliteAuditRepository.js'
import { openDatabaseConnection } from '../connectionPolicy.js'

interface Row { id: string; code: string; name: string; type: RetailLocationType; status: RetailLocationStatus; created_at: string; updated_at: string }
const toLocation = (row: Row): RetailLocation => ({ id: row.id, code: row.code, name: row.name, type: row.type, status: row.status, createdAt: new Date(row.created_at), updatedAt: new Date(row.updated_at) })

export class SqliteRetailAccessRepository {
  private readonly database: DatabaseSync
  constructor(filename: string) { this.database = openDatabaseConnection(filename) }
  async listLocations(): Promise<RetailLocation[]> { return (this.database.prepare('SELECT id, code, name, type, status, created_at, updated_at FROM retail_locations ORDER BY code').all() as unknown as Row[]).map(toLocation) }
  async findLocation(id: string): Promise<RetailLocation | undefined> { const row = this.database.prepare('SELECT id, code, name, type, status, created_at, updated_at FROM retail_locations WHERE id = ?').get(id) as Row | undefined; return row ? toLocation(row) : undefined }
  async hasActiveGrant(userId: string, locationId: string): Promise<boolean> { return Boolean(this.database.prepare('SELECT 1 FROM retail_user_location_grants WHERE user_id = ? AND location_id = ? AND revoked_at IS NULL').get(userId, locationId)) }
  async listPermittedLocations(userId: string): Promise<RetailLocation[]> { return (this.database.prepare(`SELECT l.id, l.code, l.name, l.type, l.status, l.created_at, l.updated_at FROM retail_locations l JOIN retail_user_location_grants g ON g.location_id = l.id WHERE g.user_id = ? AND g.revoked_at IS NULL AND l.status = 'active' ORDER BY l.code`).all(userId) as unknown as Row[]).map(toLocation) }
  async createLocation(input: Omit<RetailLocation, 'id' | 'createdAt' | 'updatedAt'>, context: CommandContext): Promise<RetailLocation> { const now = new Date(); const location: RetailLocation = { ...input, id: randomUUID(), createdAt: now, updatedAt: now }; await this.transaction(async () => { this.database.prepare('INSERT INTO retail_locations (id, code, name, type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(location.id, location.code, location.name, location.type, location.status, now.toISOString(), now.toISOString()); this.audit(context, location.id, 'retail.location_created') }); return location }
  async grant(userId: string, locationId: string, context: CommandContext): Promise<void> { await this.transaction(async () => { this.database.prepare(`INSERT INTO retail_user_location_grants (user_id, location_id, granted_at, revoked_at) VALUES (?, ?, ?, NULL) ON CONFLICT(user_id, location_id) DO UPDATE SET granted_at = excluded.granted_at, revoked_at = NULL`).run(userId, locationId, new Date().toISOString()); this.audit(context, locationId, 'retail.location_granted', { userId }) }) }
  async revoke(userId: string, locationId: string, context: CommandContext): Promise<void> { await this.transaction(async () => { const result = this.database.prepare('UPDATE retail_user_location_grants SET revoked_at = ? WHERE user_id = ? AND location_id = ? AND revoked_at IS NULL').run(new Date().toISOString(), userId, locationId); if (result.changes !== 1) throw new Error('Active Retail Location grant not found.'); this.audit(context, locationId, 'retail.location_revoked', { userId }) }) }
  private audit(context: CommandContext, locationId: string, action: AuditEvent['action'], metadata?: AuditEvent['metadata']): void {
    appendAuditEvent(this.database, {
      id: randomUUID(),
      occurredAt: new Date(),
      actorType: context.actorType,
      actorUserId: context.actorUserId,
      requestId: context.requestId,
      domain: 'retail',
      entityType: 'retail_location',
      entityId: locationId,
      action,
      metadata,
    })
  }
  private async transaction<T>(operation: () => Promise<T>): Promise<T> { this.database.exec('BEGIN IMMEDIATE'); try { const value = await operation(); this.database.exec('COMMIT'); return value } catch (error) { this.database.exec('ROLLBACK'); throw error } }
  close(): void { this.database.close() }
}
