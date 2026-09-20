import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { validateRetailOfflineEnvelope } from '@madina/retail'
import type { CommandContext } from '@madina/shared'
import { appendAuditEvent } from '../audit/SqliteAuditRepository.js'
import { openDatabaseConnection } from '../connectionPolicy.js'
import { recordRetailInventoryMovement } from './SqliteRetailInventoryRepository.js'
import { verifyRetailOfflineEnvelope } from './retailOfflineEnvelopeCrypto.js'

export interface RetailOfflineSaleSyncInput { envelope: unknown; payloadHash: string; signature: string }
export interface RetailOfflineSaleSyncResult { sale: unknown; items: unknown[]; allocations: unknown[]; replayed: boolean }
type SyncOutcome = RetailOfflineSaleSyncResult | { conflict: true }

export class SqliteRetailOfflineSaleSyncRepository {
  private readonly database: DatabaseSync
  constructor(filename: string) { this.database = openDatabaseConnection(filename) }

  async sync(locationId: string, input: RetailOfflineSaleSyncInput, context: CommandContext): Promise<RetailOfflineSaleSyncResult> {
    const outcome = await this.tx<SyncOutcome>(async () => {
      const envelope = validateRetailOfflineEnvelope(input.envelope)
      if (envelope.locationId !== locationId) throw new Error('Retail Offline Sale Location mismatch.')
      const existing = this.database.prepare(`SELECT evidence.canonical_payload,evidence.payload_hash,evidence.signature,receipt.sale_id FROM retail_offline_sale_evidence evidence LEFT JOIN retail_offline_sale_sync_receipts receipt ON receipt.offline_operation_id=evidence.offline_operation_id WHERE evidence.offline_operation_id=?`).get(envelope.offlineOperationId) as { canonical_payload: string; payload_hash: string; signature: string; sale_id: string | null } | undefined
      const existingConflict = this.database.prepare('SELECT canonical_payload,payload_hash,signature FROM retail_offline_stock_conflict_verifications WHERE offline_operation_id=?').get(envelope.offlineOperationId) as { canonical_payload:string;payload_hash:string;signature:string } | undefined
      const terminal = this.database.prepare(`SELECT terminal.id,terminal.location_id,revocation.terminal_id AS revoked,key.key_algorithm,key.public_key FROM retail_offline_terminals terminal JOIN retail_offline_terminal_keys key ON key.terminal_id=terminal.id AND key.key_version=? LEFT JOIN retail_offline_terminal_revocations revocation ON revocation.terminal_id=terminal.id WHERE terminal.id=?`).get(envelope.terminalKeyVersion,envelope.terminalId) as { id:string;location_id:string;revoked:string|null;key_algorithm:string;public_key:string } | undefined
      if (!terminal || terminal.location_id !== locationId) throw new Error('Retail Offline Sale terminal binding is invalid.')
      const verified = verifyRetailOfflineEnvelope({ envelope, payloadHash: input.payloadHash, signature: input.signature, keyAlgorithm: terminal.key_algorithm, publicKey: terminal.public_key })
      if (existing) {
        if (existing.canonical_payload !== verified.canonicalPayload || existing.payload_hash !== verified.payloadHash || existing.signature !== input.signature) throw new Error('IDEMPOTENCY_CONFLICT')
        if (!existing.sale_id) throw new Error('RETAIL_OFFLINE_REVIEW_REQUIRED')
        return { ...this.load(existing.sale_id), replayed: true }
      }
      if (existingConflict) {
        if (existingConflict.canonical_payload !== verified.canonicalPayload || existingConflict.payload_hash !== verified.payloadHash || existingConflict.signature !== input.signature) throw new Error('IDEMPOTENCY_CONFLICT')
        return { conflict: true }
      }
      if (terminal.revoked) throw new Error('RETAIL_OFFLINE_REVIEW_REQUIRED')
      const authority = this.database.prepare(`SELECT authority_version,terminal_id,terminal_key_version,user_id,location_id,expires_at,currency_code,currency_exponent,revocation.authority_id AS revoked FROM retail_offline_authorities authority LEFT JOIN retail_offline_authority_revocations revocation ON revocation.authority_id=authority.id WHERE authority.id=?`).get(envelope.authorityId) as { authority_version:number;terminal_id:string;terminal_key_version:number;user_id:string;location_id:string;expires_at:string;currency_code:string;currency_exponent:number;revoked:string|null } | undefined
      if (!authority || authority.authority_version !== envelope.authorityVersion || authority.terminal_id !== envelope.terminalId || authority.terminal_key_version !== envelope.terminalKeyVersion || authority.user_id !== envelope.userId || authority.location_id !== locationId || authority.currency_code !== envelope.currencyCode || authority.currency_exponent !== envelope.currencyExponent) throw new Error('Retail Offline Sale authority binding is invalid.')
      const location = this.database.prepare("SELECT type,status,currency_code,currency_exponent FROM retail_locations WHERE id=?").get(locationId) as {type:string;status:string;currency_code:string|null;currency_exponent:number|null}|undefined
      const user = this.database.prepare("SELECT status FROM users WHERE id=?").get(envelope.userId) as {status:string}|undefined
      if (authority.revoked || new Date(authority.expires_at) <= new Date() || !user || user.status !== 'active' || !location || location.type !== 'store' || location.status !== 'active' || location.currency_code !== envelope.currencyCode || location.currency_exponent !== envelope.currencyExponent) throw new Error('RETAIL_OFFLINE_REVIEW_REQUIRED')
      const permit = this.database.prepare('SELECT 1 FROM retail_offline_authority_permits WHERE id=? AND authority_id=? AND sequence=?').get(envelope.permitId,envelope.authorityId,envelope.permitSequence)
      if (!permit) throw new Error('Retail Offline Sale permit is invalid.')
      const usedPermit = this.database.prepare(`SELECT offline_operation_id FROM retail_offline_sale_evidence WHERE authority_id=? AND permit_id=? UNION ALL SELECT offline_operation_id FROM retail_offline_stock_conflict_verifications WHERE authority_id=? AND permit_id=?`).get(envelope.authorityId,envelope.permitId,envelope.authorityId,envelope.permitId) as {offline_operation_id:string}|undefined
      if (usedPermit) throw new Error('Retail Offline Sale permit is already linked.')
      const reservedIdentity = this.database.prepare(`SELECT 1 FROM retail_sales WHERE id=? UNION ALL SELECT 1 FROM retail_offline_stock_conflict_verifications WHERE proposed_sale_id=? UNION ALL SELECT 1 FROM retail_sale_items WHERE id=? UNION ALL SELECT 1 FROM retail_offline_stock_conflict_verification_lines WHERE sale_item_id=? UNION ALL SELECT 1 FROM retail_payment_allocations WHERE id=? UNION ALL SELECT 1 FROM retail_offline_stock_conflict_verifications WHERE cash_allocation_id=?`).get(envelope.proposedSaleId,envelope.proposedSaleId,envelope.lines[0]?.id,envelope.lines[0]?.id,envelope.cashAllocation.id,envelope.cashAllocation.id)
      if (reservedIdentity) throw new Error('Retail Offline Sale identity is already linked.')
      for (const line of envelope.lines.slice(1)) {
        const duplicate = this.database.prepare('SELECT 1 FROM retail_sale_items WHERE id=? UNION ALL SELECT 1 FROM retail_offline_stock_conflict_verification_lines WHERE sale_item_id=?').get(line.id,line.id)
        if (duplicate) throw new Error('Retail Offline Sale identity is already linked.')
      }
      const verifiedLines: Array<{ id:string; productId:string; quantity:number; unitPriceMinor:number; observed:number; deficit:number }> = []
      for (const line of envelope.lines) {
        const price = this.database.prepare('SELECT unit_price_minor FROM retail_offline_authority_product_prices WHERE authority_id=? AND product_id=?').get(envelope.authorityId,line.productId) as {unit_price_minor:number}|undefined
        if (!price || price.unit_price_minor !== line.unitPriceMinor) throw new Error('Retail Offline Sale Product price evidence is invalid.')
        const balance = this.database.prepare('SELECT on_hand_quantity FROM retail_inventory_balances WHERE product_id=? AND location_id=?').get(line.productId,locationId) as {on_hand_quantity:number}|undefined
        const observed = balance?.on_hand_quantity ?? 0
        verifiedLines.push({ id:line.id, productId:line.productId, quantity:line.quantity, unitPriceMinor:line.unitPriceMinor, observed, deficit:Math.max(0,line.quantity-observed) })
      }
      if (verifiedLines.some(line => line.deficit > 0)) {
        const now = new Date().toISOString()
        this.database.prepare('INSERT INTO retail_offline_stock_conflict_verifications(offline_operation_id,authority_id,authority_version,permit_id,terminal_id,terminal_key_version,user_id,location_id,currency_code,currency_exponent,proposed_sale_id,cash_allocation_id,claimed_completed_at,canonical_payload,payload_hash,signature,first_received_at,verified_at,verification_schema_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)').run(envelope.offlineOperationId,envelope.authorityId,envelope.authorityVersion,envelope.permitId,envelope.terminalId,envelope.terminalKeyVersion,envelope.userId,locationId,envelope.currencyCode,envelope.currencyExponent,envelope.proposedSaleId,envelope.cashAllocation.id,envelope.claimedOfflineCompletedAt,verified.canonicalPayload,verified.payloadHash,input.signature,now,now)
        for (const line of verifiedLines) this.database.prepare('INSERT INTO retail_offline_stock_conflict_verification_lines(offline_operation_id,sale_item_id,product_id,quantity,authorized_unit_price_minor,observed_on_hand_quantity,initial_deficit_quantity) VALUES(?,?,?,?,?,?,?)').run(envelope.offlineOperationId,line.id,line.productId,line.quantity,line.unitPriceMinor,line.observed,line.deficit)
        return { conflict: true }
      }
      const now = new Date()
      this.database.prepare('INSERT INTO retail_offline_sale_evidence(offline_operation_id,authority_id,authority_version,permit_id,terminal_id,terminal_key_version,user_id,location_id,proposed_sale_id,claimed_completed_at,canonical_payload,payload_hash,signature,received_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(envelope.offlineOperationId,envelope.authorityId,envelope.authorityVersion,envelope.permitId,envelope.terminalId,envelope.terminalKeyVersion,envelope.userId,locationId,envelope.proposedSaleId,envelope.claimedOfflineCompletedAt,verified.canonicalPayload,verified.payloadHash,input.signature,now.toISOString())
      this.database.prepare("INSERT INTO retail_sales(id,location_id,status,currency_code,currency_exponent,subtotal_minor,payable_total_minor,created_at,completed_at) VALUES(?,?,'completed',?,?,?,?,?,?)").run(envelope.proposedSaleId,locationId,envelope.currencyCode,envelope.currencyExponent,envelope.subtotalMinor,envelope.payableTotalMinor,now.toISOString(),now.toISOString())
      for (const line of envelope.lines) {
        const total=line.quantity*line.unitPriceMinor
        this.database.prepare('INSERT INTO retail_sale_items(id,sale_id,product_id,quantity,unit_price_minor,line_total_minor) VALUES(?,?,?,?,?,?)').run(line.id,envelope.proposedSaleId,line.productId,line.quantity,line.unitPriceMinor,total)
        recordRetailInventoryMovement(this.database,{productId:line.productId,locationId,quantityDelta:-line.quantity,type:'sale',sourceType:'retail_offline_sale_sync',sourceId:envelope.offlineOperationId,sourceLineId:line.id},context)
      }
      this.database.prepare('INSERT INTO retail_payment_allocations(id,sale_id,method,amount_minor,ordinal) VALUES(?,?,\'cash\',?,0)').run(envelope.cashAllocation.id,envelope.proposedSaleId,envelope.payableTotalMinor)
      this.database.prepare('INSERT INTO retail_offline_sale_sync_receipts(offline_operation_id,payload_hash,sale_id,accepted_at) VALUES(?,?,?,?)').run(envelope.offlineOperationId,verified.payloadHash,envelope.proposedSaleId,now.toISOString())
      appendAuditEvent(this.database,{id:randomUUID(),occurredAt:now,actorType:context.actorType,actorUserId:context.actorUserId,requestId:context.requestId,domain:'retail',entityType:'retail_sale',entityId:envelope.proposedSaleId,action:'retail.offline_sale_synced',metadata:{locationId,offlineOperationId:envelope.offlineOperationId,authorityId:envelope.authorityId}})
      return { ...this.load(envelope.proposedSaleId), replayed: false }
    })
    if ('conflict' in outcome) throw new Error('VERIFIED_OFFLINE_STOCK_CONFLICT')
    return outcome
  }

  private load(id:string): Omit<RetailOfflineSaleSyncResult,'replayed'> { return { sale:this.database.prepare('SELECT * FROM retail_sales WHERE id=?').get(id), items:this.database.prepare('SELECT * FROM retail_sale_items WHERE sale_id=? ORDER BY id').all(id) as unknown[], allocations:this.database.prepare('SELECT * FROM retail_payment_allocations WHERE sale_id=? ORDER BY ordinal,id').all(id) as unknown[] } }
  private async tx<T>(operation:()=>Promise<T>):Promise<T>{this.database.exec('BEGIN IMMEDIATE');try{const result=await operation();this.database.exec('COMMIT');return result}catch(error){this.database.exec('ROLLBACK');throw error}}
  close():void{this.database.close()}
}
