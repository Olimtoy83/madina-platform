import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { hasRetailCapability, validateRetailOfflineEnvelope } from '@madina/retail'
import type { CommandContext } from '@madina/shared'
import { appendAuditEvent } from '../audit/SqliteAuditRepository.js'
import { openDatabaseConnection } from '../connectionPolicy.js'
import { validateRetailOfflineTerminalPublicKey, verifyRetailOfflineEnvelope, type VerifiedRetailOfflineEnvelope } from './retailOfflineEnvelopeCrypto.js'

export interface EnrollRetailOfflineTerminalInput { locationId: string; keyAlgorithm: string; publicKey: string }
export interface IssueRetailOfflineAuthorityInput { terminalId: string; userId: string; locationId: string; expiresAt: Date; permitCount: number; productIds: readonly string[]; authorityVersion?: number; paymentMethod?: string; discountsAllowed?: boolean }
export interface PersistRetailOfflineSaleEvidenceInput { offlineOperationId: string; authorityId: string; authorityVersion: number; permitId: string; terminalId: string; terminalKeyVersion: number; userId: string; locationId: string; proposedSaleId: string; claimedCompletedAt: Date; canonicalPayload: string; payloadHash: string; signature: string }
export interface RetailOfflineTerminal { id: string; locationId: string; currentKeyVersion: number; enrolledByUserId: string; enrolledAt: Date; updatedAt: Date; revoked: boolean }
export interface RetailOfflineAuthority { id: string; authorityVersion: number; terminalId: string; terminalKeyVersion: number; userId: string; locationId: string; issuedAt: Date; expiresAt: Date; currencyCode: string; currencyExponent: number; permitCount: number; revoked: boolean }
export interface RetailOfflineTerminalKey { terminalId: string; keyVersion: number; keyAlgorithm: string; publicKey: string; createdAt: Date; createdByUserId: string }

const required = (value: string, field: string): string => { if (typeof value !== 'string' || !value.trim()) throw new Error(`Retail Offline ${field} is required.`); return value }
const positive = (value: number, field: string): number => { if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Retail Offline ${field} is invalid.`); return value }
const validDate = (value: Date, field: string): Date => { if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error(`Retail Offline ${field} is invalid.`); return value }

export class SqliteRetailOfflineAuthorityRepository {
  private readonly database: DatabaseSync
  constructor(filename: string) { this.database = openDatabaseConnection(filename) }

  async enrollTerminal(input: EnrollRetailOfflineTerminalInput, context: CommandContext): Promise<RetailOfflineTerminal> { return this.tx(async () => {
    const location = this.location(input.locationId)
    if (location.status !== 'active' || location.type !== 'store') throw new Error('Retail Offline Terminal requires an active Store Location.')
    const now = new Date(); const id = randomUUID(); const actor = this.authorizedActorForLocation(context, input.locationId)
    required(input.keyAlgorithm, 'Terminal key algorithm'); required(input.publicKey, 'Terminal public key'); validateRetailOfflineTerminalPublicKey(input.keyAlgorithm,input.publicKey)
    this.database.prepare('INSERT INTO retail_offline_terminals(id,location_id,current_key_version,enrolled_by_user_id,enrolled_at,updated_at) VALUES(?,?,1,?,?,?)').run(id,input.locationId,actor,now.toISOString(),now.toISOString())
    this.database.prepare('INSERT INTO retail_offline_terminal_keys(terminal_id,key_version,key_algorithm,public_key,created_at,created_by_user_id) VALUES(?,1,?,?,?,?)').run(id,input.keyAlgorithm,input.publicKey,now.toISOString(),actor)
    this.audit(context,'retail_offline_terminal',id,'retail.offline_terminal_enrolled',{ locationId: input.locationId, keyVersion: 1 })
    return { id, locationId: input.locationId, currentKeyVersion: 1, enrolledByUserId: actor, enrolledAt: now, updatedAt: now, revoked: false }
  }) }

  async rotateTerminalKey(terminalId: string, keyAlgorithm: string, publicKey: string, context: CommandContext): Promise<RetailOfflineTerminal> { return this.tx(async () => {
    const terminal = this.requiredTerminal(terminalId); if (terminal.revoked) throw new Error('Retail Offline Terminal is revoked.')
    required(keyAlgorithm,'Terminal key algorithm'); required(publicKey,'Terminal public key'); validateRetailOfflineTerminalPublicKey(keyAlgorithm,publicKey)
    const version = terminal.currentKeyVersion + 1; const now = new Date(); const actor = this.authorizedActorForLocation(context, terminal.locationId)
    this.database.prepare('INSERT INTO retail_offline_terminal_keys(terminal_id,key_version,key_algorithm,public_key,created_at,created_by_user_id) VALUES(?,?,?,?,?,?)').run(terminalId,version,keyAlgorithm,publicKey,now.toISOString(),actor)
    this.database.prepare('UPDATE retail_offline_terminals SET current_key_version=?,updated_at=? WHERE id=?').run(version,now.toISOString(),terminalId)
    this.audit(context,'retail_offline_terminal',terminalId,'retail.offline_terminal_key_rotated',{ keyVersion: version })
    return { ...terminal, currentKeyVersion: version, updatedAt: now }
  }) }

  async revokeTerminal(terminalId: string, reason: string, context: CommandContext): Promise<void> { await this.tx(async () => {
    const terminal=this.requiredTerminal(terminalId); required(reason,'Terminal revocation reason'); const now = new Date(); const actor = this.authorizedActorForLocation(context, terminal.locationId)
    this.database.prepare('INSERT INTO retail_offline_terminal_revocations(terminal_id,revoked_at,revoked_by_user_id,reason) VALUES(?,?,?,?)').run(terminalId,now.toISOString(),actor,reason)
    this.audit(context,'retail_offline_terminal',terminalId,'retail.offline_terminal_revoked',{ reason })
  }) }

  async issueAuthority(input: IssueRetailOfflineAuthorityInput, context: CommandContext): Promise<RetailOfflineAuthority> { return this.tx(async () => {
    const terminal = this.requiredTerminal(input.terminalId); if (terminal.revoked) throw new Error('Retail Offline Terminal is revoked.')
    if (terminal.locationId !== input.locationId) throw new Error('Retail Offline Authority Location mismatch.')
    const location = this.location(input.locationId); if (location.status !== 'active' || location.type !== 'store' || !location.currency_code || location.currency_exponent === null) throw new Error('Retail Offline Authority requires an active Store Location with currency.')
    if (!this.database.prepare("SELECT 1 FROM users WHERE id=? AND status='active'").get(required(input.userId,'Authority userId'))) throw new Error('Retail Offline Authority user is invalid.')
    const expiresAt = validDate(input.expiresAt,'Authority expiresAt'); const issuedAt = new Date(); if (expiresAt <= issuedAt) throw new Error('Retail Offline Authority expiresAt must be after issuedAt.')
    if (input.paymentMethod !== undefined && input.paymentMethod !== 'cash') throw new Error('Retail Offline Authority permits cash payment only.')
    if (input.discountsAllowed !== undefined && input.discountsAllowed !== false) throw new Error('Retail Offline Authority discounts are not permitted.')
    const permitCount = positive(input.permitCount,'Authority permit count'); if (!Array.isArray(input.productIds) || !input.productIds.length || new Set(input.productIds).size !== input.productIds.length) throw new Error('Retail Offline Authority Product evidence is invalid.')
    const prices = input.productIds.map((productId) => { required(productId,'Authority Product id'); const product=this.database.prepare("SELECT status FROM retail_products WHERE id=?").get(productId) as {status:string}|undefined; const price=this.database.prepare('SELECT unit_price_minor FROM retail_product_prices WHERE product_id=? AND location_id=?').get(productId,input.locationId) as {unit_price_minor:number}|undefined; if (!product || product.status!=='active' || !price) throw new Error('Retail Offline Authority Product price evidence is invalid.'); return { productId, unitPriceMinor: price.unit_price_minor } })
    const id=randomUUID(); const version=input.authorityVersion ?? 1; positive(version,'Authority version'); const actor=this.authorizedActorForLocation(context, input.locationId)
    this.database.prepare("INSERT INTO retail_offline_authorities(id,authority_version,terminal_id,terminal_key_version,user_id,location_id,issued_at,expires_at,currency_code,currency_exponent,payment_method,discounts_allowed,permit_count,issued_by_user_id) VALUES(?,?,?,?,?,?,?,?,?,?, 'cash',0,?,?)").run(id,version,input.terminalId,terminal.currentKeyVersion,input.userId,input.locationId,issuedAt.toISOString(),expiresAt.toISOString(),location.currency_code,location.currency_exponent,permitCount,actor)
    for (const price of prices) this.database.prepare('INSERT INTO retail_offline_authority_product_prices(authority_id,product_id,unit_price_minor) VALUES(?,?,?)').run(id,price.productId,price.unitPriceMinor)
    for (let sequence=0;sequence<permitCount;sequence++) this.database.prepare('INSERT INTO retail_offline_authority_permits(id,authority_id,sequence) VALUES(?,?,?)').run(randomUUID(),id,sequence)
    this.audit(context,'retail_offline_authority',id,'retail.offline_authority_issued',{ terminalId: input.terminalId, locationId: input.locationId, permitCount })
    return { id,authorityVersion:version,terminalId:input.terminalId,terminalKeyVersion:terminal.currentKeyVersion,userId:input.userId,locationId:input.locationId,issuedAt,expiresAt,currencyCode:location.currency_code,currencyExponent:location.currency_exponent,permitCount,revoked:false }
  }) }

  async revokeAuthority(authorityId: string, reason: string, context: CommandContext): Promise<void> { await this.tx(async () => {
    const authority=this.findAuthoritySync(authorityId); if (!authority) throw new Error('Retail Offline Authority not found.')
    required(reason,'Authority revocation reason'); const now=new Date(); const actor=this.authorizedActorForLocation(context, authority.locationId)
    this.database.prepare('INSERT INTO retail_offline_authority_revocations(authority_id,revoked_at,revoked_by_user_id,reason) VALUES(?,?,?,?)').run(authorityId,now.toISOString(),actor,reason)
    this.audit(context,'retail_offline_authority',authorityId,'retail.offline_authority_revoked',{ reason })
  }) }

  async persistEvidence(input: PersistRetailOfflineSaleEvidenceInput): Promise<{ replayed: boolean }> { return this.tx(async () => {
    const existing=this.database.prepare('SELECT canonical_payload,payload_hash,signature FROM retail_offline_sale_evidence WHERE offline_operation_id=?').get(required(input.offlineOperationId,'Evidence operation id')) as {canonical_payload:string;payload_hash:string;signature:string}|undefined
    if (existing) { if (existing.canonical_payload!==input.canonicalPayload || existing.payload_hash!==input.payloadHash || existing.signature!==input.signature) throw new Error('IDEMPOTENCY_CONFLICT'); return { replayed:true } }
    const authority=this.database.prepare(`SELECT authority_version,terminal_id,terminal_key_version,user_id,location_id FROM retail_offline_authorities WHERE id=?`).get(required(input.authorityId,'Evidence authority id')) as {authority_version:number;terminal_id:string;terminal_key_version:number;user_id:string;location_id:string}|undefined
    if (!authority || authority.authority_version!==positive(input.authorityVersion,'Evidence authority version') || authority.terminal_id!==input.terminalId || authority.terminal_key_version!==positive(input.terminalKeyVersion,'Evidence terminal key version') || authority.user_id!==input.userId || authority.location_id!==input.locationId) throw new Error('Retail Offline Evidence authority binding is invalid.')
    if (!this.database.prepare('SELECT 1 FROM retail_offline_authority_permits WHERE id=? AND authority_id=?').get(required(input.permitId,'Evidence permit id'),input.authorityId)) throw new Error('Retail Offline Evidence permit is invalid.')
    required(input.proposedSaleId,'Evidence proposed Sale id'); validDate(input.claimedCompletedAt,'Evidence claimed completion timestamp'); required(input.canonicalPayload,'Evidence canonical payload'); required(input.payloadHash,'Evidence payload hash'); required(input.signature,'Evidence signature')
    const priorPermit=this.database.prepare('SELECT offline_operation_id FROM retail_offline_sale_evidence WHERE authority_id=? AND permit_id=?').get(input.authorityId,input.permitId) as {offline_operation_id:string}|undefined
    if (priorPermit) throw new Error('Retail Offline Evidence permit is already linked.')
    this.database.prepare('INSERT INTO retail_offline_sale_evidence(offline_operation_id,authority_id,authority_version,permit_id,terminal_id,terminal_key_version,user_id,location_id,proposed_sale_id,claimed_completed_at,canonical_payload,payload_hash,signature,received_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(input.offlineOperationId,input.authorityId,input.authorityVersion,input.permitId,input.terminalId,input.terminalKeyVersion,input.userId,input.locationId,input.proposedSaleId,input.claimedCompletedAt.toISOString(),input.canonicalPayload,input.payloadHash,input.signature,new Date().toISOString())
    return { replayed:false }
  }) }

  async findTerminal(id:string):Promise<RetailOfflineTerminal|undefined>{ const row=this.database.prepare(`SELECT t.id,t.location_id,t.current_key_version,t.enrolled_by_user_id,t.enrolled_at,t.updated_at,r.terminal_id AS revoked FROM retail_offline_terminals t LEFT JOIN retail_offline_terminal_revocations r ON r.terminal_id=t.id WHERE t.id=?`).get(id) as {id:string;location_id:string;current_key_version:number;enrolled_by_user_id:string;enrolled_at:string;updated_at:string;revoked:string|null}|undefined; return row&&{id:row.id,locationId:row.location_id,currentKeyVersion:row.current_key_version,enrolledByUserId:row.enrolled_by_user_id,enrolledAt:new Date(row.enrolled_at),updatedAt:new Date(row.updated_at),revoked:Boolean(row.revoked)} }
  async findAuthority(id:string):Promise<RetailOfflineAuthority|undefined>{return this.findAuthoritySync(id)}
  async findTerminalKey(terminalId:string,keyVersion:number):Promise<RetailOfflineTerminalKey|undefined>{const row=this.database.prepare('SELECT terminal_id,key_version,key_algorithm,public_key,created_at,created_by_user_id FROM retail_offline_terminal_keys WHERE terminal_id=? AND key_version=?').get(terminalId,positive(keyVersion,'Terminal key version')) as {terminal_id:string;key_version:number;key_algorithm:string;public_key:string;created_at:string;created_by_user_id:string}|undefined;return row&&{terminalId:row.terminal_id,keyVersion:row.key_version,keyAlgorithm:row.key_algorithm,publicKey:row.public_key,createdAt:new Date(row.created_at),createdByUserId:row.created_by_user_id}}
  async verifyEnvelopeSignature(input:{envelope:unknown;payloadHash:string;signature:string}):Promise<VerifiedRetailOfflineEnvelope>{const envelope=validateRetailOfflineEnvelope(input.envelope);const terminal=this.requiredTerminal(envelope.terminalId);const key=await this.findTerminalKey(terminal.id,envelope.terminalKeyVersion);if(!key)throw new Error('Retail Offline Envelope terminal key version is invalid.');return verifyRetailOfflineEnvelope({envelope,payloadHash:input.payloadHash,signature:input.signature,keyAlgorithm:key.keyAlgorithm,publicKey:key.publicKey})}
  async listPermits(authorityId:string):Promise<{id:string;sequence:number}[]>{return this.database.prepare('SELECT id,sequence FROM retail_offline_authority_permits WHERE authority_id=? ORDER BY sequence').all(authorityId) as {id:string;sequence:number}[]}
  private requiredTerminal(id:string):RetailOfflineTerminal{ const terminal=this.findTerminalSync(id); if(!terminal)throw new Error('Retail Offline Terminal not found.'); return terminal }
  private findTerminalSync(id:string):RetailOfflineTerminal|undefined{const row=this.database.prepare(`SELECT t.id,t.location_id,t.current_key_version,t.enrolled_by_user_id,t.enrolled_at,t.updated_at,r.terminal_id AS revoked FROM retail_offline_terminals t LEFT JOIN retail_offline_terminal_revocations r ON r.terminal_id=t.id WHERE t.id=?`).get(id) as {id:string;location_id:string;current_key_version:number;enrolled_by_user_id:string;enrolled_at:string;updated_at:string;revoked:string|null}|undefined;return row&&{id:row.id,locationId:row.location_id,currentKeyVersion:row.current_key_version,enrolledByUserId:row.enrolled_by_user_id,enrolledAt:new Date(row.enrolled_at),updatedAt:new Date(row.updated_at),revoked:Boolean(row.revoked)}}
  private findAuthoritySync(id:string):RetailOfflineAuthority|undefined{const row=this.database.prepare(`SELECT a.id,a.authority_version,a.terminal_id,a.terminal_key_version,a.user_id,a.location_id,a.issued_at,a.expires_at,a.currency_code,a.currency_exponent,a.permit_count,r.authority_id AS revoked FROM retail_offline_authorities a LEFT JOIN retail_offline_authority_revocations r ON r.authority_id=a.id WHERE a.id=?`).get(id) as {id:string;authority_version:number;terminal_id:string;terminal_key_version:number;user_id:string;location_id:string;issued_at:string;expires_at:string;currency_code:string;currency_exponent:number;permit_count:number;revoked:string|null}|undefined;return row&&{id:row.id,authorityVersion:row.authority_version,terminalId:row.terminal_id,terminalKeyVersion:row.terminal_key_version,userId:row.user_id,locationId:row.location_id,issuedAt:new Date(row.issued_at),expiresAt:new Date(row.expires_at),currencyCode:row.currency_code,currencyExponent:row.currency_exponent,permitCount:row.permit_count,revoked:Boolean(row.revoked)}}
  private location(id:string){const row=this.database.prepare('SELECT type,status,currency_code,currency_exponent FROM retail_locations WHERE id=?').get(required(id,'Location id')) as {type:string;status:string;currency_code:string|null;currency_exponent:number|null}|undefined;if(!row)throw new Error('Retail Location not found.');return row}
  private actor(context:CommandContext):string{if(context.actorType!=='user'||!context.actorUserId)throw new Error('Retail Offline command requires an authorized user.');return context.actorUserId}
  private authorizedActorForLocation(context:CommandContext,locationId:string):string{const actor=this.actor(context);const user=this.database.prepare("SELECT role,status FROM users WHERE id=?").get(actor) as {role:'admin'|'manager'|'operator'|'viewer';status:string}|undefined;if(!user||user.status!=='active'||!hasRetailCapability(user.role,'retail:offline-terminals:manage'))throw new Error('Retail Offline Terminal management access is required.');if(user.role!=='admin'&&!this.database.prepare('SELECT 1 FROM retail_user_location_grants WHERE user_id=? AND location_id=? AND revoked_at IS NULL').get(actor,locationId))throw new Error('Active Retail Location access is required.');return actor}
  private audit(context:CommandContext,entityType:string,entityId:string,action:'retail.offline_terminal_enrolled'|'retail.offline_terminal_key_rotated'|'retail.offline_terminal_revoked'|'retail.offline_authority_issued'|'retail.offline_authority_revoked',metadata:Record<string,string|number>):void{appendAuditEvent(this.database,{id:randomUUID(),occurredAt:new Date(),actorType:context.actorType,actorUserId:context.actorUserId,requestId:context.requestId,domain:'retail',entityType,entityId,action,metadata})}
  private async tx<T>(operation:()=>Promise<T>):Promise<T>{this.database.exec('BEGIN IMMEDIATE');try{const value=await operation();this.database.exec('COMMIT');return value}catch(error){this.database.exec('ROLLBACK');throw error}}
  close():void{this.database.close()}
}
