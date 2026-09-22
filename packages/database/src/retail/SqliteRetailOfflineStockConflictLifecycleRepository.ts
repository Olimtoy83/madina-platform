import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { openDatabaseConnection } from '../connectionPolicy.js'

export type OfflineStockConflictLifecycleState = 'open'|'under_review'|'resolved'
export interface ReviewOfflineStockConflictInput { offlineOperationId:string; saleItemId:string; commandId:string; expectedCurrentState:OfflineStockConflictLifecycleState; targetState:OfflineStockConflictLifecycleState; actorUserId:string }
export interface ResolveOfflineStockConflictInput { offlineOperationId:string; saleItemId:string; commandId:string; expectedCurrentState:'under_review'; disposition:string; reason:string; evidence:string; correctiveRecord:{type:string;id:string}; actorUserId:string }
export interface ReopenOfflineStockConflictInput { offlineOperationId:string; saleItemId:string; commandId:string; expectedCurrentState:'resolved'; reason:string; actorUserId:string }
export interface RetailOfflineStockConflictListItem {
  offlineOperationId:string
  saleItemId:string
  productId:string
  saleId:string
  currentState:OfflineStockConflictLifecycleState
  version:number
  openedAt:string
  updatedAt:string
  updatedBy:string
  observedOnHandQuantity:number
  soldQuantity:number
  resultingOnHandQuantity:number
  initialDeficitQuantity:number
  materializationDeficitQuantity:number
}

export interface RetailOfflineStockConflictEvent {
  eventId:string
  eventType:'review_started'|'resolved'|'reopened'
  previousState:OfflineStockConflictLifecycleState
  resultingState:OfflineStockConflictLifecycleState
  commandId:string
  actorUserId:string
  occurredAt:string
}

export interface RetailOfflineStockConflictResolutionEvidence {
  eventId:string
  disposition:string
  reason:string
  evidence:string
  correctiveRecordType:string
  correctiveRecordId:string
}

export interface RetailOfflineStockConflictDetail {
  incident:RetailOfflineStockConflictListItem
  events:RetailOfflineStockConflictEvent[]
  resolutionEvidence:RetailOfflineStockConflictResolutionEvidence[]
}
export function isRetailProductLocationConflictBlocked(database:DatabaseSync,productId:string,locationId:string):boolean{return Boolean(database.prepare("SELECT 1 FROM retail_offline_stock_conflict_incident_lifecycle WHERE product_id=? AND location_id=? AND current_state IN ('open','under_review')").get(productId,locationId))}

export class SqliteRetailOfflineStockConflictLifecycleRepository {
  private readonly database:DatabaseSync
  constructor(file:string){this.database=openDatabaseConnection(file)}
  async review(locationId:string,input:ReviewOfflineStockConflictInput){return this.tx(async()=>{const hash=this.hash({locationId,...input}),prior=this.prior(input.commandId);if(prior){if(prior.payload_hash!==hash)throw Error('IDEMPOTENCY_CONFLICT');return this.state(prior.offline_operation_id,prior.sale_item_id)}if(input.expectedCurrentState!=='open'||input.targetState!=='under_review')throw Error('INVALID_INCIDENT_TRANSITION');const row=this.current(locationId,input.offlineOperationId,input.saleItemId);if(row.current_state!==input.expectedCurrentState)throw Error('STALE_INCIDENT_STATE');const now=new Date().toISOString();this.database.prepare("INSERT INTO retail_offline_stock_conflict_incident_events(event_id,offline_operation_id,sale_item_id,event_type,previous_state,resulting_state,command_id,payload_hash,actor_user_id,occurred_at) VALUES(lower(hex(randomblob(16))),?,?, 'review_started','open','under_review',?,?,?,?)").run(input.offlineOperationId,input.saleItemId,input.commandId,hash,input.actorUserId,now);this.database.prepare("UPDATE retail_offline_stock_conflict_incident_lifecycle SET current_state='under_review',version=?,updated_at=?,updated_by=? WHERE offline_operation_id=? AND sale_item_id=?").run(row.version+1,now,input.actorUserId,input.offlineOperationId,input.saleItemId);return this.state(input.offlineOperationId,input.saleItemId)})}
  async resolve(locationId:string,input:ResolveOfflineStockConflictInput){return this.tx(async()=>{const hash=this.hash({locationId,...input}),prior=this.prior(input.commandId);if(prior){if(prior.payload_hash!==hash)throw Error('IDEMPOTENCY_CONFLICT');return this.state(prior.offline_operation_id,prior.sale_item_id)}for(const [value,label]of[[input.disposition,'Resolution disposition'],[input.reason,'Resolution reason'],[input.evidence,'Resolution evidence'],[input.correctiveRecord?.type,'Corrective record type'],[input.correctiveRecord?.id,'Corrective record id']]as const)if(!value?.trim())throw Error(`${label} is required.`);const row=this.current(locationId,input.offlineOperationId,input.saleItemId);if(row.current_state!==input.expectedCurrentState)throw Error('STALE_INCIDENT_STATE');const now=new Date().toISOString(),eventId=randomUUID();this.database.prepare("INSERT INTO retail_offline_stock_conflict_incident_events(event_id,offline_operation_id,sale_item_id,event_type,previous_state,resulting_state,command_id,payload_hash,actor_user_id,occurred_at) VALUES(?,?,?, 'resolved','under_review','resolved',?,?,?,?)").run(eventId,input.offlineOperationId,input.saleItemId,input.commandId,hash,input.actorUserId,now);this.database.prepare('INSERT INTO retail_offline_stock_conflict_resolution_evidence(event_id,disposition,reason,evidence,corrective_record_type,corrective_record_id) VALUES(?,?,?,?,?,?)').run(eventId,input.disposition,input.reason,input.evidence,input.correctiveRecord.type,input.correctiveRecord.id);this.database.prepare("UPDATE retail_offline_stock_conflict_incident_lifecycle SET current_state='resolved',version=?,updated_at=?,updated_by=? WHERE offline_operation_id=? AND sale_item_id=?").run(row.version+1,now,input.actorUserId,input.offlineOperationId,input.saleItemId);return this.state(input.offlineOperationId,input.saleItemId)})}
  async reopen(locationId:string,input:ReopenOfflineStockConflictInput){return this.tx(async()=>{const hash=this.hash({locationId,...input}),prior=this.prior(input.commandId);if(prior){if(prior.payload_hash!==hash)throw Error('IDEMPOTENCY_CONFLICT');return this.state(prior.offline_operation_id,prior.sale_item_id)}if(!input.reason?.trim())throw Error('Reopen reason is required.');const row=this.current(locationId,input.offlineOperationId,input.saleItemId);if(row.current_state!==input.expectedCurrentState)throw Error('STALE_INCIDENT_STATE');const now=new Date().toISOString(),eventId=randomUUID();this.database.prepare("INSERT INTO retail_offline_stock_conflict_incident_events(event_id,offline_operation_id,sale_item_id,event_type,previous_state,resulting_state,command_id,payload_hash,actor_user_id,occurred_at) VALUES(?,?,?, 'reopened','resolved','under_review',?,?,?,?)").run(eventId,input.offlineOperationId,input.saleItemId,input.commandId,hash,input.actorUserId,now);this.database.prepare("UPDATE retail_offline_stock_conflict_incident_lifecycle SET current_state='under_review',version=?,updated_at=?,updated_by=? WHERE offline_operation_id=? AND sale_item_id=?").run(row.version+1,now,input.actorUserId,input.offlineOperationId,input.saleItemId);return this.state(input.offlineOperationId,input.saleItemId)})}
  async list(locationId:string):Promise<RetailOfflineStockConflictListItem[]>{
    const rows=this.database.prepare(`
      SELECT
        i.offline_operation_id,
        i.sale_item_id,
        i.product_id,
        i.sale_id,
        l.current_state,
        l.version,
        i.opened_at,
        l.updated_at,
        l.updated_by,
        i.observed_on_hand_quantity,
        i.sold_quantity,
        i.resulting_on_hand_quantity,
        i.initial_deficit_quantity,
        i.materialization_deficit_quantity
      FROM retail_offline_stock_conflict_incidents i
      JOIN retail_offline_stock_conflict_incident_lifecycle l
        ON l.offline_operation_id=i.offline_operation_id
       AND l.sale_item_id=i.sale_item_id
      WHERE i.location_id=?
      ORDER BY i.opened_at DESC,i.offline_operation_id,i.sale_item_id
    `).all(locationId) as unknown as Array<{
      offline_operation_id:string
      sale_item_id:string
      product_id:string
      sale_id:string
      current_state:OfflineStockConflictLifecycleState
      version:number
      opened_at:string
      updated_at:string
      updated_by:string
      observed_on_hand_quantity:number
      sold_quantity:number
      resulting_on_hand_quantity:number
      initial_deficit_quantity:number
      materialization_deficit_quantity:number
    }>
    return rows.map(row=>({
      offlineOperationId:row.offline_operation_id,
      saleItemId:row.sale_item_id,
      productId:row.product_id,
      saleId:row.sale_id,
      currentState:row.current_state,
      version:row.version,
      openedAt:row.opened_at,
      updatedAt:row.updated_at,
      updatedBy:row.updated_by,
      observedOnHandQuantity:row.observed_on_hand_quantity,
      soldQuantity:row.sold_quantity,
      resultingOnHandQuantity:row.resulting_on_hand_quantity,
      initialDeficitQuantity:row.initial_deficit_quantity,
      materializationDeficitQuantity:row.materialization_deficit_quantity
    }))
  }

  async find(locationId:string,offlineOperationId:string,saleItemId:string):Promise<RetailOfflineStockConflictDetail|undefined>{
    const row=this.database.prepare(`
      SELECT
        i.offline_operation_id,i.sale_item_id,i.product_id,i.sale_id,
        l.current_state,l.version,i.opened_at,l.updated_at,l.updated_by,
        i.observed_on_hand_quantity,i.sold_quantity,i.resulting_on_hand_quantity,
        i.initial_deficit_quantity,i.materialization_deficit_quantity
      FROM retail_offline_stock_conflict_incidents i
      JOIN retail_offline_stock_conflict_incident_lifecycle l
        ON l.offline_operation_id=i.offline_operation_id
       AND l.sale_item_id=i.sale_item_id
      WHERE i.location_id=? AND i.offline_operation_id=? AND i.sale_item_id=?
    `).get(locationId,offlineOperationId,saleItemId) as unknown as {
      offline_operation_id:string; sale_item_id:string; product_id:string; sale_id:string
      current_state:OfflineStockConflictLifecycleState; version:number; opened_at:string; updated_at:string; updated_by:string
      observed_on_hand_quantity:number; sold_quantity:number; resulting_on_hand_quantity:number
      initial_deficit_quantity:number; materialization_deficit_quantity:number
    }|undefined
    if(!row)return undefined
    const incident:RetailOfflineStockConflictListItem={
      offlineOperationId:row.offline_operation_id,saleItemId:row.sale_item_id,productId:row.product_id,saleId:row.sale_id,
      currentState:row.current_state,version:row.version,openedAt:row.opened_at,updatedAt:row.updated_at,updatedBy:row.updated_by,
      observedOnHandQuantity:row.observed_on_hand_quantity,soldQuantity:row.sold_quantity,resultingOnHandQuantity:row.resulting_on_hand_quantity,
      initialDeficitQuantity:row.initial_deficit_quantity,materializationDeficitQuantity:row.materialization_deficit_quantity
    }

    const events=this.database.prepare(`
      SELECT event_id,event_type,previous_state,resulting_state,command_id,actor_user_id,occurred_at
      FROM retail_offline_stock_conflict_incident_events
      WHERE offline_operation_id=? AND sale_item_id=?
      ORDER BY occurred_at,event_id
    `).all(offlineOperationId,saleItemId) as unknown as Array<{
      event_id:string
      event_type:'review_started'|'resolved'|'reopened'
      previous_state:OfflineStockConflictLifecycleState
      resulting_state:OfflineStockConflictLifecycleState
      command_id:string
      actor_user_id:string
      occurred_at:string
    }>

    const resolutionEvidence=this.database.prepare(`
      SELECT
        e.event_id,
        r.disposition,
        r.reason,
        r.evidence,
        r.corrective_record_type,
        r.corrective_record_id
      FROM retail_offline_stock_conflict_incident_events e
      JOIN retail_offline_stock_conflict_resolution_evidence r
        ON r.event_id=e.event_id
      WHERE e.offline_operation_id=? AND e.sale_item_id=?
      ORDER BY e.occurred_at,e.event_id
    `).all(offlineOperationId,saleItemId) as unknown as Array<{
      event_id:string
      disposition:string
      reason:string
      evidence:string
      corrective_record_type:string
      corrective_record_id:string
    }>

    return {
      incident,
      events:events.map(event=>({
        eventId:event.event_id,
        eventType:event.event_type,
        previousState:event.previous_state,
        resultingState:event.resulting_state,
        commandId:event.command_id,
        actorUserId:event.actor_user_id,
        occurredAt:event.occurred_at
      })),
      resolutionEvidence:resolutionEvidence.map(item=>({
        eventId:item.event_id,
        disposition:item.disposition,
        reason:item.reason,
        evidence:item.evidence,
        correctiveRecordType:item.corrective_record_type,
        correctiveRecordId:item.corrective_record_id
      }))
    }
  }

  async getCurrentState(operation:string,item:string){return this.state(operation,item)}
  async listEvents(operation:string,item:string){return this.database.prepare('SELECT * FROM retail_offline_stock_conflict_incident_events WHERE offline_operation_id=? AND sale_item_id=? ORDER BY occurred_at,event_id').all(operation,item)}
  async isProductLocationBlocked(product:string,location:string){return isRetailProductLocationConflictBlocked(this.database,product,location)}
  private hash(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex')}
  private prior(commandId:string){return this.database.prepare('SELECT payload_hash,offline_operation_id,sale_item_id FROM retail_offline_stock_conflict_incident_events WHERE command_id=?').get(commandId)as{payload_hash:string;offline_operation_id:string;sale_item_id:string}|undefined}
  private current(locationId:string,operation:string,item:string){const row=this.database.prepare('SELECT current_state,version,location_id FROM retail_offline_stock_conflict_incident_lifecycle WHERE offline_operation_id=? AND sale_item_id=?').get(operation,item)as{current_state:OfflineStockConflictLifecycleState;version:number;location_id:string}|undefined;if(!row||row.location_id!==locationId)throw Error('Retail Offline Stock Conflict incident not found.');return row}
  private state(operation:string,item:string){return this.database.prepare('SELECT * FROM retail_offline_stock_conflict_incident_lifecycle WHERE offline_operation_id=? AND sale_item_id=?').get(operation,item)}
  private async tx<T>(f:()=>Promise<T>):Promise<T>{this.database.exec('BEGIN IMMEDIATE');try{const x=await f();this.database.exec('COMMIT');return x}catch(e){this.database.exec('ROLLBACK');throw e}}
  close(){this.database.close()}
}
