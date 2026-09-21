import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { validateRetailOfflineEnvelope } from '@madina/retail'
import type { CommandContext } from '@madina/shared'
import { appendAuditEvent } from '../audit/SqliteAuditRepository.js'
import { openDatabaseConnection } from '../connectionPolicy.js'
import { recordVerifiedOfflineStockConflictMaterializationMovement } from './SqliteRetailInventoryRepository.js'
import { verifyRetailOfflineEnvelope } from './retailOfflineEnvelopeCrypto.js'

export interface RetailOfflineStockConflictMaterializationInput { offlineOperationId: string; commandId: string }
export interface RetailOfflineStockConflictMaterializationResult { sale: unknown; items: unknown[]; allocations: unknown[]; incidents: unknown[]; replayed: boolean }

type Verification = { offline_operation_id:string; authority_id:string; authority_version:number; permit_id:string; terminal_id:string; terminal_key_version:number; user_id:string; location_id:string; currency_code:string; currency_exponent:number; proposed_sale_id:string; cash_allocation_id:string; claimed_completed_at:string; canonical_payload:string; payload_hash:string; signature:string }
type Line = { sale_item_id:string; product_id:string; quantity:number; authorized_unit_price_minor:number; observed_on_hand_quantity:number; initial_deficit_quantity:number }

const required = (value:string, field:string):string => { if(typeof value!=='string'||!value.trim()) throw new Error(`Retail Offline Stock Conflict ${field} is required.`); return value }

export class SqliteRetailOfflineStockConflictMaterializationRepository {
  private readonly database: DatabaseSync
  constructor(filename:string) { this.database=openDatabaseConnection(filename) }

  async materialize(locationId:string,input:RetailOfflineStockConflictMaterializationInput,context:CommandContext):Promise<RetailOfflineStockConflictMaterializationResult> {
    return this.tx(async()=>{
      required(locationId,'locationId'); required(input.offlineOperationId,'offlineOperationId'); required(input.commandId,'commandId')
      if(context.actorType!=='user'||!context.actorUserId) throw new Error('Retail Offline Stock Conflict materialization requires an authorized user.')
      const hash=createHash('sha256').update(JSON.stringify({locationId,offlineOperationId:input.offlineOperationId,commandId:input.commandId})).digest('hex')
      const prior=this.database.prepare('SELECT payload_hash,sale_id FROM retail_offline_stock_conflict_materialization_receipts WHERE command_id=?').get(input.commandId) as {payload_hash:string;sale_id:string}|undefined
      if(prior){ if(prior.payload_hash!==hash) throw new Error('IDEMPOTENCY_CONFLICT'); return {...this.load(prior.sale_id),replayed:true} }
      const verification=this.database.prepare('SELECT * FROM retail_offline_stock_conflict_verifications WHERE offline_operation_id=?').get(input.offlineOperationId) as Verification|undefined
      if(!verification) throw new Error('Retail Offline Stock Conflict verification is required.')
      if(verification.location_id!==locationId) throw new Error('Retail Offline Stock Conflict Location mismatch.')
      const already=this.database.prepare('SELECT sale_id FROM retail_offline_stock_conflict_materialization_receipts WHERE offline_operation_id=?').get(input.offlineOperationId) as {sale_id:string}|undefined
      if(already) return {...this.load(already.sale_id),replayed:true}
      const location=this.database.prepare("SELECT status,type,currency_code,currency_exponent FROM retail_locations WHERE id=?").get(locationId) as {status:string;type:string;currency_code:string|null;currency_exponent:number|null}|undefined
      if(!location||location.status!=='active'||location.type!=='store'||location.currency_code!==verification.currency_code||location.currency_exponent!==verification.currency_exponent) throw new Error('Retail Offline Stock Conflict requires an active Store Location.')
      const envelope=validateRetailOfflineEnvelope(JSON.parse(verification.canonical_payload))
      if(envelope.offlineOperationId!==verification.offline_operation_id||envelope.authorityId!==verification.authority_id||envelope.authorityVersion!==verification.authority_version||envelope.permitId!==verification.permit_id||envelope.terminalId!==verification.terminal_id||envelope.terminalKeyVersion!==verification.terminal_key_version||envelope.userId!==verification.user_id||envelope.locationId!==verification.location_id||envelope.proposedSaleId!==verification.proposed_sale_id||envelope.cashAllocation.id!==verification.cash_allocation_id) throw new Error('Retail Offline Stock Conflict verification integrity is invalid.')
      const terminal=this.database.prepare('SELECT key_algorithm,public_key FROM retail_offline_terminal_keys WHERE terminal_id=? AND key_version=?').get(verification.terminal_id,verification.terminal_key_version) as {key_algorithm:string;public_key:string}|undefined
      if(!terminal) throw new Error('Retail Offline Stock Conflict terminal evidence is invalid.')
      const cryptographic=verifyRetailOfflineEnvelope({envelope,payloadHash:verification.payload_hash,signature:verification.signature,keyAlgorithm:terminal.key_algorithm,publicKey:terminal.public_key})
      if(cryptographic.canonicalPayload!==verification.canonical_payload||cryptographic.payloadHash!==verification.payload_hash) throw new Error('Retail Offline Stock Conflict verification integrity is invalid.')
      const authority=this.database.prepare('SELECT authority_version,terminal_id,terminal_key_version,user_id,location_id,currency_code,currency_exponent FROM retail_offline_authorities WHERE id=?').get(verification.authority_id) as {authority_version:number;terminal_id:string;terminal_key_version:number;user_id:string;location_id:string;currency_code:string;currency_exponent:number}|undefined
      if(!authority||authority.authority_version!==verification.authority_version||authority.terminal_id!==verification.terminal_id||authority.terminal_key_version!==verification.terminal_key_version||authority.user_id!==verification.user_id||authority.location_id!==locationId||authority.currency_code!==verification.currency_code||authority.currency_exponent!==verification.currency_exponent) throw new Error('Retail Offline Stock Conflict authority evidence is invalid.')
      if(!this.database.prepare('SELECT 1 FROM retail_offline_authority_permits WHERE id=? AND authority_id=? AND sequence=?').get(verification.permit_id,verification.authority_id,envelope.permitSequence)) throw new Error('Retail Offline Stock Conflict permit evidence is invalid.')
      const lines=this.database.prepare('SELECT sale_item_id,product_id,quantity,authorized_unit_price_minor,observed_on_hand_quantity,initial_deficit_quantity FROM retail_offline_stock_conflict_verification_lines WHERE offline_operation_id=? ORDER BY sale_item_id').all(input.offlineOperationId) as unknown as Line[]
      if(!lines.length||lines.length!==envelope.lines.length) throw new Error('Retail Offline Stock Conflict line evidence is invalid.')
      for(const line of lines){ const signed=envelope.lines.find(item=>item.id===line.sale_item_id); const price=this.database.prepare('SELECT unit_price_minor FROM retail_offline_authority_product_prices WHERE authority_id=? AND product_id=?').get(verification.authority_id,line.product_id) as {unit_price_minor:number}|undefined; if(!signed||signed.productId!==line.product_id||signed.quantity!==line.quantity||signed.unitPriceMinor!==line.authorized_unit_price_minor||!price||price.unit_price_minor!==line.authorized_unit_price_minor) throw new Error('Retail Offline Stock Conflict Product evidence is invalid.') }
      const collision=this.database.prepare('SELECT 1 FROM retail_sales WHERE id=? UNION ALL SELECT 1 FROM retail_sale_items WHERE id IN ('+lines.map(()=>'?').join(',')+') UNION ALL SELECT 1 FROM retail_payment_allocations WHERE id=?').get(verification.proposed_sale_id,...lines.map(line=>line.sale_item_id),verification.cash_allocation_id)
      if(collision) throw new Error('Retail Offline Stock Conflict identity is already linked.')
      const now=new Date(), timestamp=now.toISOString()
      this.database.prepare('INSERT INTO retail_offline_sale_evidence(offline_operation_id,authority_id,authority_version,permit_id,terminal_id,terminal_key_version,user_id,location_id,proposed_sale_id,claimed_completed_at,canonical_payload,payload_hash,signature,received_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(verification.offline_operation_id,verification.authority_id,verification.authority_version,verification.permit_id,verification.terminal_id,verification.terminal_key_version,verification.user_id,locationId,verification.proposed_sale_id,verification.claimed_completed_at,verification.canonical_payload,verification.payload_hash,verification.signature,timestamp)
      this.database.prepare("INSERT INTO retail_sales(id,location_id,status,currency_code,currency_exponent,subtotal_minor,payable_total_minor,created_at,completed_at) VALUES(?,?,'completed',?,?,?,?,?,?)").run(verification.proposed_sale_id,locationId,verification.currency_code,verification.currency_exponent,envelope.subtotalMinor,envelope.payableTotalMinor,timestamp,timestamp)
      for(const line of lines) this.database.prepare('INSERT INTO retail_sale_items(id,sale_id,product_id,quantity,unit_price_minor,line_total_minor) VALUES(?,?,?,?,?,?)').run(line.sale_item_id,verification.proposed_sale_id,line.product_id,line.quantity,line.authorized_unit_price_minor,line.quantity*line.authorized_unit_price_minor)
      this.database.prepare("INSERT INTO retail_payment_allocations(id,sale_id,method,amount_minor,ordinal) VALUES(?,?,'cash',?,0)").run(verification.cash_allocation_id,verification.proposed_sale_id,envelope.payableTotalMinor)
      this.database.prepare('INSERT INTO retail_offline_stock_conflict_materialization_receipts(command_id,offline_operation_id,payload_hash,sale_id,materialized_at,materialized_by) VALUES(?,?,?,?,?,?)').run(input.commandId,input.offlineOperationId,hash,verification.proposed_sale_id,timestamp,context.actorUserId)
      for(const line of lines){
        const current=this.database.prepare('SELECT on_hand_quantity FROM retail_inventory_balances WHERE product_id=? AND location_id=?').get(line.product_id,locationId) as {on_hand_quantity:number}|undefined
        const resulting=(current?.on_hand_quantity??0)-line.quantity
        const movement=recordVerifiedOfflineStockConflictMaterializationMovement(this.database,{productId:line.product_id,locationId,quantityDelta:-line.quantity,type:'sale',sourceType:'retail_offline_stock_conflict_materialization',sourceId:input.offlineOperationId,sourceLineId:line.sale_item_id},context)
        if(line.initial_deficit_quantity>0||resulting<0) this.database.prepare("INSERT INTO retail_offline_stock_conflict_incidents(offline_operation_id,sale_item_id,location_id,product_id,sale_id,movement_id,authority_id,permit_id,terminal_id,terminal_key_version,observed_on_hand_quantity,sold_quantity,resulting_on_hand_quantity,initial_deficit_quantity,materialization_deficit_quantity,status,policy_version,opened_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'open',1,?)").run(input.offlineOperationId,line.sale_item_id,locationId,line.product_id,verification.proposed_sale_id,movement.id,verification.authority_id,verification.permit_id,verification.terminal_id,verification.terminal_key_version,line.observed_on_hand_quantity,line.quantity,resulting,line.initial_deficit_quantity,Math.max(0,-resulting),timestamp)
      }
      appendAuditEvent(this.database,{id:randomUUID(),occurredAt:now,actorType:context.actorType,actorUserId:context.actorUserId,requestId:context.requestId,domain:'retail',entityType:'retail_offline_stock_conflict',entityId:input.offlineOperationId,action:'retail.offline_stock_conflict_materialized',metadata:{locationId,saleId:verification.proposed_sale_id,commandId:input.commandId}})
      return {...this.load(verification.proposed_sale_id),replayed:false}
    })
  }
  private load(saleId:string):Omit<RetailOfflineStockConflictMaterializationResult,'replayed'>{ return {sale:this.database.prepare('SELECT * FROM retail_sales WHERE id=?').get(saleId),items:this.database.prepare('SELECT * FROM retail_sale_items WHERE sale_id=? ORDER BY id').all(saleId) as unknown[],allocations:this.database.prepare('SELECT * FROM retail_payment_allocations WHERE sale_id=? ORDER BY ordinal,id').all(saleId) as unknown[],incidents:this.database.prepare('SELECT * FROM retail_offline_stock_conflict_incidents WHERE sale_id=? ORDER BY sale_item_id').all(saleId) as unknown[]} }
  private async tx<T>(run:()=>Promise<T>):Promise<T>{this.database.exec('BEGIN IMMEDIATE');try{const value=await run();this.database.exec('COMMIT');return value}catch(error){this.database.exec('ROLLBACK');throw error}}
  close():void{this.database.close()}
}
