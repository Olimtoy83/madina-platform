import { equal, rejects } from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { RETAIL_OFFLINE_SIGNATURE_ALGORITHM, RETAIL_OFFLINE_SIGNATURE_PREFIX, canonicalizeRetailOfflineEnvelope } from '@madina/retail'
import { initializeDatabase } from '../migrations/initializeDatabase.js'
import { SqliteAuthRepository } from '../auth/SqliteAuthRepository.js'
import { SqliteRetailAccessRepository } from './SqliteRetailAccessRepository.js'
import { SqliteRetailCatalogRepository } from './SqliteRetailCatalogRepository.js'
import { SqliteRetailInventoryRepository } from './SqliteRetailInventoryRepository.js'
import { SqliteRetailOfflineAuthorityRepository } from './SqliteRetailOfflineAuthorityRepository.js'
import { SqliteRetailOfflineSaleSyncRepository } from './SqliteRetailOfflineSaleSyncRepository.js'
import { SqliteRetailSaleReturnRepository } from './SqliteRetailSaleReturnRepository.js'

test('verified offline sync is idempotent, preserves inactive historical authority products, and fails closed for stock', async () => {
  const directory=mkdtempSync(join(tmpdir(),'retail-offline-sync-')),file=join(directory,'x.sqlite')
  const context={actorType:'user' as const,actorUserId:'admin-1',requestId:'offline-sync'}
  initializeDatabase(file); const auth=new SqliteAuthRepository(file),access=new SqliteRetailAccessRepository(file),catalog=new SqliteRetailCatalogRepository(file),inventory=new SqliteRetailInventoryRepository(file),authority=new SqliteRetailOfflineAuthorityRepository(file),sync=new SqliteRetailOfflineSaleSyncRepository(file),returns=new SqliteRetailSaleReturnRepository(file)
  try {
    await auth.createUser({id:'admin-1',username:'Admin',normalizedUsername:'admin',email:'admin@example.test',role:'admin',status:'active',sessionVersion:1,createdAt:new Date(),updatedAt:new Date()});await auth.createUser({id:'cashier-1',username:'Cashier',normalizedUsername:'cashier',email:'cashier@example.test',role:'operator',status:'active',sessionVersion:1,createdAt:new Date(),updatedAt:new Date()})
    const location=await access.createLocation({code:'SYNC',name:'Sync',type:'store',status:'active'},context);await access.configureCurrency(location.id,'USD',2,context);const product=await catalog.createProduct({sourceId:'P',name:'P'},context);await catalog.setPrice(product.id,location.id,100,context);await inventory.recordMovement({productId:product.id,locationId:location.id,quantityDelta:5,type:'opening',sourceType:'test',sourceId:'seed',sourceLineId:'line'},context)
    const pair=generateKeyPairSync('ed25519'),terminal=await authority.enrollTerminal({locationId:location.id,keyAlgorithm:RETAIL_OFFLINE_SIGNATURE_ALGORITHM,publicKey:pair.publicKey.export({format:'der',type:'spki'}).toString('base64')},context),issued=await authority.issueAuthority({terminalId:terminal.id,userId:'cashier-1',locationId:location.id,expiresAt:new Date(Date.now()+60000),permitCount:2,productIds:[product.id]},context),permits=await authority.listPermits(issued.id)
    await catalog.updateProduct(product.id,{name:'P',status:'inactive'},context)
    const envelope={schemaVersion:1 as const,offlineOperationId:'op-1',authorityId:issued.id,authorityVersion:issued.authorityVersion,permitId:permits[0]!.id,permitSequence:permits[0]!.sequence,terminalId:terminal.id,terminalKeyVersion:1,userId:'cashier-1',locationId:location.id,proposedSaleId:'sale-1',lines:[{id:'item-1',productId:product.id,quantity:3,unitPriceMinor:100}],currencyCode:'USD',currencyExponent:2,cashAllocation:{id:'payment-1',method:'cash' as const,amountMinor:300,ordinal:0 as const},subtotalMinor:300,payableTotalMinor:300,claimedOfflineCompletedAt:'2026-09-20T00:00:00.000Z'}
    const canonical=canonicalizeRetailOfflineEnvelope(envelope),input={envelope,payloadHash:createHash('sha256').update(canonical).digest('hex'),signature:`${RETAIL_OFFLINE_SIGNATURE_PREFIX}${sign(null,Buffer.from(canonical),pair.privateKey).toString('base64')}`}
    await rejects(sync.sync(location.id,{...input,signature:`${input.signature.slice(0,-1)}${input.signature.endsWith('A')?'B':'A'}`},context),/signature (is invalid|verification failed)/);equal((await inventory.findBalance(product.id,location.id))?.onHandQuantity,5)
    const failureDatabase=new DatabaseSync(file);failureDatabase.exec("CREATE TRIGGER test_fail_offline_sync_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'forced offline sync audit failure'); END;")
    await rejects(sync.sync(location.id,input,context),/forced offline sync audit failure/);equal((failureDatabase.prepare('SELECT COUNT(*) AS count FROM retail_sales').get() as {count:number}).count,0);equal((failureDatabase.prepare('SELECT COUNT(*) AS count FROM retail_offline_sale_sync_receipts').get() as {count:number}).count,0);equal((failureDatabase.prepare('SELECT COUNT(*) AS count FROM retail_offline_sale_evidence').get() as {count:number}).count,0);failureDatabase.exec('DROP TRIGGER test_fail_offline_sync_audit');failureDatabase.close();equal((await inventory.findBalance(product.id,location.id))?.onHandQuantity,5)
    equal((await sync.sync(location.id,input,context)).replayed,false);equal((await sync.sync(location.id,input,context)).replayed,true);equal((await inventory.findBalance(product.id,location.id))?.onHandQuantity,2)
    const changed={...envelope,lines:[{...envelope.lines[0]!,quantity:4}],subtotalMinor:400,payableTotalMinor:400,cashAllocation:{...envelope.cashAllocation,amountMinor:400}},changedCanonical=canonicalizeRetailOfflineEnvelope(changed),changedInput={envelope:changed,payloadHash:createHash('sha256').update(changedCanonical).digest('hex'),signature:`${RETAIL_OFFLINE_SIGNATURE_PREFIX}${sign(null,Buffer.from(changedCanonical),pair.privateKey).toString('base64')}`};await rejects(sync.sync(location.id,changedInput,context),/IDEMPOTENCY_CONFLICT/)
    const insufficient={...envelope,offlineOperationId:'op-2',permitId:permits[1]!.id,permitSequence:permits[1]!.sequence,proposedSaleId:'sale-2',lines:[{...envelope.lines[0]!,id:'item-2',quantity:3}],subtotalMinor:300,payableTotalMinor:300,cashAllocation:{...envelope.cashAllocation,id:'payment-2'}};const insufficientCanonical=canonicalizeRetailOfflineEnvelope(insufficient);await rejects(sync.sync(location.id,{envelope:insufficient,payloadHash:createHash('sha256').update(insufficientCanonical).digest('hex'),signature:`${RETAIL_OFFLINE_SIGNATURE_PREFIX}${sign(null,Buffer.from(insufficientCanonical),pair.privateKey).toString('base64')}`},context),/VERIFIED_OFFLINE_STOCK_CONFLICT/);equal((await inventory.findBalance(product.id,location.id))?.onHandQuantity,2)
    const completed=await returns.findCompletedSale(location.id,'sale-1');equal(completed?.paymentAllocations.length,1);equal((completed?.paymentAllocations[0] as {method:string}).method,'cash');await returns.complete(location.id,{clientOperationId:'return-1',originalSaleId:'sale-1',items:[{saleItemId:'item-1',quantity:3}]},context);equal((await inventory.findBalance(product.id,location.id))?.onHandQuantity,5)
  } finally { returns.close();sync.close();authority.close();inventory.close();catalog.close();access.close();auth.close();rmSync(directory,{recursive:true,force:true}) }
})
