import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { equal, rejects, throws } from 'node:assert/strict'
import { canonicalizeRetailOfflineEnvelope, RETAIL_OFFLINE_SIGNATURE_ALGORITHM, RETAIL_OFFLINE_SIGNATURE_PREFIX } from '@madina/retail'
import { initializeDatabase } from '../migrations/initializeDatabase.js'
import { SqliteAuthRepository } from '../auth/SqliteAuthRepository.js'
import { SqliteRetailAccessRepository } from './SqliteRetailAccessRepository.js'
import { SqliteRetailCatalogRepository } from './SqliteRetailCatalogRepository.js'
import { SqliteRetailInventoryRepository } from './SqliteRetailInventoryRepository.js'
import { SqliteRetailOfflineAuthorityRepository } from './SqliteRetailOfflineAuthorityRepository.js'
import { SqliteRetailOfflineSaleSyncRepository } from './SqliteRetailOfflineSaleSyncRepository.js'
import { SqliteRetailOfflineStockConflictMaterializationRepository } from './SqliteRetailOfflineStockConflictMaterializationRepository.js'
import { SqliteRetailOfflineStockConflictLifecycleRepository } from './SqliteRetailOfflineStockConflictLifecycleRepository.js'
import { SqliteRetailSaleReturnRepository } from './SqliteRetailSaleReturnRepository.js'
import { SqliteRetailSaleRepository } from './SqliteRetailSaleRepository.js'
import { SqliteRetailTransferRepository } from './SqliteRetailTransferRepository.js'

const deepEqual = (actual: unknown, expected: unknown): void => equal(JSON.stringify(actual), JSON.stringify(expected))


async function d2bFixture(){
  const directory=mkdtempSync(join(tmpdir(),'retail-d2b-')),file=join(directory,'x.sqlite'),admin={actorType:'user' as const,actorUserId:'admin-1',requestId:'d2b'},manager={actorType:'user' as const,actorUserId:'manager-1',requestId:'d2b-manager'}
  initializeDatabase(file);const auth=new SqliteAuthRepository(file),access=new SqliteRetailAccessRepository(file),catalog=new SqliteRetailCatalogRepository(file),inventory=new SqliteRetailInventoryRepository(file),authority=new SqliteRetailOfflineAuthorityRepository(file),sync=new SqliteRetailOfflineSaleSyncRepository(file),materializer=new SqliteRetailOfflineStockConflictMaterializationRepository(file)
  for(const [id,role] of [['admin-1','admin'],['manager-1','manager'],['cashier-1','operator']] as const)await auth.createUser({id,username:id,normalizedUsername:id,email:`${id}@test`,role,status:'active',sessionVersion:1,createdAt:new Date(),updatedAt:new Date()})
  const location=await access.createLocation({code:'D2B-X',name:'D2B X',type:'store',status:'active'},admin),other=await access.createLocation({code:'D2B-Y',name:'D2B Y',type:'store',status:'active'},admin);await access.configureCurrency(location.id,'USD',2,admin);await access.configureCurrency(other.id,'USD',2,admin);await access.grant('manager-1',location.id,admin)
  const blocked=await catalog.createProduct({sourceId:'d2b-blocked',name:'Blocked'},admin),clean=await catalog.createProduct({sourceId:'d2b-clean',name:'Clean'},admin);for(const l of [location,other])for(const p of [blocked,clean])await catalog.setPrice(p.id,l.id,100,admin);await inventory.recordMovement({productId:blocked.id,locationId:location.id,quantityDelta:5,type:'opening',sourceType:'test',sourceId:'d2b-seed',sourceLineId:'d2b-blocked'},admin);await inventory.recordMovement({productId:clean.id,locationId:location.id,quantityDelta:5,type:'opening',sourceType:'test',sourceId:'d2b-seed',sourceLineId:'d2b-clean'},admin)
  const pair=generateKeyPairSync('ed25519'),terminal=await authority.enrollTerminal({locationId:location.id,keyAlgorithm:RETAIL_OFFLINE_SIGNATURE_ALGORITHM,publicKey:pair.publicKey.export({format:'der',type:'spki'}).toString('base64')},admin),issued=await authority.issueAuthority({terminalId:terminal.id,userId:'cashier-1',locationId:location.id,expiresAt:new Date(Date.now()+60_000),permitCount:6,productIds:[blocked.id,clean.id]},admin),permits=await authority.listPermits(issued.id)
  const signed=(operation:string,permitIndex:number,lines:Array<{id:string;productId:string;quantity:number}>)=>{const amount=lines.reduce((n,l)=>n+l.quantity*100,0),envelope={schemaVersion:1 as const,offlineOperationId:operation,authorityId:issued.id,authorityVersion:issued.authorityVersion,permitId:permits[permitIndex]!.id,permitSequence:permits[permitIndex]!.sequence,terminalId:terminal.id,terminalKeyVersion:1,userId:'cashier-1',locationId:location.id,proposedSaleId:`${operation}-sale`,lines:lines.map(l=>({...l,unitPriceMinor:100})),currencyCode:'USD',currencyExponent:2,cashAllocation:{id:`${operation}-payment`,method:'cash' as const,amountMinor:amount,ordinal:0 as const},subtotalMinor:amount,payableTotalMinor:amount,claimedOfflineCompletedAt:'2026-09-21T00:00:00.000Z'},canonical=canonicalizeRetailOfflineEnvelope(envelope);return{envelope,payloadHash:createHash('sha256').update(canonical).digest('hex'),signature:`${RETAIL_OFFLINE_SIGNATURE_PREFIX}${sign(null,Buffer.from(canonical),pair.privateKey).toString('base64')}`}}
  const conflict=signed('d2b-origin',0,[{id:'d2b-origin-item',productId:blocked.id,quantity:6}]);await rejects(sync.sync(location.id,conflict,admin),/VERIFIED_OFFLINE_STOCK_CONFLICT/);await materializer.materialize(location.id,{offlineOperationId:'d2b-origin',commandId:'d2b-materialize'},manager);await inventory.recordMovement({productId:blocked.id,locationId:location.id,quantityDelta:20,type:'goods_receipt',sourceType:'test',sourceId:'d2b-restock',sourceLineId:'d2b-restock'},admin)
  return{file,admin,manager,location,other,blocked,clean,authority,sync,inventory,materializer,issued,permits,signed,close:()=>{materializer.close();sync.close();authority.close();inventory.close();catalog.close();access.close();auth.close();try{rmSync(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100})}catch(error){if(!(error instanceof Error)||!('code'in error)||error.code!=='EPERM')throw error}}}
}

test('D.2B Authority and Sync enforce unresolved exact pairs with zero effects and deficit precedence',async()=>{const f=await d2bFixture();try{const db=new DatabaseSync(f.file),count=(table:string)=>((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()as{count:number}).count),before={authorities:count('retail_offline_authorities'),snapshots:count('retail_offline_authority_product_prices'),permits:count('retail_offline_authority_permits'),audits:count('audit_events')};const terminal=await f.authority.enrollTerminal({locationId:f.location.id,keyAlgorithm:RETAIL_OFFLINE_SIGNATURE_ALGORITHM,publicKey:generateKeyPairSync('ed25519').publicKey.export({format:'der',type:'spki'}).toString('base64')},f.admin);const authorityInput={terminalId:terminal.id,userId:'cashier-1',locationId:f.location.id,expiresAt:new Date(Date.now()+60_000),permitCount:1,productIds:[f.clean.id,f.blocked.id]};await rejects(f.authority.issueAuthority(authorityInput,f.admin),/RETAIL_PRODUCT_LOCATION_CONFLICT_BLOCKED/);equal(count('retail_offline_authorities'),before.authorities);equal(count('retail_offline_authority_product_prices'),before.snapshots);equal(count('retail_offline_authority_permits'),before.permits);equal(count('audit_events'),before.audits+1);await f.authority.issueAuthority({...authorityInput,productIds:[f.clean.id]},f.admin);const blocked=f.signed('d2b-blocked',1,[{id:'d2b-blocked-item',productId:f.blocked.id,quantity:1}]),effects={sales:count('retail_sales'),items:count('retail_sale_items'),payments:count('retail_payment_allocations'),evidence:count('retail_offline_sale_evidence'),receipts:count('retail_offline_sale_sync_receipts'),verifications:count('retail_offline_stock_conflict_verifications')};await rejects(f.sync.sync(f.location.id,blocked,f.admin),/RETAIL_PRODUCT_LOCATION_CONFLICT_BLOCKED/);deepEqual({sales:count('retail_sales'),items:count('retail_sale_items'),payments:count('retail_payment_allocations'),evidence:count('retail_offline_sale_evidence'),receipts:count('retail_offline_sale_sync_receipts'),verifications:count('retail_offline_stock_conflict_verifications')},effects);equal((db.prepare('SELECT COUNT(*) AS count FROM retail_offline_sale_evidence WHERE permit_id=?').get(f.permits[1]!.id)as{count:number}).count,0);equal((db.prepare('SELECT COUNT(*) AS count FROM retail_offline_stock_conflict_verifications WHERE permit_id=?').get(f.permits[1]!.id)as{count:number}).count,0);const multi=f.signed('d2b-multi',2,[{id:'d2b-clean-item',productId:f.clean.id,quantity:1},{id:'d2b-blocked-multi-item',productId:f.blocked.id,quantity:1}]);await rejects(f.sync.sync(f.location.id,multi,f.admin),/RETAIL_PRODUCT_LOCATION_CONFLICT_BLOCKED/);const deficit=f.signed('d2b-deficit',3,[{id:'d2b-deficit-item',productId:f.blocked.id,quantity:30}]);await rejects(f.sync.sync(f.location.id,deficit,f.admin),/VERIFIED_OFFLINE_STOCK_CONFLICT/);equal((db.prepare("SELECT COUNT(*) AS count FROM retail_offline_stock_conflict_verifications WHERE offline_operation_id='d2b-deficit'").get()as{count:number}).count,1);db.close()}finally{f.close()}})

test('D.2B Authority A-G blocks exact unresolved pairs without retroactive mutation',async()=>{const f=await d2bFixture();try{const db=new DatabaseSync(f.file),count=(t:string)=>((db.prepare(`SELECT COUNT(*) AS count FROM ${t}`).get()as{count:number}).count),original={authority:db.prepare('SELECT * FROM retail_offline_authorities WHERE id=?').get(f.issued.id),snapshots:db.prepare('SELECT * FROM retail_offline_authority_product_prices WHERE authority_id=?').all(f.issued.id),permits:db.prepare('SELECT * FROM retail_offline_authority_permits WHERE authority_id=?').all(f.issued.id)},terminal=await f.authority.enrollTerminal({locationId:f.location.id,keyAlgorithm:RETAIL_OFFLINE_SIGNATURE_ALGORITHM,publicKey:generateKeyPairSync('ed25519').publicKey.export({format:'der',type:'spki'}).toString('base64')},f.admin),input={terminalId:terminal.id,userId:'cashier-1',locationId:f.location.id,expiresAt:new Date(Date.now()+60_000),permitCount:2,productIds:[f.blocked.id]};const before=[count('retail_offline_authorities'),count('retail_offline_authority_product_prices'),count('retail_offline_authority_permits'),count('audit_events')];await rejects(f.authority.issueAuthority(input,f.admin),/RETAIL_PRODUCT_LOCATION_CONFLICT_BLOCKED/);deepEqual([count('retail_offline_authorities'),count('retail_offline_authority_product_prices'),count('retail_offline_authority_permits'),count('audit_events')],before);await f.authority.issueAuthority({...input,productIds:[f.clean.id]},f.admin);const otherTerminal=await f.authority.enrollTerminal({locationId:f.other.id,keyAlgorithm:RETAIL_OFFLINE_SIGNATURE_ALGORITHM,publicKey:generateKeyPairSync('ed25519').publicKey.export({format:'der',type:'spki'}).toString('base64')},f.admin);await f.authority.issueAuthority({...input,terminalId:otherTerminal.id,locationId:f.other.id,productIds:[f.blocked.id]},f.admin);const lifecycle=new SqliteRetailOfflineStockConflictLifecycleRepository(f.file);await lifecycle.review(f.location.id,{offlineOperationId:'d2b-origin',saleItemId:'d2b-origin-item',commandId:'d2b-authority-review',expectedCurrentState:'open',targetState:'under_review',actorUserId:'manager-1'});await rejects(f.authority.issueAuthority(input,f.manager),/RETAIL_PRODUCT_LOCATION_CONFLICT_BLOCKED/);deepEqual(db.prepare('SELECT * FROM retail_offline_authorities WHERE id=?').get(f.issued.id),original.authority);deepEqual(db.prepare('SELECT * FROM retail_offline_authority_product_prices WHERE authority_id=?').all(f.issued.id),original.snapshots);deepEqual(db.prepare('SELECT * FROM retail_offline_authority_permits WHERE authority_id=?').all(f.issued.id),original.permits);lifecycle.close();db.close()}finally{f.close()}})

test('D.2B Fixture I blocks sufficient-stock Sync for UNDER_REVIEW exact pair',async()=>{const f=await d2bFixture();try{const lifecycle=new SqliteRetailOfflineStockConflictLifecycleRepository(f.file);await lifecycle.review(f.location.id,{offlineOperationId:'d2b-origin',saleItemId:'d2b-origin-item',commandId:'d2b-i-review',expectedCurrentState:'open',targetState:'under_review',actorUserId:'manager-1'});equal((await lifecycle.getCurrentState('d2b-origin','d2b-origin-item')as{current_state:string}).current_state,'under_review');const input=f.signed('d2b-i-blocked',4,[{id:'d2b-i-item',productId:f.blocked.id,quantity:1}]),db=new DatabaseSync(f.file),count=(t:string)=>((db.prepare(`SELECT COUNT(*) AS count FROM ${t} WHERE offline_operation_id='d2b-i-blocked'`).get()as{count:number}).count);await rejects(f.sync.sync(f.location.id,input,f.admin),/RETAIL_PRODUCT_LOCATION_CONFLICT_BLOCKED/);equal(count('retail_offline_sale_evidence'),0);equal(count('retail_offline_sale_sync_receipts'),0);equal(count('retail_offline_stock_conflict_verifications'),0);equal((db.prepare("SELECT COUNT(*) AS count FROM retail_sales WHERE id='d2b-i-blocked-sale'").get()as{count:number}).count,0);equal((db.prepare('SELECT COUNT(*) AS count FROM retail_offline_sale_evidence WHERE permit_id=?').get(f.permits[4]!.id)as{count:number}).count,0);equal((db.prepare('SELECT COUNT(*) AS count FROM retail_offline_stock_conflict_verifications WHERE permit_id=?').get(f.permits[4]!.id)as{count:number}).count,0);db.close();lifecycle.close()}finally{f.close()}})

test('D.2B Fixture J allows unrelated Product at same unresolved Location',async()=>{const f=await d2bFixture();try{const lifecycle=new SqliteRetailOfflineStockConflictLifecycleRepository(f.file),input=f.signed('d2b-j-clean',5,[{id:'d2b-j-item',productId:f.clean.id,quantity:1}]),before=(await f.inventory.findBalance(f.clean.id,f.location.id))!.onHandQuantity,result=await f.sync.sync(f.location.id,input,f.admin),db=new DatabaseSync(f.file);equal(await lifecycle.isProductLocationBlocked(f.blocked.id,f.location.id),true);equal(await lifecycle.isProductLocationBlocked(f.clean.id,f.location.id),false);equal(result.replayed,false);equal((await f.inventory.findBalance(f.clean.id,f.location.id))!.onHandQuantity,before-1);for(const [t,w]of[['retail_offline_sale_evidence',"offline_operation_id='d2b-j-clean'"],['retail_offline_sale_sync_receipts',"offline_operation_id='d2b-j-clean'"],['retail_sales',"id='d2b-j-clean-sale'"],['retail_sale_items',"id='d2b-j-item'"],['retail_payment_allocations',"id='d2b-j-clean-payment'"]])equal((db.prepare(`SELECT COUNT(*) AS count FROM ${t} WHERE ${w}`).get()as{count:number}).count,1);equal((db.prepare("SELECT COUNT(*) AS count FROM retail_offline_stock_conflict_verifications WHERE offline_operation_id='d2b-j-clean'").get()as{count:number}).count,0);db.close();lifecycle.close()}finally{f.close()}})

test('D.2B Fixture K allows same Product at unrelated Location',async()=>{const f=await d2bFixture();try{const lifecycle=new SqliteRetailOfflineStockConflictLifecycleRepository(f.file);equal(await lifecycle.isProductLocationBlocked(f.blocked.id,f.location.id),true);equal(await lifecycle.isProductLocationBlocked(f.blocked.id,f.other.id),false);await f.inventory.recordMovement({productId:f.blocked.id,locationId:f.other.id,quantityDelta:5,type:'opening',sourceType:'test',sourceId:'d2b-k-stock',sourceLineId:'d2b-k-stock'},f.admin);const before=(await f.inventory.findBalance(f.blocked.id,f.other.id))!.onHandQuantity,pair=generateKeyPairSync('ed25519'),terminal=await f.authority.enrollTerminal({locationId:f.other.id,keyAlgorithm:RETAIL_OFFLINE_SIGNATURE_ALGORITHM,publicKey:pair.publicKey.export({format:'der',type:'spki'}).toString('base64')},f.admin),issued=await f.authority.issueAuthority({terminalId:terminal.id,userId:'cashier-1',locationId:f.other.id,expiresAt:new Date(Date.now()+60_000),permitCount:1,productIds:[f.blocked.id]},f.admin),permit=(await f.authority.listPermits(issued.id))[0]!,envelope={schemaVersion:1 as const,offlineOperationId:'d2b-k-other-location',authorityId:issued.id,authorityVersion:issued.authorityVersion,permitId:permit.id,permitSequence:permit.sequence,terminalId:terminal.id,terminalKeyVersion:1,userId:'cashier-1',locationId:f.other.id,proposedSaleId:'d2b-k-other-location-sale',lines:[{id:'d2b-k-other-location-item',productId:f.blocked.id,quantity:1,unitPriceMinor:100}],currencyCode:'USD',currencyExponent:2,cashAllocation:{id:'d2b-k-other-location-payment',method:'cash' as const,amountMinor:100,ordinal:0 as const},subtotalMinor:100,payableTotalMinor:100,claimedOfflineCompletedAt:'2026-09-21T00:00:00.000Z'},canonical=canonicalizeRetailOfflineEnvelope(envelope),result=await f.sync.sync(f.other.id,{envelope,payloadHash:createHash('sha256').update(canonical).digest('hex'),signature:`${RETAIL_OFFLINE_SIGNATURE_PREFIX}${sign(null,Buffer.from(canonical),pair.privateKey).toString('base64')}`},f.admin),db=new DatabaseSync(f.file);equal(result.replayed,false);equal((await f.inventory.findBalance(f.blocked.id,f.other.id))!.onHandQuantity,before-1);for(const [t,w]of[['retail_offline_sale_evidence',"offline_operation_id='d2b-k-other-location'"],['retail_offline_sale_sync_receipts',"offline_operation_id='d2b-k-other-location'"],['retail_sales',"id='d2b-k-other-location-sale' AND location_id='"+f.other.id+"'"],['retail_sale_items',"id='d2b-k-other-location-item' AND product_id='"+f.blocked.id+"'"],['retail_payment_allocations',"id='d2b-k-other-location-payment'"]])equal((db.prepare(`SELECT COUNT(*) AS count FROM ${t} WHERE ${w}`).get()as{count:number}).count,1);equal((db.prepare("SELECT COUNT(*) AS count FROM retail_offline_stock_conflict_verifications WHERE offline_operation_id='d2b-k-other-location'").get()as{count:number}).count,0);equal(await lifecycle.isProductLocationBlocked(f.blocked.id,f.location.id),true);equal(await lifecycle.isProductLocationBlocked(f.blocked.id,f.other.id),false);db.close();lifecycle.close()}finally{f.close()}})

test('D.2B Fixture M recovered stock remains blocked while conflict unresolved',async()=>{const f=await d2bFixture();try{const lifecycle=new SqliteRetailOfflineStockConflictLifecycleRepository(f.file);equal(await lifecycle.isProductLocationBlocked(f.blocked.id,f.location.id),true);const before=(await f.inventory.findBalance(f.blocked.id,f.location.id))!.onHandQuantity;equal(before,19);const input=f.signed('d2b-m-blocked',1,[{id:'d2b-m-item',productId:f.blocked.id,quantity:1}]),db=new DatabaseSync(f.file);await rejects(f.sync.sync(f.location.id,input,f.admin),/RETAIL_PRODUCT_LOCATION_CONFLICT_BLOCKED/);equal((await f.inventory.findBalance(f.blocked.id,f.location.id))!.onHandQuantity,before);for(const t of['retail_offline_sale_evidence','retail_offline_sale_sync_receipts','retail_offline_stock_conflict_verifications'])equal((db.prepare(`SELECT COUNT(*) AS count FROM ${t} WHERE offline_operation_id='d2b-m-blocked'`).get()as{count:number}).count,0);equal((db.prepare("SELECT COUNT(*) AS count FROM retail_sales WHERE id='d2b-m-blocked-sale'").get()as{count:number}).count,0);for(const t of['retail_offline_sale_evidence','retail_offline_stock_conflict_verifications'])equal((db.prepare(`SELECT COUNT(*) AS count FROM ${t} WHERE permit_id=?`).get(f.permits[1]!.id)as{count:number}).count,0);equal(await lifecycle.isProductLocationBlocked(f.blocked.id,f.location.id),true);db.close();lifecycle.close()}finally{f.close()}})


test('D.2B Fixture Q gives stock deficit precedence over unresolved multi-line blocking', async () => {
  const f = await d2bFixture()

  try {
    const lifecycle = new SqliteRetailOfflineStockConflictLifecycleRepository(f.file)
    const db = new DatabaseSync(f.file)

    try {
      equal(
        await lifecycle.isProductLocationBlocked(f.blocked.id, f.location.id),
        true,
      )

      equal(
        await lifecycle.isProductLocationBlocked(f.clean.id, f.location.id),
        false,
      )

      const blockedBefore = (
        await f.inventory.findBalance(f.blocked.id, f.location.id)
      )!.onHandQuantity

      const cleanBefore = (
        await f.inventory.findBalance(f.clean.id, f.location.id)
      )!.onHandQuantity

      const input = f.signed(
        'd2b-q-multi-deficit',
        4,
        [
          {
            id: 'd2b-q-blocked-item',
            productId: f.blocked.id,
            quantity: 1,
          },
          {
            id: 'd2b-q-deficit-item',
            productId: f.clean.id,
            quantity: cleanBefore + 1,
          },
        ],
      )

      await rejects(
        f.sync.sync(f.location.id, input, f.admin),
        /VERIFIED_OFFLINE_STOCK_CONFLICT/,
      )

      const verification = db.prepare(
        "SELECT COUNT(*) AS count FROM retail_offline_stock_conflict_verifications WHERE offline_operation_id='d2b-q-multi-deficit'",
      ).get() as { count: number }

      equal(verification.count, 1)

      const lines = db.prepare(
        "SELECT sale_item_id,product_id,quantity,observed_on_hand_quantity,initial_deficit_quantity FROM retail_offline_stock_conflict_verification_lines WHERE offline_operation_id='d2b-q-multi-deficit' ORDER BY sale_item_id",
      ).all() as Array<{
        sale_item_id: string
        product_id: string
        quantity: number
        observed_on_hand_quantity: number
        initial_deficit_quantity: number
      }>

      deepEqual(lines, [
        {
          sale_item_id: 'd2b-q-blocked-item',
          product_id: f.blocked.id,
          quantity: 1,
          observed_on_hand_quantity: blockedBefore,
          initial_deficit_quantity: 0,
        },
        {
          sale_item_id: 'd2b-q-deficit-item',
          product_id: f.clean.id,
          quantity: cleanBefore + 1,
          observed_on_hand_quantity: cleanBefore,
          initial_deficit_quantity: 1,
        },
      ])

      equal(
        (db.prepare(
          "SELECT COUNT(*) AS count FROM retail_sales WHERE id='d2b-q-multi-deficit-sale'",
        ).get() as { count: number }).count,
        0,
      )

      equal(
        (db.prepare(
          "SELECT COUNT(*) AS count FROM retail_offline_sale_evidence WHERE offline_operation_id='d2b-q-multi-deficit'",
        ).get() as { count: number }).count,
        0,
      )

      equal(
        (db.prepare(
          "SELECT COUNT(*) AS count FROM retail_offline_sale_sync_receipts WHERE offline_operation_id='d2b-q-multi-deficit'",
        ).get() as { count: number }).count,
        0,
      )

      equal(
        (
          await f.inventory.findBalance(f.blocked.id, f.location.id)
        )!.onHandQuantity,
        blockedBefore,
      )

      equal(
        (
          await f.inventory.findBalance(f.clean.id, f.location.id)
        )!.onHandQuantity,
        cleanBefore,
      )

      equal(
        await lifecycle.isProductLocationBlocked(f.blocked.id, f.location.id),
        true,
      )
    } finally {
      db.close()
      lifecycle.close()
    }
  } finally {
    f.close()
  }
})
test('D.2B Fixture O preserves verified-conflict replay after unresolved lifecycle', async () => {
  const f = await d2bFixture()

  try {
    const lifecycle = new SqliteRetailOfflineStockConflictLifecycleRepository(f.file)
    const db = new DatabaseSync(f.file)

    try {
      equal(
        await lifecycle.isProductLocationBlocked(f.blocked.id, f.location.id),
        true,
      )

      const countVerification = (): number =>
        (db.prepare(
          "SELECT COUNT(*) AS count FROM retail_offline_stock_conflict_verifications WHERE offline_operation_id='d2b-origin'",
        ).get() as { count: number }).count

      const countVerificationLines = (): number =>
        (db.prepare(
          "SELECT COUNT(*) AS count FROM retail_offline_stock_conflict_verification_lines WHERE offline_operation_id='d2b-origin'",
        ).get() as { count: number }).count

      const countSales = (): number =>
        (db.prepare(
          "SELECT COUNT(*) AS count FROM retail_sales WHERE id='d2b-origin-sale'",
        ).get() as { count: number }).count

      const countMaterializationReceipts = (): number =>
        (db.prepare(
          "SELECT COUNT(*) AS count FROM retail_offline_stock_conflict_materialization_receipts WHERE offline_operation_id='d2b-origin'",
        ).get() as { count: number }).count

      const before = {
        verification: countVerification(),
        verificationLines: countVerificationLines(),
        sales: countSales(),
        materializationReceipts: countMaterializationReceipts(),
        stock: (await f.inventory.findBalance(
          f.blocked.id,
          f.location.id,
        ))!.onHandQuantity,
      }

      equal(before.verification, 1)
      equal(before.verificationLines, 1)
      equal(before.sales, 1)
      equal(before.materializationReceipts, 1)

      const exactReplay = f.signed(
        'd2b-origin',
        0,
        [{
          id: 'd2b-origin-item',
          productId: f.blocked.id,
          quantity: 6,
        }],
      )

      await rejects(
        f.sync.sync(f.location.id, exactReplay, f.admin),
        /RETAIL_OFFLINE_REVIEW_REQUIRED/,
      )

      const after = {
        verification: countVerification(),
        verificationLines: countVerificationLines(),
        sales: countSales(),
        materializationReceipts: countMaterializationReceipts(),
        stock: (await f.inventory.findBalance(
          f.blocked.id,
          f.location.id,
        ))!.onHandQuantity,
      }

      deepEqual(after, before)

      equal(
        await lifecycle.isProductLocationBlocked(f.blocked.id, f.location.id),
        true,
      )
    } finally {
      db.close()
      lifecycle.close()
    }
  } finally {
    f.close()
  }
})
test('D.2B Fixture N preserves accepted Offline Sync replay after later unresolved conflict', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'retail-d2b-n-'))
  const file = join(directory, 'x.sqlite')
  const admin = { actorType: 'user' as const, actorUserId: 'admin-1', requestId: 'd2b-n-admin' }
  const manager = { actorType: 'user' as const, actorUserId: 'manager-1', requestId: 'd2b-n-manager' }

  initializeDatabase(file)

  const auth = new SqliteAuthRepository(file)
  const access = new SqliteRetailAccessRepository(file)
  const catalog = new SqliteRetailCatalogRepository(file)
  const inventory = new SqliteRetailInventoryRepository(file)
  const authority = new SqliteRetailOfflineAuthorityRepository(file)
  const sync = new SqliteRetailOfflineSaleSyncRepository(file)
  const materializer = new SqliteRetailOfflineStockConflictMaterializationRepository(file)
  const lifecycle = new SqliteRetailOfflineStockConflictLifecycleRepository(file)

  try {
    for (const [id, role] of [
      ['admin-1', 'admin'],
      ['manager-1', 'manager'],
      ['cashier-1', 'operator'],
    ] as const) {
      await auth.createUser({
        id,
        username: id,
        normalizedUsername: id,
        email: `${id}@test`,
        role,
        status: 'active',
        sessionVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    }

    const location = await access.createLocation({
      code: 'D2B-N-X',
      name: 'D2B N X',
      type: 'store',
      status: 'active',
    }, admin)

    await access.configureCurrency(location.id, 'USD', 2, admin)
    await access.grant('manager-1', location.id, admin)

    const product = await catalog.createProduct({
      sourceId: 'd2b-n-product',
      name: 'D2B N Product',
    }, admin)

    await catalog.setPrice(product.id, location.id, 100, admin)

    await inventory.recordMovement({
      productId: product.id,
      locationId: location.id,
      quantityDelta: 5,
      type: 'opening',
      sourceType: 'test',
      sourceId: 'd2b-n-seed',
      sourceLineId: 'd2b-n-seed',
    }, admin)

    const pair = generateKeyPairSync('ed25519')

    const terminal = await authority.enrollTerminal({
      locationId: location.id,
      keyAlgorithm: RETAIL_OFFLINE_SIGNATURE_ALGORITHM,
      publicKey: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    }, admin)

    const issued = await authority.issueAuthority({
      terminalId: terminal.id,
      userId: 'cashier-1',
      locationId: location.id,
      expiresAt: new Date(Date.now() + 60_000),
      permitCount: 2,
      productIds: [product.id],
    }, admin)

    const permits = await authority.listPermits(issued.id)
    equal(permits.length, 2)

    const makeSigned = (
      operationId: string,
      permitIndex: number,
      saleItemId: string,
      quantity: number,
    ) => {
      const amount = quantity * 100
      const envelope = {
        schemaVersion: 1 as const,
        offlineOperationId: operationId,
        authorityId: issued.id,
        authorityVersion: issued.authorityVersion,
        permitId: permits[permitIndex]!.id,
        permitSequence: permits[permitIndex]!.sequence,
        terminalId: terminal.id,
        terminalKeyVersion: 1,
        userId: 'cashier-1',
        locationId: location.id,
        proposedSaleId: `${operationId}-sale`,
        lines: [{
          id: saleItemId,
          productId: product.id,
          quantity,
          unitPriceMinor: 100,
        }],
        currencyCode: 'USD',
        currencyExponent: 2,
        cashAllocation: {
          id: `${operationId}-payment`,
          method: 'cash' as const,
          amountMinor: amount,
          ordinal: 0 as const,
        },
        subtotalMinor: amount,
        payableTotalMinor: amount,
        claimedOfflineCompletedAt: '2026-09-21T00:00:00.000Z',
      }

      const canonical = canonicalizeRetailOfflineEnvelope(envelope)

      return {
        envelope,
        payloadHash: createHash('sha256').update(canonical).digest('hex'),
        signature: `${RETAIL_OFFLINE_SIGNATURE_PREFIX}${sign(
          null,
          Buffer.from(canonical),
          pair.privateKey,
        ).toString('base64')}`,
      }
    }

    // Both permits already exist while Product+Location is still clean.
    equal(await lifecycle.isProductLocationBlocked(product.id, location.id), false)

    const op1 = makeSigned('d2b-n-op1', 0, 'd2b-n-op1-item', 1)
    const op2 = makeSigned('d2b-n-op2', 1, 'd2b-n-op2-item', 5)

    const initialStock = (await inventory.findBalance(product.id, location.id))!.onHandQuantity
    equal(initialStock, 5)

    const first = await sync.sync(location.id, op1, admin)
    equal(first.replayed, false)

    const stockAfterFirst = (await inventory.findBalance(product.id, location.id))!.onHandQuantity
    equal(stockAfterFirst, 4)

    const db = new DatabaseSync(file)

    const countWhere = (table: string, where: string): number =>
      (db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get() as { count: number }).count

    const op1CountsBeforeReplay = {
      evidence: countWhere('retail_offline_sale_evidence', "offline_operation_id='d2b-n-op1'"),
      receipts: countWhere('retail_offline_sale_sync_receipts', "offline_operation_id='d2b-n-op1'"),
      sales: countWhere('retail_sales', "id='d2b-n-op1-sale'"),
      items: countWhere('retail_sale_items', "id='d2b-n-op1-item'"),
      payments: countWhere('retail_payment_allocations', "id='d2b-n-op1-payment'"),
      verifications: countWhere(
        'retail_offline_stock_conflict_verifications',
        "offline_operation_id='d2b-n-op1'",
      ),
    }

    deepEqual(op1CountsBeforeReplay, {
      evidence: 1,
      receipts: 1,
      sales: 1,
      items: 1,
      payments: 1,
      verifications: 0,
    })

    await rejects(
      sync.sync(location.id, op2, admin),
      /VERIFIED_OFFLINE_STOCK_CONFLICT/,
    )

    equal(
      countWhere(
        'retail_offline_stock_conflict_verifications',
        "offline_operation_id='d2b-n-op2'",
      ),
      1,
    )

    await materializer.materialize(location.id, {
      offlineOperationId: 'd2b-n-op2',
      commandId: 'd2b-n-materialize-op2',
    }, manager)

    equal(await lifecycle.isProductLocationBlocked(product.id, location.id), true)

    const stockBeforeReplay = (await inventory.findBalance(product.id, location.id))!.onHandQuantity
    equal(stockBeforeReplay, -1)

    const replay = await sync.sync(location.id, op1, admin)
    equal(replay.replayed, true)

    const stockAfterReplay = (await inventory.findBalance(product.id, location.id))!.onHandQuantity
    equal(stockAfterReplay, stockBeforeReplay)

    const op1CountsAfterReplay = {
      evidence: countWhere('retail_offline_sale_evidence', "offline_operation_id='d2b-n-op1'"),
      receipts: countWhere('retail_offline_sale_sync_receipts', "offline_operation_id='d2b-n-op1'"),
      sales: countWhere('retail_sales', "id='d2b-n-op1-sale'"),
      items: countWhere('retail_sale_items', "id='d2b-n-op1-item'"),
      payments: countWhere('retail_payment_allocations', "id='d2b-n-op1-payment'"),
      verifications: countWhere(
        'retail_offline_stock_conflict_verifications',
        "offline_operation_id='d2b-n-op1'",
      ),
    }

    deepEqual(op1CountsAfterReplay, op1CountsBeforeReplay)
    equal(await lifecycle.isProductLocationBlocked(product.id, location.id), true)

    db.close()
  } finally {
    lifecycle.close()
    materializer.close()
    sync.close()
    authority.close()
    inventory.close()
    catalog.close()
    access.close()
    auth.close()

    try {
      rmSync(directory, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      })
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'EPERM'
      ) throw error
    }
  }
})
test('verified conflict materialization is atomic, idempotent, and creates the only negative-stock seam', async () => {
  const directory=mkdtempSync(join(tmpdir(),'retail-conflict-materialization-')),file=join(directory,'x.sqlite'),context={actorType:'user' as const,actorUserId:'admin-1',requestId:'materialization'}
  initializeDatabase(file);const auth=new SqliteAuthRepository(file),access=new SqliteRetailAccessRepository(file),catalog=new SqliteRetailCatalogRepository(file),inventory=new SqliteRetailInventoryRepository(file),authority=new SqliteRetailOfflineAuthorityRepository(file),sync=new SqliteRetailOfflineSaleSyncRepository(file),materializer=new SqliteRetailOfflineStockConflictMaterializationRepository(file),returns=new SqliteRetailSaleReturnRepository(file)
  try {
    await auth.createUser({id:'admin-1',username:'Admin',normalizedUsername:'admin',email:'admin@example.test',role:'admin',status:'active',sessionVersion:1,createdAt:new Date(),updatedAt:new Date()});await auth.createUser({id:'cashier-1',username:'Cashier',normalizedUsername:'cashier',email:'cashier@example.test',role:'operator',status:'active',sessionVersion:1,createdAt:new Date(),updatedAt:new Date()})
    const location=await access.createLocation({code:'CONFLICT',name:'Conflict',type:'store',status:'active'},context);await access.configureCurrency(location.id,'USD',2,context);const product=await catalog.createProduct({sourceId:'P',name:'P'},context);await catalog.setPrice(product.id,location.id,100,context);await inventory.recordMovement({productId:product.id,locationId:location.id,quantityDelta:2,type:'opening',sourceType:'test',sourceId:'seed',sourceLineId:'seed'},context);const guard=new DatabaseSync(file);throws(()=>guard.prepare('UPDATE retail_inventory_balances SET on_hand_quantity=-1,updated_at=? WHERE product_id=? AND location_id=?').run('forged',product.id,location.id),/negative balance requires/);guard.close()
    const pair=generateKeyPairSync('ed25519'),terminal=await authority.enrollTerminal({locationId:location.id,keyAlgorithm:RETAIL_OFFLINE_SIGNATURE_ALGORITHM,publicKey:pair.publicKey.export({format:'der',type:'spki'}).toString('base64')},context),issued=await authority.issueAuthority({terminalId:terminal.id,userId:'cashier-1',locationId:location.id,expiresAt:new Date(Date.now()+60_000),permitCount:1,productIds:[product.id]},context),permit=(await authority.listPermits(issued.id))[0]!
    const envelope={schemaVersion:1 as const,offlineOperationId:'conflict-op',authorityId:issued.id,authorityVersion:issued.authorityVersion,permitId:permit.id,permitSequence:permit.sequence,terminalId:terminal.id,terminalKeyVersion:1,userId:'cashier-1',locationId:location.id,proposedSaleId:'conflict-sale',lines:[{id:'conflict-item',productId:product.id,quantity:3,unitPriceMinor:100}],currencyCode:'USD',currencyExponent:2,cashAllocation:{id:'conflict-payment',method:'cash' as const,amountMinor:300,ordinal:0 as const},subtotalMinor:300,payableTotalMinor:300,claimedOfflineCompletedAt:'2026-09-21T00:00:00.000Z'},canonical=canonicalizeRetailOfflineEnvelope(envelope),input={envelope,payloadHash:createHash('sha256').update(canonical).digest('hex'),signature:`${RETAIL_OFFLINE_SIGNATURE_PREFIX}${sign(null,Buffer.from(canonical),pair.privateKey).toString('base64')}`}
    await rejects(sync.sync(location.id,input,context),/VERIFIED_OFFLINE_STOCK_CONFLICT/);await rejects(materializer.materialize(location.id,{offlineOperationId:'missing',commandId:'missing-command'},context),/verification is required/);await catalog.updateProduct(product.id,{name:'P',status:'inactive'},context);await authority.revokeAuthority(issued.id,'after-verification',context);await authority.revokeTerminal(terminal.id,'after-verification',context)
    const failure=new DatabaseSync(file);failure.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events WHEN NEW.action='retail.offline_stock_conflict_materialized' BEGIN SELECT RAISE(ABORT,'forced materialization audit failure'); END;");await rejects(materializer.materialize(location.id,{offlineOperationId:'conflict-op',commandId:'audit-failed-command'},context),/forced materialization audit failure/);equal((await inventory.findBalance(product.id,location.id))?.onHandQuantity,2);equal((failure.prepare('SELECT COUNT(*) AS count FROM retail_sales').get() as {count:number}).count,0);equal((failure.prepare('SELECT COUNT(*) AS count FROM retail_offline_stock_conflict_materialization_receipts').get() as {count:number}).count,0);failure.exec('DROP TRIGGER fail_audit');failure.exec("CREATE TRIGGER fail_incident BEFORE INSERT ON retail_offline_stock_conflict_incidents BEGIN SELECT RAISE(ABORT,'forced incident failure'); END;");await rejects(materializer.materialize(location.id,{offlineOperationId:'conflict-op',commandId:'failed-command'},context),/forced incident failure/);equal((await inventory.findBalance(product.id,location.id))?.onHandQuantity,2);failure.exec('DROP TRIGGER fail_incident');failure.close()
    const first=await materializer.materialize(location.id,{offlineOperationId:'conflict-op',commandId:'materialize-1'},context);equal(first.replayed,false);equal((await inventory.findBalance(product.id,location.id))?.onHandQuantity,-1);equal(first.incidents.length,1);equal((await catalog.findProduct(product.id))?.status,'inactive');equal((await materializer.materialize(location.id,{offlineOperationId:'conflict-op',commandId:'materialize-1'},context)).replayed,true)
    equal((await materializer.materialize(location.id,{offlineOperationId:'conflict-op',commandId:'other-command'},context)).replayed,true)
    await rejects(materializer.materialize(location.id,{offlineOperationId:'other-operation',commandId:'materialize-1'},context),/IDEMPOTENCY_CONFLICT/)
    const immutable=new DatabaseSync(file);throws(()=>immutable.prepare("UPDATE retail_offline_stock_conflict_materialization_receipts SET payload_hash='changed' WHERE command_id='materialize-1'").run(),/immutable/);throws(()=>immutable.prepare("DELETE FROM retail_offline_stock_conflict_incidents WHERE offline_operation_id='conflict-op'").run(),/immutable/);immutable.close()
    const returned=await returns.complete(location.id,{clientOperationId:'return-1',originalSaleId:'conflict-sale',items:[{saleItemId:'conflict-item',quantity:1}]},context);equal(returned.replayed,false);equal((await inventory.findBalance(product.id,location.id))?.onHandQuantity,0)
  } finally { returns.close();materializer.close();sync.close();authority.close();inventory.close();catalog.close();access.close();auth.close();rmSync(directory,{recursive:true,force:true}) }
})

test('Fixture A: inactive Location rejects verified conflict materialization without persisted effects', async () => {
  const directory=mkdtempSync(join(tmpdir(),'retail-conflict-inactive-location-')),file=join(directory,'x.sqlite'),context={actorType:'user' as const,actorUserId:'admin-1',requestId:'inactive-location'}
  initializeDatabase(file);const auth=new SqliteAuthRepository(file),access=new SqliteRetailAccessRepository(file),catalog=new SqliteRetailCatalogRepository(file),inventory=new SqliteRetailInventoryRepository(file),authority=new SqliteRetailOfflineAuthorityRepository(file),sync=new SqliteRetailOfflineSaleSyncRepository(file),materializer=new SqliteRetailOfflineStockConflictMaterializationRepository(file)
  try {
    await auth.createUser({id:'admin-1',username:'Admin',normalizedUsername:'admin',email:'admin@example.test',role:'admin',status:'active',sessionVersion:1,createdAt:new Date(),updatedAt:new Date()});await auth.createUser({id:'cashier-1',username:'Cashier',normalizedUsername:'cashier',email:'cashier@example.test',role:'operator',status:'active',sessionVersion:1,createdAt:new Date(),updatedAt:new Date()})
    const location=await access.createLocation({code:'INACTIVE-CONFLICT',name:'Inactive conflict',type:'store',status:'active'},context);await access.configureCurrency(location.id,'USD',2,context);const product=await catalog.createProduct({sourceId:'P-INACTIVE',name:'P'},context);await catalog.setPrice(product.id,location.id,100,context);await inventory.recordMovement({productId:product.id,locationId:location.id,quantityDelta:5,type:'opening',sourceType:'test',sourceId:'seed',sourceLineId:'seed'},context)
    const pair=generateKeyPairSync('ed25519'),terminal=await authority.enrollTerminal({locationId:location.id,keyAlgorithm:RETAIL_OFFLINE_SIGNATURE_ALGORITHM,publicKey:pair.publicKey.export({format:'der',type:'spki'}).toString('base64')},context),issued=await authority.issueAuthority({terminalId:terminal.id,userId:'cashier-1',locationId:location.id,expiresAt:new Date(Date.now()+60_000),permitCount:1,productIds:[product.id]},context),permit=(await authority.listPermits(issued.id))[0]!
    const envelope={schemaVersion:1 as const,offlineOperationId:'inactive-location-op',authorityId:issued.id,authorityVersion:issued.authorityVersion,permitId:permit.id,permitSequence:permit.sequence,terminalId:terminal.id,terminalKeyVersion:1,userId:'cashier-1',locationId:location.id,proposedSaleId:'inactive-location-sale',lines:[{id:'inactive-location-item',productId:product.id,quantity:6,unitPriceMinor:100}],currencyCode:'USD',currencyExponent:2,cashAllocation:{id:'inactive-location-payment',method:'cash' as const,amountMinor:600,ordinal:0 as const},subtotalMinor:600,payableTotalMinor:600,claimedOfflineCompletedAt:'2026-09-21T00:00:00.000Z'},canonical=canonicalizeRetailOfflineEnvelope(envelope),input={envelope,payloadHash:createHash('sha256').update(canonical).digest('hex'),signature:`${RETAIL_OFFLINE_SIGNATURE_PREFIX}${sign(null,Buffer.from(canonical),pair.privateKey).toString('base64')}`}
    await rejects(sync.sync(location.id,input,context),/VERIFIED_OFFLINE_STOCK_CONFLICT/);const database=new DatabaseSync(file);database.prepare("UPDATE retail_locations SET status='inactive' WHERE id=?").run(location.id);const count=(table:string,where='')=>(database.prepare(`SELECT COUNT(*) AS count FROM ${table}${where}`).get() as {count:number}).count,before={sales:count('retail_sales'),items:count('retail_sale_items'),allocations:count('retail_payment_allocations'),evidence:count('retail_offline_sale_evidence'),movements:count('retail_inventory_movements'," WHERE source_type='retail_offline_stock_conflict_materialization'"),incidents:count('retail_offline_stock_conflict_incidents'),receipts:count('retail_offline_stock_conflict_materialization_receipts'),balance:(await inventory.findBalance(product.id,location.id))?.onHandQuantity}
    await rejects(materializer.materialize(location.id,{offlineOperationId:envelope.offlineOperationId,commandId:'inactive-location-command'},context),/active Store Location/);equal(count('retail_sales'),before.sales);equal(count('retail_sale_items'),before.items);equal(count('retail_payment_allocations'),before.allocations);equal(count('retail_offline_sale_evidence'),before.evidence);equal(count('retail_inventory_movements'," WHERE source_type='retail_offline_stock_conflict_materialization'"),before.movements);equal(count('retail_offline_stock_conflict_incidents'),before.incidents);equal(count('retail_offline_stock_conflict_materialization_receipts'),before.receipts);equal((await inventory.findBalance(product.id,location.id))?.onHandQuantity,before.balance);equal(count('retail_offline_stock_conflict_verifications'," WHERE offline_operation_id='inactive-location-op'"),1);database.close()
  } finally { materializer.close();sync.close();authority.close();inventory.close();catalog.close();access.close();auth.close();rmSync(directory,{recursive:true,force:true}) }
})

test('Fixture B: authority expiry after eligible verification still materializes exactly once from immutable evidence', async () => {
  const directory=mkdtempSync(join(tmpdir(),'retail-conflict-expired-authority-')),file=join(directory,'x.sqlite'),admin={actorType:'user' as const,actorUserId:'admin-1',requestId:'authority-expiry'},manager={actorType:'user' as const,actorUserId:'manager-1',requestId:'authority-expiry-materialize'}
  initializeDatabase(file);const auth=new SqliteAuthRepository(file),access=new SqliteRetailAccessRepository(file),catalog=new SqliteRetailCatalogRepository(file),inventory=new SqliteRetailInventoryRepository(file),authority=new SqliteRetailOfflineAuthorityRepository(file),sync=new SqliteRetailOfflineSaleSyncRepository(file),materializer=new SqliteRetailOfflineStockConflictMaterializationRepository(file)
  try {
    for(const [id,role] of [['admin-1','admin'],['manager-1','manager'],['cashier-1','operator']] as const)await auth.createUser({id,username:id,normalizedUsername:id,email:`${id}@example.test`,role,status:'active',sessionVersion:1,createdAt:new Date(),updatedAt:new Date()})
    const location=await access.createLocation({code:'EXPIRED-CONFLICT',name:'Expired conflict',type:'store',status:'active'},admin);await access.configureCurrency(location.id,'USD',2,admin);await access.grant('manager-1',location.id,admin);const product=await catalog.createProduct({sourceId:'P-EXPIRED',name:'P'},admin);await catalog.setPrice(product.id,location.id,100,admin);await inventory.recordMovement({productId:product.id,locationId:location.id,quantityDelta:5,type:'opening',sourceType:'test',sourceId:'seed',sourceLineId:'seed'},admin)
    const pair=generateKeyPairSync('ed25519'),terminal=await authority.enrollTerminal({locationId:location.id,keyAlgorithm:RETAIL_OFFLINE_SIGNATURE_ALGORITHM,publicKey:pair.publicKey.export({format:'der',type:'spki'}).toString('base64')},admin),issued=await authority.issueAuthority({terminalId:terminal.id,userId:'cashier-1',locationId:location.id,expiresAt:new Date(Date.now()+100),permitCount:1,productIds:[product.id]},admin),permit=(await authority.listPermits(issued.id))[0]!
    const envelope={schemaVersion:1 as const,offlineOperationId:'expired-authority-op',authorityId:issued.id,authorityVersion:issued.authorityVersion,permitId:permit.id,permitSequence:permit.sequence,terminalId:terminal.id,terminalKeyVersion:1,userId:'cashier-1',locationId:location.id,proposedSaleId:'expired-authority-sale',lines:[{id:'expired-authority-item',productId:product.id,quantity:6,unitPriceMinor:100}],currencyCode:'USD',currencyExponent:2,cashAllocation:{id:'expired-authority-payment',method:'cash' as const,amountMinor:600,ordinal:0 as const},subtotalMinor:600,payableTotalMinor:600,claimedOfflineCompletedAt:'2026-09-21T00:00:00.000Z'},canonical=canonicalizeRetailOfflineEnvelope(envelope),input={envelope,payloadHash:createHash('sha256').update(canonical).digest('hex'),signature:`${RETAIL_OFFLINE_SIGNATURE_PREFIX}${sign(null,Buffer.from(canonical),pair.privateKey).toString('base64')}`}
    await rejects(sync.sync(location.id,input,admin),/VERIFIED_OFFLINE_STOCK_CONFLICT/);await new Promise(resolve=>setTimeout(resolve,125));const result=await materializer.materialize(location.id,{offlineOperationId:envelope.offlineOperationId,commandId:'expired-authority-command'},manager);equal(result.replayed,false);const proofDatabase=new DatabaseSync(file),count=(table:string,where='')=>(proofDatabase.prepare(`SELECT COUNT(*) AS count FROM ${table}${where}`).get() as {count:number}).count;equal(count('retail_sales'," WHERE status='completed'"),1);equal(count('retail_sale_items'),1);equal(count('retail_payment_allocations'," WHERE method='cash'"),1);equal(count('retail_offline_sale_evidence'),1);equal(count('retail_inventory_movements'," WHERE source_type='retail_offline_stock_conflict_materialization'"),1);equal(count('retail_offline_stock_conflict_incidents'," WHERE status='open'"),1);equal(count('retail_offline_stock_conflict_materialization_receipts'),1);proofDatabase.close()
  } finally { materializer.close();sync.close();authority.close();inventory.close();catalog.close();access.close();auth.close();rmSync(directory,{recursive:true,force:true}) }
})

async function conflictFixture(lines:Array<{stock:number;quantity:number}>,operation:string){const directory=mkdtempSync(join(tmpdir(),`retail-${operation}-`)),file=join(directory,'x.sqlite'),admin={actorType:'user' as const,actorUserId:'admin-1',requestId:operation},manager={actorType:'user' as const,actorUserId:'manager-1',requestId:`${operation}-materialize`};initializeDatabase(file);const auth=new SqliteAuthRepository(file),access=new SqliteRetailAccessRepository(file),catalog=new SqliteRetailCatalogRepository(file),inventory=new SqliteRetailInventoryRepository(file),authority=new SqliteRetailOfflineAuthorityRepository(file),sync=new SqliteRetailOfflineSaleSyncRepository(file),materializer=new SqliteRetailOfflineStockConflictMaterializationRepository(file);for(const [id,role] of [['admin-1','admin'],['manager-1','manager'],['cashier-1','operator']] as const)await auth.createUser({id,username:id,normalizedUsername:id,email:`${id}@test`,role,status:'active',sessionVersion:1,createdAt:new Date(),updatedAt:new Date()});const location=await access.createLocation({code:operation,name:operation,type:'store',status:'active'},admin);await access.configureCurrency(location.id,'USD',2,admin);const products=[] as Array<{id:string}>;for(let i=0;i<lines.length;i++){const p=await catalog.createProduct({sourceId:`${operation}-${i}`,name:`P${i}`},admin);products.push(p);await catalog.setPrice(p.id,location.id,100,admin);await inventory.recordMovement({productId:p.id,locationId:location.id,quantityDelta:lines[i]!.stock,type:'opening',sourceType:'test',sourceId:operation,sourceLineId:`seed-${i}`},admin)}const pair=generateKeyPairSync('ed25519'),terminal=await authority.enrollTerminal({locationId:location.id,keyAlgorithm:RETAIL_OFFLINE_SIGNATURE_ALGORITHM,publicKey:pair.publicKey.export({format:'der',type:'spki'}).toString('base64')},admin),issued=await authority.issueAuthority({terminalId:terminal.id,userId:'cashier-1',locationId:location.id,expiresAt:new Date(Date.now()+60_000),permitCount:1,productIds:products.map(p=>p.id)},admin),permit=(await authority.listPermits(issued.id))[0]!,amount=lines.reduce((n,l)=>n+l.quantity*100,0),envelope={schemaVersion:1 as const,offlineOperationId:operation,authorityId:issued.id,authorityVersion:issued.authorityVersion,permitId:permit.id,permitSequence:permit.sequence,terminalId:terminal.id,terminalKeyVersion:1,userId:'cashier-1',locationId:location.id,proposedSaleId:`${operation}-sale`,lines:lines.map((l,i)=>({id:`${operation}-item-${i}`,productId:products[i]!.id,quantity:l.quantity,unitPriceMinor:100})),currencyCode:'USD',currencyExponent:2,cashAllocation:{id:`${operation}-payment`,method:'cash' as const,amountMinor:amount,ordinal:0 as const},subtotalMinor:amount,payableTotalMinor:amount,claimedOfflineCompletedAt:'2026-09-21T00:00:00.000Z'},canonical=canonicalizeRetailOfflineEnvelope(envelope),input={envelope,payloadHash:createHash('sha256').update(canonical).digest('hex'),signature:`${RETAIL_OFFLINE_SIGNATURE_PREFIX}${sign(null,Buffer.from(canonical),pair.privateKey).toString('base64')}`};await rejects(sync.sync(location.id,input,admin),/VERIFIED_OFFLINE_STOCK_CONFLICT/);return{file,admin,manager,location,products,inventory,materializer,envelope,close:()=>{materializer.close();sync.close();authority.close();inventory.close();catalog.close();access.close();auth.close();try{rmSync(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100})}catch(error){if(!(error instanceof Error)||!('code'in error)||error.code!=='EPERM')throw error}}}}

test('Fixture F: multi-line mixed stock materialization creates an incident only for the independently negative line',async()=>{const f=await conflictFixture([{stock:10,quantity:2},{stock:1,quantity:4}],'mixed-stock');try{const r=await f.materializer.materialize(f.location.id,{offlineOperationId:'mixed-stock',commandId:'mixed'},f.manager),db=new DatabaseSync(f.file),count=(t:string,w='')=>(db.prepare(`SELECT COUNT(*) AS count FROM ${t}${w}`).get() as {count:number}).count;equal(r.items.length,2);equal(r.allocations.length,1);equal((await f.inventory.findBalance(f.products[0]!.id,f.location.id))?.onHandQuantity,8);equal((await f.inventory.findBalance(f.products[1]!.id,f.location.id))?.onHandQuantity,-3);equal(count('retail_sales'),1);equal(count('retail_sale_items'),2);equal(count('retail_payment_allocations'),1);equal(count('retail_offline_sale_evidence'),1);equal(count('retail_offline_stock_conflict_materialization_receipts'),1);equal(count('retail_inventory_movements'," WHERE source_type='retail_offline_stock_conflict_materialization'"),2);deepEqual(db.prepare('SELECT product_id,status FROM retail_offline_stock_conflict_incidents').all(),[{product_id:f.products[1]!.id,status:'open'}]);db.close()}finally{f.close()}})

test('Fixture G: recovered stock materialization retains the original deficit incident',async()=>{const f=await conflictFixture([{stock:1,quantity:4}],'recovered-stock');try{await f.inventory.recordMovement({productId:f.products[0]!.id,locationId:f.location.id,quantityDelta:9,type:'opening',sourceType:'test',sourceId:'recovery',sourceLineId:'recovery'},f.admin);await f.materializer.materialize(f.location.id,{offlineOperationId:'recovered-stock',commandId:'recovered'},f.manager);const db=new DatabaseSync(f.file),line=db.prepare('SELECT observed_on_hand_quantity,initial_deficit_quantity FROM retail_offline_stock_conflict_verification_lines').get() as {observed_on_hand_quantity:number;initial_deficit_quantity:number},incident=db.prepare('SELECT status,resulting_on_hand_quantity FROM retail_offline_stock_conflict_incidents').get() as {status:string;resulting_on_hand_quantity:number};deepEqual(line,{observed_on_hand_quantity:1,initial_deficit_quantity:3});deepEqual(incident,{status:'open',resulting_on_hand_quantity:6});equal((await f.inventory.findBalance(f.products[0]!.id,f.location.id))?.onHandQuantity,6);db.close()}finally{f.close()}})

test('Fixture H: a newly negative line receives an OPEN incident through the dedicated materialization seam',async()=>{const f=await conflictFixture([{stock:1,quantity:2},{stock:10,quantity:4}],'newly-negative');try{await f.inventory.recordMovement({productId:f.products[1]!.id,locationId:f.location.id,quantityDelta:-8,type:'sale',sourceType:'test',sourceId:'depletion',sourceLineId:'depletion'},f.admin);await f.materializer.materialize(f.location.id,{offlineOperationId:'newly-negative',commandId:'newly-negative'},f.manager);const db=new DatabaseSync(f.file),line=db.prepare('SELECT observed_on_hand_quantity,initial_deficit_quantity FROM retail_offline_stock_conflict_verification_lines WHERE product_id=?').get(f.products[1]!.id) as {observed_on_hand_quantity:number;initial_deficit_quantity:number},incident=db.prepare('SELECT status,resulting_on_hand_quantity FROM retail_offline_stock_conflict_incidents WHERE product_id=?').get(f.products[1]!.id) as {status:string;resulting_on_hand_quantity:number};deepEqual(line,{observed_on_hand_quantity:10,initial_deficit_quantity:0});deepEqual(incident,{status:'open',resulting_on_hand_quantity:-2});equal((await f.inventory.findBalance(f.products[1]!.id,f.location.id))?.onHandQuantity,-2);db.close()}finally{f.close()}})

test('lifecycle foundation backfills, reviews idempotently, protects history, and blocks exact unresolved pairs',async()=>{const f=await conflictFixture([{stock:1,quantity:2}],'lifecycle-foundation');try{await f.materializer.materialize(f.location.id,{offlineOperationId:'lifecycle-foundation',commandId:'materialize'},f.manager);const lifecycle=new SqliteRetailOfflineStockConflictLifecycleRepository(f.file),item=f.envelope.lines[0]!.id;const initial=await lifecycle.getCurrentState('lifecycle-foundation',item) as {current_state:string;version:number};equal(initial.current_state,'open');equal(initial.version,1);equal(await lifecycle.isProductLocationBlocked(f.products[0]!.id,f.location.id),true);equal(await lifecycle.isProductLocationBlocked(f.products[0]!.id,'other-location'),false);const input={offlineOperationId:'lifecycle-foundation',saleItemId:item,commandId:'review-1',expectedCurrentState:'open' as const,targetState:'under_review' as const,actorUserId:'manager-1'};const first=await lifecycle.review(f.location.id,input)as {current_state:string;version:number};equal(first.current_state,'under_review');equal(first.version,2);await lifecycle.review(f.location.id,input);equal((await lifecycle.listEvents('lifecycle-foundation',item)).length,1);await rejects(lifecycle.review(f.location.id,{...input,commandId:'review-2'},),/STALE_INCIDENT_STATE/);await rejects(lifecycle.review(f.location.id,{...input,commandId:'review-1',actorUserId:'admin-1'}),/IDEMPOTENCY_CONFLICT/);const db=new DatabaseSync(f.file);throws(()=>db.prepare("UPDATE retail_offline_stock_conflict_incident_events SET command_id='x'").run(),/immutable/);throws(()=>db.prepare("DELETE FROM retail_offline_stock_conflict_incident_lifecycle").run(),/cannot be deleted/);throws(()=>db.prepare("UPDATE retail_offline_stock_conflict_incident_lifecycle SET current_state='open'").run(),/transition is invalid/);db.close();lifecycle.close()}finally{f.close()}})

test('lifecycle invalid transition, late failure rollback, and independent double command are deterministic',async()=>{const f=await conflictFixture([{stock:1,quantity:2}],'lifecycle-atomic');try{await f.materializer.materialize(f.location.id,{offlineOperationId:'lifecycle-atomic',commandId:'materialize'},f.manager);const a=new SqliteRetailOfflineStockConflictLifecycleRepository(f.file),b=new SqliteRetailOfflineStockConflictLifecycleRepository(f.file),item=f.envelope.lines[0]!.id,base={offlineOperationId:'lifecycle-atomic',saleItemId:item,expectedCurrentState:'open' as const,targetState:'under_review' as const,actorUserId:'manager-1'};await rejects(a.review(f.location.id,{...base,commandId:'invalid',targetState:'resolved' as never}),/INVALID_INCIDENT_TRANSITION/);const guard=new DatabaseSync(f.file);guard.exec("CREATE TRIGGER fail_lifecycle_update BEFORE UPDATE ON retail_offline_stock_conflict_incident_lifecycle BEGIN SELECT RAISE(ABORT,'forced lifecycle failure'); END;");await rejects(a.review(f.location.id,{...base,commandId:'fail'}),/forced lifecycle failure/);guard.exec('DROP TRIGGER fail_lifecycle_update');equal((await a.getCurrentState('lifecycle-atomic',item) as {current_state:string;version:number}).current_state,'open');equal((await a.listEvents('lifecycle-atomic',item)).length,0);const first=await a.review(f.location.id,{...base,commandId:'one'});equal((first as {version:number}).version,2);await rejects(b.review(f.location.id,{...base,commandId:'two'}),/STALE_INCIDENT_STATE/);equal((await a.listEvents('lifecycle-atomic',item)).length,1);throws(()=>guard.prepare("DELETE FROM retail_offline_stock_conflict_incident_events").run(),/immutable/);throws(()=>guard.prepare("UPDATE retail_offline_stock_conflict_incidents SET status='open'").run(),/immutable/);throws(()=>guard.prepare("DELETE FROM retail_offline_stock_conflict_incidents").run(),/immutable/);guard.close();a.close();b.close()}finally{f.close()}})

test('Fixture P: materialization rolls incident and lifecycle projection back with late projection failure',async()=>{const f=await conflictFixture([{stock:1,quantity:2}],'projection-rollback');try{const guard=new DatabaseSync(f.file);guard.exec("CREATE TRIGGER fail_projection BEFORE INSERT ON retail_offline_stock_conflict_incident_lifecycle BEGIN SELECT RAISE(ABORT,'forced projection failure'); END;");await rejects(f.materializer.materialize(f.location.id,{offlineOperationId:'projection-rollback',commandId:'projection-fail'},f.manager),/forced projection failure/);const count=(table:string)=>(guard.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()as{count:number}).count;equal(count('retail_sales'),0);equal(count('retail_sale_items'),0);equal(count('retail_payment_allocations'),0);equal(count('retail_offline_sale_evidence'),0);equal(count('retail_inventory_movements'),1);equal(count('retail_offline_stock_conflict_incidents'),0);equal(count('retail_offline_stock_conflict_incident_lifecycle'),0);equal(count('retail_offline_stock_conflict_incident_events'),0);equal(count('retail_offline_stock_conflict_materialization_receipts'),0);equal(count('retail_offline_stock_conflict_verifications'),1);equal((await f.inventory.findBalance(f.products[0]!.id,f.location.id))?.onHandQuantity,1);guard.close()}finally{f.close()}})

test(
  'Fixture M real same Product and Location incidents retain independent unresolved lifecycle state',
  async () => {
    const f = await conflictFixture(
      [{ stock: 1, quantity: 2 }],
      'multi-conflict-op-1',
    );

    try {
      const authority = new SqliteRetailOfflineAuthorityRepository(f.file);
      const sync = new SqliteRetailOfflineSaleSyncRepository(f.file);
      const catalog = new SqliteRetailCatalogRepository(f.file);

      const productB = await catalog.createProduct(
        {
          sourceId: 'multi-conflict-product-b',
          name: 'Product B',
        },
        f.admin,
      );

      const pair = generateKeyPairSync('ed25519');

      const terminal = await authority.enrollTerminal(
        {
          locationId: f.location.id,
          keyAlgorithm: RETAIL_OFFLINE_SIGNATURE_ALGORITHM,
          publicKey: pair.publicKey
            .export({ format: 'der', type: 'spki' })
            .toString('base64'),
        },
        f.admin,
      );

      const issued = await authority.issueAuthority(
        {
          terminalId: terminal.id,
          userId: 'cashier-1',
          locationId: f.location.id,
          expiresAt: new Date(Date.now() + 60_000),
          permitCount: 1,
          productIds: [f.products[0]!.id],
        },
        f.admin,
      );

      const permit = (await authority.listPermits(issued.id))[0]!;

      const second = {
        ...f.envelope,
        offlineOperationId: 'multi-conflict-op-2',
        authorityId: issued.id,
        authorityVersion: issued.authorityVersion,
        permitId: permit.id,
        permitSequence: permit.sequence,
        terminalId: terminal.id,
        proposedSaleId: 'multi-conflict-sale-2',
        lines: [
          {
            ...f.envelope.lines[0]!,
            id: 'multi-conflict-item-2',
          },
        ],
        cashAllocation: {
          ...f.envelope.cashAllocation,
          id: 'multi-conflict-payment-2',
        },
      };

      const canonical = canonicalizeRetailOfflineEnvelope(second);

      const input = {
        envelope: second,
        payloadHash: createHash('sha256')
          .update(canonical)
          .digest('hex'),
        signature: `${RETAIL_OFFLINE_SIGNATURE_PREFIX}${sign(
          null,
          Buffer.from(canonical),
          pair.privateKey,
        ).toString('base64')}`,
      };

      await f.materializer.materialize(
        f.location.id,
        {
          offlineOperationId: 'multi-conflict-op-1',
          commandId: 'multi-materialize-1',
        },
        f.manager,
      );

      await f.inventory.recordMovement(
        {
          productId: f.products[0]!.id,
          locationId: f.location.id,
          quantityDelta: 2,
          type: 'goods_receipt',
          sourceType: 'test',
          sourceId: 'multi-conflict-restock',
          sourceLineId: 'multi-conflict-restock',
        },
        f.admin,
      );

      await rejects(
        sync.sync(f.location.id, input, f.admin),
        /VERIFIED_OFFLINE_STOCK_CONFLICT/,
      );

      await f.materializer.materialize(
        f.location.id,
        {
          offlineOperationId: 'multi-conflict-op-2',
          commandId: 'multi-materialize-2',
        },
        f.manager,
      );

      const lifecycle =
        new SqliteRetailOfflineStockConflictLifecycleRepository(f.file);

      const one = await lifecycle.getCurrentState(
        'multi-conflict-op-1',
        f.envelope.lines[0]!.id,
      ) as {
        current_state: string;
        version: number;
      };

      const two = await lifecycle.getCurrentState(
        'multi-conflict-op-2',
        'multi-conflict-item-2',
      ) as {
        current_state: string;
        version: number;
        updated_at: string;
        updated_by: string;
      };

      const proof = new DatabaseSync(f.file);

      const unresolved = proof
        .prepare(
          "SELECT offline_operation_id FROM retail_offline_stock_conflict_incident_lifecycle WHERE product_id=? AND location_id=? AND current_state IN ('open','under_review') ORDER BY offline_operation_id",
        )
        .all(
          f.products[0]!.id,
          f.location.id,
        ) as Array<{ offline_operation_id: string }>;

      deepEqual(unresolved, [
        { offline_operation_id: 'multi-conflict-op-1' },
        { offline_operation_id: 'multi-conflict-op-2' },
      ]);

      proof.close();

      equal(one.current_state, 'open');
      equal(one.version, 1);
      equal(two.current_state, 'open');
      equal(two.version, 1);

      await lifecycle.review(
        f.location.id,
        {
          offlineOperationId: 'multi-conflict-op-1',
          saleItemId: f.envelope.lines[0]!.id,
          commandId: 'multi-review-1',
          expectedCurrentState: 'open',
          targetState: 'under_review',
          actorUserId: 'manager-1',
        },
      );

      const finalOne = await lifecycle.getCurrentState(
        'multi-conflict-op-1',
        f.envelope.lines[0]!.id,
      ) as {
        current_state: string;
        version: number;
      };

      const finalTwo = await lifecycle.getCurrentState(
        'multi-conflict-op-2',
        'multi-conflict-item-2',
      ) as {
        current_state: string;
        version: number;
        updated_at: string;
        updated_by: string;
      };

      equal(finalOne.current_state, 'under_review');
      equal(finalOne.version, 2);
      deepEqual(finalTwo, two);

      const firstEvents = await lifecycle.listEvents(
        'multi-conflict-op-1',
        f.envelope.lines[0]!.id,
      );

      equal(
        (
          firstEvents as Array<{
            event_type: string;
            previous_state: string;
            resulting_state: string;
          }>
        ).length,
        1,
      );

      equal(
        (
          firstEvents[0] as {
            event_type: string;
            previous_state: string;
            resulting_state: string;
          }
        ).event_type,
        'review_started',
      );

      equal(
        (
          firstEvents[0] as {
            event_type: string;
            previous_state: string;
            resulting_state: string;
          }
        ).previous_state,
        'open',
      );

      equal(
        (
          firstEvents[0] as {
            event_type: string;
            previous_state: string;
            resulting_state: string;
          }
        ).resulting_state,
        'under_review',
      );

      equal(
        (
          await lifecycle.listEvents(
            'multi-conflict-op-2',
            'multi-conflict-item-2',
          )
        ).length,
        0,
      );

      equal(
        await lifecycle.isProductLocationBlocked(
          f.products[0]!.id,
          f.location.id,
        ),
        true,
      );

      equal(
        await lifecycle.isProductLocationBlocked(
          f.products[0]!.id,
          'other-location',
        ),
        false,
      );

      equal(
        await lifecycle.isProductLocationBlocked(
          productB.id,
          f.location.id,
        ),
        false,
      );

      const resolved = await lifecycle.resolve(f.location.id, {
        offlineOperationId: 'multi-conflict-op-1',
        saleItemId: f.envelope.lines[0]!.id,
        commandId: 'multi-resolve-1',
        expectedCurrentState: 'under_review',
        disposition: 'confirmed',
        reason: 'review complete',
        evidence: 'inventory recount',
        correctiveRecord: { type: 'reconciliation', id: 'reconciliation-1' },
        actorUserId: 'manager-1',
      }) as { current_state: string; version: number };

      equal(resolved.current_state, 'resolved');
      equal(resolved.version, 3);
      equal(
        await lifecycle.isProductLocationBlocked(
          f.products[0]!.id,
          f.location.id,
        ),
        true,
      );

      lifecycle.close();
      catalog.close();
      sync.close();
      authority.close();
    } finally {
      f.close();
    }
  },
);
test('D.2A outbound operations block only unresolved exact Product and Location pairs',async()=>{const f=await conflictFixture([{stock:1,quantity:2}],'d2a-block');try{await f.materializer.materialize(f.location.id,{offlineOperationId:'d2a-block',commandId:'d2a-materialize'},f.manager);await f.inventory.recordMovement({productId:f.products[0]!.id,locationId:f.location.id,quantityDelta:5,type:'goods_receipt',sourceType:'test',sourceId:'d2a-restock',sourceLineId:'d2a-restock'},f.admin);const catalog=new SqliteRetailCatalogRepository(f.file),access=new SqliteRetailAccessRepository(f.file),sales=new SqliteRetailSaleRepository(f.file),transfers=new SqliteRetailTransferRepository(f.file),clean=await catalog.createProduct({sourceId:'d2a-clean',name:'Clean'},f.admin),other=await access.createLocation({code:'D2A-OTHER',name:'Other',type:'store',status:'active'},f.admin);await access.configureCurrency(other.id,'USD',2,f.admin);await catalog.setPrice(clean.id,f.location.id,100,f.admin);await catalog.setPrice(f.products[0]!.id,other.id,100,f.admin);await catalog.setPrice(clean.id,other.id,100,f.admin);await f.inventory.recordMovement({productId:clean.id,locationId:f.location.id,quantityDelta:5,type:'opening',sourceType:'test',sourceId:'d2a-clean',sourceLineId:'d2a-clean'},f.admin);await f.inventory.recordMovement({productId:f.products[0]!.id,locationId:other.id,quantityDelta:5,type:'opening',sourceType:'test',sourceId:'d2a-other',sourceLineId:'d2a-other'},f.admin);const blocked={clientOperationId:'d2a-blocked',saleId:'d2a-blocked',lines:[{id:'d2a-blocked-line',productId:f.products[0]!.id,quantity:1}],allocations:[{id:'d2a-blocked-payment',method:'cash' as const,amountMinor:100,ordinal:0}]};await rejects(sales.complete(f.location.id,blocked,f.admin),/RETAIL_PRODUCT_LOCATION_CONFLICT_BLOCKED/);const db=new DatabaseSync(f.file);equal((db.prepare("SELECT COUNT(*) AS count FROM retail_sales WHERE id='d2a-blocked'").get()as{count:number}).count,0);db.close();await rejects(sales.complete(f.location.id,{clientOperationId:'d2a-multi',saleId:'d2a-multi',lines:[{id:'d2a-clean-line',productId:clean.id,quantity:1},{id:'d2a-blocked-line-2',productId:f.products[0]!.id,quantity:1}],allocations:[{id:'d2a-multi-payment',method:'cash',amountMinor:200,ordinal:0}]},f.admin),/RETAIL_PRODUCT_LOCATION_CONFLICT_BLOCKED/);equal((await f.inventory.findBalance(clean.id,f.location.id))?.onHandQuantity,5);equal((await sales.complete(f.location.id,{clientOperationId:'d2a-clean-sale',saleId:'d2a-clean-sale',lines:[{id:'d2a-clean-sale-line',productId:clean.id,quantity:1}],allocations:[{id:'d2a-clean-sale-payment',method:'cash',amountMinor:100,ordinal:0}]},f.admin)).replayed,false);equal((await sales.complete(other.id,{clientOperationId:'d2a-other-sale',saleId:'d2a-other-sale',lines:[{id:'d2a-other-sale-line',productId:f.products[0]!.id,quantity:1}],allocations:[{id:'d2a-other-sale-payment',method:'cash',amountMinor:100,ordinal:0}]},f.admin)).replayed,false);const lifecycle=new SqliteRetailOfflineStockConflictLifecycleRepository(f.file),item=f.envelope.lines[0]!.id;await lifecycle.review(f.location.id,{offlineOperationId:'d2a-block',saleItemId:item,commandId:'d2a-review',expectedCurrentState:'open',targetState:'under_review',actorUserId:'manager-1'});await rejects(sales.complete(f.location.id,{...blocked,clientOperationId:'d2a-review-blocked',saleId:'d2a-review-blocked',lines:[{id:'d2a-review-blocked-line',productId:f.products[0]!.id,quantity:1}],allocations:[{id:'d2a-review-blocked-payment',method:'cash',amountMinor:100,ordinal:0}]},f.manager),/RETAIL_PRODUCT_LOCATION_CONFLICT_BLOCKED/);const outbound=await transfers.create({sourceLocationId:f.location.id,destinationLocationId:other.id,lines:[{productId:f.products[0]!.id,quantity:1}]},f.admin);await rejects(transfers.dispatch(outbound.id,f.admin),/RETAIL_PRODUCT_LOCATION_CONFLICT_BLOCKED/);equal((await transfers.find(outbound.id))?.status,'draft');const inbound=await transfers.create({sourceLocationId:other.id,destinationLocationId:f.location.id,lines:[{productId:f.products[0]!.id,quantity:1}]},f.admin);await transfers.dispatch(inbound.id,f.admin);await transfers.receive(inbound.id,f.admin);equal((await transfers.find(inbound.id))?.status,'received');lifecycle.close();transfers.close();sales.close();access.close();catalog.close()}finally{f.close()}})

test('D.2A Fixture G preserves an accepted Sale replay after later materialization',async()=>{const f=await conflictFixture([{stock:5,quantity:10}],'d2a-g-conflict');try{const sales=new SqliteRetailSaleRepository(f.file),input={clientOperationId:'d2a-g-sale',saleId:'d2a-g-sale',lines:[{id:'d2a-g-item',productId:f.products[0]!.id,quantity:1}],allocations:[{id:'d2a-g-payment',method:'cash' as const,amountMinor:100,ordinal:0}]},first=await sales.complete(f.location.id,input,f.admin),postSale=(await f.inventory.findBalance(f.products[0]!.id,f.location.id))!.onHandQuantity;equal(first.replayed,false);equal(postSale,4);await f.materializer.materialize(f.location.id,{offlineOperationId:'d2a-g-conflict',commandId:'d2a-g-materialize'},f.manager);const lifecycle=new SqliteRetailOfflineStockConflictLifecycleRepository(f.file);equal(await lifecycle.isProductLocationBlocked(f.products[0]!.id,f.location.id),true);const db=new DatabaseSync(f.file),counts=()=>({sales:(db.prepare("SELECT COUNT(*) AS count FROM retail_sales WHERE id='d2a-g-sale'").get()as{count:number}).count,items:(db.prepare("SELECT COUNT(*) AS count FROM retail_sale_items WHERE sale_id='d2a-g-sale'").get()as{count:number}).count,payments:(db.prepare("SELECT COUNT(*) AS count FROM retail_payment_allocations WHERE sale_id='d2a-g-sale'").get()as{count:number}).count,movements:(db.prepare("SELECT COUNT(*) AS count FROM retail_inventory_movements WHERE source_type='retail_sale' AND source_id='d2a-g-sale'").get()as{count:number}).count,receipts:(db.prepare("SELECT COUNT(*) AS count FROM retail_operation_receipts WHERE client_operation_id='d2a-g-sale'").get()as{count:number}).count}),before=counts(),replay=await sales.complete(f.location.id,input,f.admin);equal(replay.replayed,true);deepEqual(counts(),before);equal((await f.inventory.findBalance(f.products[0]!.id,f.location.id))?.onHandQuantity,-6);await rejects(sales.complete(f.location.id,{...input,saleId:'d2a-g-changed'},f.admin),/IDEMPOTENCY_CONFLICT/);db.close();lifecycle.close();sales.close()}finally{f.close()}})

test('D.2A Fixture K rejects a multi-line Transfer atomically when one source pair is unresolved',async()=>{const f=await conflictFixture([{stock:5,quantity:10}],'d2a-k');try{await f.materializer.materialize(f.location.id,{offlineOperationId:'d2a-k',commandId:'d2a-k-materialize'},f.manager);await f.inventory.recordMovement({productId:f.products[0]!.id,locationId:f.location.id,quantityDelta:10,type:'goods_receipt',sourceType:'test',sourceId:'d2a-k-restock',sourceLineId:'d2a-k-restock'},f.admin);const catalog=new SqliteRetailCatalogRepository(f.file),access=new SqliteRetailAccessRepository(f.file),transfers=new SqliteRetailTransferRepository(f.file),clean=await catalog.createProduct({sourceId:'d2a-k-clean',name:'Clean'},f.admin),destination=await access.createLocation({code:'D2A-K-DST',name:'Destination',type:'store',status:'active'},f.admin);await f.inventory.recordMovement({productId:clean.id,locationId:f.location.id,quantityDelta:5,type:'opening',sourceType:'test',sourceId:'d2a-k-clean',sourceLineId:'d2a-k-clean'},f.admin);const blocked=await transfers.create({sourceLocationId:f.location.id,destinationLocationId:destination.id,lines:[{productId:clean.id,quantity:1},{productId:f.products[0]!.id,quantity:1}]},f.admin),beforeClean=(await f.inventory.findBalance(clean.id,f.location.id))!.onHandQuantity,beforeBlocked=(await f.inventory.findBalance(f.products[0]!.id,f.location.id))!.onHandQuantity;await rejects(transfers.dispatch(blocked.id,f.admin),/RETAIL_PRODUCT_LOCATION_CONFLICT_BLOCKED/);equal((await transfers.find(blocked.id))?.status,'draft');equal((await f.inventory.findBalance(clean.id,f.location.id))?.onHandQuantity,beforeClean);equal((await f.inventory.findBalance(f.products[0]!.id,f.location.id))?.onHandQuantity,beforeBlocked);const db=new DatabaseSync(f.file);equal((db.prepare("SELECT COUNT(*) AS count FROM retail_inventory_movements WHERE source_type='retail_transfer_dispatched' AND source_id=?").get(blocked.id)as{count:number}).count,0);equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action='retail.transfer_dispatched' AND entity_id=?").get(blocked.id)as{count:number}).count,0);db.close();const cleanOnly=await transfers.create({sourceLocationId:f.location.id,destinationLocationId:destination.id,lines:[{productId:clean.id,quantity:1}]},f.admin);await transfers.dispatch(cleanOnly.id,f.admin);equal((await transfers.find(cleanOnly.id))?.status,'dispatched');transfers.close();access.close();catalog.close()}finally{f.close()}})

test('D.2A Fixture N preserves successful Transfer dispatch replay after later materialization',async()=>{const f=await conflictFixture([{stock:5,quantity:10}],'d2a-n');try{const access=new SqliteRetailAccessRepository(f.file),transfers=new SqliteRetailTransferRepository(f.file),destination=await access.createLocation({code:'D2A-N-DST',name:'Destination',type:'store',status:'active'},f.admin),transfer=await transfers.create({sourceLocationId:f.location.id,destinationLocationId:destination.id,lines:[{productId:f.products[0]!.id,quantity:1}]},f.admin);const first=await transfers.dispatch(transfer.id,f.admin),postDispatch=(await f.inventory.findBalance(f.products[0]!.id,f.location.id))!.onHandQuantity;equal(first.status,'dispatched');equal(postDispatch,4);await f.materializer.materialize(f.location.id,{offlineOperationId:'d2a-n',commandId:'d2a-n-materialize'},f.manager);const lifecycle=new SqliteRetailOfflineStockConflictLifecycleRepository(f.file);equal(await lifecycle.isProductLocationBlocked(f.products[0]!.id,f.location.id),true);const db=new DatabaseSync(f.file),before=(db.prepare("SELECT COUNT(*) AS count FROM retail_inventory_movements WHERE source_type='retail_transfer_dispatched' AND source_id=?").get(transfer.id)as{count:number}).count,replay=await transfers.dispatch(transfer.id,f.admin);equal(replay.status,'dispatched');equal((db.prepare("SELECT COUNT(*) AS count FROM retail_inventory_movements WHERE source_type='retail_transfer_dispatched' AND source_id=?").get(transfer.id)as{count:number}).count,before);equal((await f.inventory.findBalance(f.products[0]!.id,f.location.id))?.onHandQuantity,-6);db.close();lifecycle.close();transfers.close();access.close()}finally{f.close()}})

test('resolution persists evidence atomically, replays idempotently, and unblocks a resolved exact pair',async()=>{
  const f=await conflictFixture([{stock:1,quantity:2}],'resolution');
  try {
    await f.materializer.materialize(f.location.id,{offlineOperationId:'resolution',commandId:'resolution-materialize'},f.manager);
    const lifecycle=new SqliteRetailOfflineStockConflictLifecycleRepository(f.file),item=f.envelope.lines[0]!.id;
    const input={offlineOperationId:'resolution',saleItemId:item,commandId:'resolution-command',expectedCurrentState:'under_review' as const,disposition:'confirmed',reason:'count verified',evidence:'signed recount',correctiveRecord:{type:'reconciliation',id:'reconciliation-1'},actorUserId:'manager-1'};
    await rejects(lifecycle.resolve(f.location.id,input),/STALE_INCIDENT_STATE/);
    for(const [field,commandId] of [['disposition','missing-disposition'],['reason','missing-reason'],['evidence','missing-evidence']] as const) await rejects(lifecycle.resolve(f.location.id,{...input,commandId,[field]:''}),/required/);
    await rejects(lifecycle.resolve(f.location.id,{...input,commandId:'missing-record-type',correctiveRecord:{...input.correctiveRecord,type:''}}),/required/);
    await rejects(lifecycle.resolve(f.location.id,{...input,commandId:'missing-record-id',correctiveRecord:{...input.correctiveRecord,id:''}}),/required/);
    await lifecycle.review(f.location.id,{offlineOperationId:'resolution',saleItemId:item,commandId:'resolution-review',expectedCurrentState:'open',targetState:'under_review',actorUserId:'manager-1'});
    const proof=new DatabaseSync(f.file);proof.prepare("UPDATE retail_products SET status='inactive' WHERE id=?").run(f.products[0]!.id);
    const first=await lifecycle.resolve(f.location.id,input) as {current_state:string;version:number};equal(first.current_state,'resolved');equal(first.version,3);equal(await lifecycle.isProductLocationBlocked(f.products[0]!.id,f.location.id),false);
    const event=proof.prepare("SELECT event_id,event_type,previous_state,resulting_state,actor_user_id FROM retail_offline_stock_conflict_incident_events WHERE command_id=?").get(input.commandId) as {event_id:string;event_type:string;previous_state:string;resulting_state:string;actor_user_id:string};deepEqual(event.event_type,'resolved');deepEqual(event.previous_state,'under_review');deepEqual(event.resulting_state,'resolved');deepEqual(event.actor_user_id,'manager-1');
    deepEqual(proof.prepare('SELECT disposition,reason,evidence,corrective_record_type,corrective_record_id FROM retail_offline_stock_conflict_resolution_evidence WHERE event_id=?').get(event.event_id),{disposition:'confirmed',reason:'count verified',evidence:'signed recount',corrective_record_type:'reconciliation',corrective_record_id:'reconciliation-1'});
    const replay=await lifecycle.resolve(f.location.id,input) as {current_state:string;version:number};deepEqual(replay,first);equal((proof.prepare("SELECT COUNT(*) AS count FROM retail_offline_stock_conflict_incident_events WHERE command_id=?").get(input.commandId)as{count:number}).count,1);equal((proof.prepare('SELECT COUNT(*) AS count FROM retail_offline_stock_conflict_resolution_evidence').get()as{count:number}).count,1);
    await rejects(lifecycle.resolve(f.location.id,{...input,evidence:'changed'}),/IDEMPOTENCY_CONFLICT/);proof.close();lifecycle.close();
  } finally { f.close() }
})

test('resolution rolls back event and evidence when the projection update fails',async()=>{
  const f=await conflictFixture([{stock:1,quantity:2}],'resolution-rollback');
  try {
    await f.materializer.materialize(f.location.id,{offlineOperationId:'resolution-rollback',commandId:'resolution-rollback-materialize'},f.manager);
    const lifecycle=new SqliteRetailOfflineStockConflictLifecycleRepository(f.file),item=f.envelope.lines[0]!.id;
    await lifecycle.review(f.location.id,{offlineOperationId:'resolution-rollback',saleItemId:item,commandId:'resolution-rollback-review',expectedCurrentState:'open',targetState:'under_review',actorUserId:'manager-1'});
    const proof=new DatabaseSync(f.file);proof.exec("CREATE TRIGGER fail_resolution_projection BEFORE UPDATE ON retail_offline_stock_conflict_incident_lifecycle WHEN NEW.current_state='resolved' BEGIN SELECT RAISE(ABORT,'forced resolution projection failure'); END;");
    await rejects(lifecycle.resolve(f.location.id,{offlineOperationId:'resolution-rollback',saleItemId:item,commandId:'resolution-rollback-command',expectedCurrentState:'under_review',disposition:'confirmed',reason:'count verified',evidence:'signed recount',correctiveRecord:{type:'reconciliation',id:'reconciliation-rollback'},actorUserId:'manager-1'}),/forced resolution projection failure/);
    equal((proof.prepare("SELECT COUNT(*) AS count FROM retail_offline_stock_conflict_incident_events WHERE event_type='resolved'").get()as{count:number}).count,0);equal((proof.prepare('SELECT COUNT(*) AS count FROM retail_offline_stock_conflict_resolution_evidence').get()as{count:number}).count,0);deepEqual(proof.prepare('SELECT current_state,version FROM retail_offline_stock_conflict_incident_lifecycle WHERE offline_operation_id=? AND sale_item_id=?').get('resolution-rollback',item),{current_state:'under_review',version:2});proof.close();lifecycle.close();
  } finally { f.close() }
})
