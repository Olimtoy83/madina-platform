import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { RetailTransfer, RetailTransferLine } from '@madina/retail'
import type { AuditEvent, CommandContext } from '@madina/shared'
import { appendAuditEvent } from '../audit/SqliteAuditRepository.js'
import { openDatabaseConnection } from '../connectionPolicy.js'
import { recordRetailInventoryMovement } from './SqliteRetailInventoryRepository.js'
import { isRetailProductLocationConflictBlocked } from './SqliteRetailOfflineStockConflictLifecycleRepository.js'

export class RetailTransferValidationError extends Error { constructor(message = 'Retail Transfer input is invalid.') { super(message); this.name = 'RetailTransferValidationError' } }
export class RetailTransferProductUnavailableError extends Error { constructor() { super('Retail Transfer Product is inactive.'); this.name = 'RetailTransferProductUnavailableError' } }

type TransferRow = { id:string; source_location_id:string; destination_location_id:string; status:'draft'|'dispatched'|'received'; created_at:string; created_by:string; dispatched_at:string|null; received_at:string|null }
type LineRow = { id:string; transfer_id:string; product_id:string; product_name:string; product_source_id:string; quantity:number }
type TransferLineInput = { productId:string; quantity:number }

const toTransfer = (row:TransferRow):RetailTransfer => ({ id:row.id,sourceLocationId:row.source_location_id,destinationLocationId:row.destination_location_id,status:row.status,createdAt:new Date(row.created_at),createdBy:row.created_by,dispatchedAt:row.dispatched_at ? new Date(row.dispatched_at) : undefined,receivedAt:row.received_at ? new Date(row.received_at) : undefined })
const toLine = (row:LineRow):RetailTransferLine => ({ id:row.id,transferId:row.transfer_id,productId:row.product_id,productName:row.product_name,productSourceId:row.product_source_id,quantity:row.quantity })

export class SqliteRetailTransferRepository {
  private readonly database:DatabaseSync
  constructor(filename:string) { this.database=openDatabaseConnection(filename) }

  async create(input:{sourceLocationId:unknown;destinationLocationId:unknown;lines:unknown},context:CommandContext):Promise<RetailTransfer> {
    return this.transaction(async () => {
      const sourceLocationId=this.locationId(input.sourceLocationId), destinationLocationId=this.locationId(input.destinationLocationId), lines=this.validLines(input.lines)
      this.activeLocations(sourceLocationId,destinationLocationId)
      this.activeProducts(lines,'create')
      const item:RetailTransfer={id:randomUUID(),sourceLocationId,destinationLocationId,status:'draft',createdAt:new Date(),createdBy:context.actorUserId??'system'}
      this.database.prepare('INSERT INTO retail_transfers VALUES (?,?,?,?,?,?,NULL,NULL)').run(item.id,item.sourceLocationId,item.destinationLocationId,item.status,item.createdAt.toISOString(),item.createdBy)
      for(const current of lines)this.database.prepare('INSERT INTO retail_transfer_lines VALUES (?,?,?,?)').run(randomUUID(),item.id,current.productId,current.quantity)
      this.audit(context,item.id,'retail.transfer_created')
      return item
    })
  }

  async find(id:string):Promise<RetailTransfer|undefined> { const row=this.database.prepare('SELECT * FROM retail_transfers WHERE id=?').get(id) as TransferRow|undefined; return row&&toTransfer(row) }
  async listPage(locationId:string,accessibleLocationIds:readonly string[],input:{cursor?:{createdAt:string;id:string};limit:number}) {
    if(!accessibleLocationIds.length)return {items:[] as RetailTransfer[],nextCursor:undefined}
    const placeholders=accessibleLocationIds.map(()=>'?').join(','), values:Array<string|number>=[locationId,locationId,...accessibleLocationIds,...accessibleLocationIds]
    let predicate=`(source_location_id=? OR destination_location_id=?) AND source_location_id IN (${placeholders}) AND destination_location_id IN (${placeholders})`
    if(input.cursor){predicate+=' AND (created_at < ? OR (created_at = ? AND id < ?))';values.push(input.cursor.createdAt,input.cursor.createdAt,input.cursor.id)}
    const rows=this.database.prepare(`SELECT * FROM retail_transfers WHERE ${predicate} ORDER BY created_at DESC,id DESC LIMIT ?`).all(...values,input.limit) as unknown as TransferRow[]
    const items=rows.map(toTransfer),last=items.at(-1)
    return {items,nextCursor:rows.length===input.limit&&last?{createdAt:last.createdAt.toISOString(),id:last.id}:undefined}
  }
  async lines(id:string):Promise<RetailTransferLine[]> { return (this.database.prepare('SELECT line.id,line.transfer_id,line.product_id,product.name AS product_name,product.source_id AS product_source_id,line.quantity FROM retail_transfer_lines line JOIN retail_products product ON product.id=line.product_id WHERE line.transfer_id=? ORDER BY line.id').all(id) as unknown as LineRow[]).map(toLine) }
  async dispatch(id:string,context:CommandContext):Promise<RetailTransfer> { return this.move(id,'draft','dispatched','sourceLocationId',-1,'retail.transfer_dispatched',context) }
  async receive(id:string,context:CommandContext):Promise<RetailTransfer> { return this.move(id,'dispatched','received','destinationLocationId',1,'retail.transfer_received',context) }

  private async move(id:string,from:'draft'|'dispatched',to:'dispatched'|'received',side:'sourceLocationId'|'destinationLocationId',sign:number,action:AuditEvent['action'],context:CommandContext):Promise<RetailTransfer> {
    return this.transaction(async () => {
      const item=await this.find(id)
      if(!item)throw Error('Retail Transfer not found.')
      if(item.status===to)return item
      if(item.status!==from)throw Error('Retail Transfer lifecycle transition is invalid.')
      this.activeLocations(item.sourceLocationId,item.destinationLocationId)
      const lines=await this.lines(id)
      if(to==='dispatched')this.activeProducts(lines,'dispatch')
      if(to==='dispatched')for(const current of lines)if(isRetailProductLocationConflictBlocked(this.database,current.productId,item.sourceLocationId))throw Error('RETAIL_PRODUCT_LOCATION_CONFLICT_BLOCKED')
      for(const current of lines)recordRetailInventoryMovement(this.database,{productId:current.productId,locationId:item[side],quantityDelta:sign*current.quantity,type:'transfer',sourceType:`retail_transfer_${to}`,sourceId:item.id,sourceLineId:current.id},context)
      const at=new Date()
      this.database.prepare(`UPDATE retail_transfers SET status=?,${to}_at=? WHERE id=?`).run(to,at.toISOString(),id)
      this.audit(context,id,action)
      return {...item,status:to,...(to==='dispatched'?{dispatchedAt:at}:{receivedAt:at})} as RetailTransfer
    })
  }

  private locationId(value:unknown):string { if(typeof value!=='string'||!value.trim())throw new RetailTransferValidationError(); return value }
  private activeLocations(sourceLocationId:string,destinationLocationId:string):void { if(sourceLocationId===destinationLocationId)throw new RetailTransferValidationError('Retail Transfer Locations must be distinct.');for(const id of[sourceLocationId,destinationLocationId]){const row=this.database.prepare('SELECT status FROM retail_locations WHERE id=?').get(id) as {status:string}|undefined;if(!row||row.status!=='active')throw new RetailTransferValidationError('Retail Transfer requires active Locations.')} }
  private validLines(value:unknown):TransferLineInput[] { if(!Array.isArray(value)||!value.length)throw new RetailTransferValidationError('Retail Transfer requires lines.');const seen=new Set<string>(),lines:TransferLineInput[]=[];for(const current of value){if(!current||typeof current!=='object'||Array.isArray(current))throw new RetailTransferValidationError();const {productId,quantity}=current as {productId?:unknown;quantity?:unknown};if(typeof productId!=='string'||!productId.trim()||typeof quantity!=='number'||!Number.isSafeInteger(quantity)||quantity<=0||seen.has(productId))throw new RetailTransferValidationError('Retail Transfer lines are invalid.');seen.add(productId);lines.push({productId,quantity})}return lines }
  private activeProducts(lines:ReadonlyArray<{productId:string}>,phase:'create'|'dispatch'):void { for(const current of lines){const row=this.database.prepare('SELECT status FROM retail_products WHERE id=?').get(current.productId) as {status:string}|undefined;if(!row)throw new RetailTransferValidationError('Retail Transfer Product is invalid.');if(row.status!=='active'){if(phase==='create')throw new RetailTransferValidationError('Retail Transfer Product is inactive.');throw new RetailTransferProductUnavailableError()}} }
  private audit(context:CommandContext,id:string,action:AuditEvent['action']):void { appendAuditEvent(this.database,{id:randomUUID(),occurredAt:new Date(),actorType:context.actorType,actorUserId:context.actorUserId,requestId:context.requestId,domain:'retail',entityType:'retail_transfer',entityId:id,action}) }
  private async transaction<T>(operation:()=>Promise<T>):Promise<T> { this.database.exec('BEGIN IMMEDIATE');try{const value=await operation();this.database.exec('COMMIT');return value}catch(error){this.database.exec('ROLLBACK');throw error} }
  close():void { this.database.close() }
}
