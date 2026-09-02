import { equal, rejects } from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { initializeDatabase } from '../migrations/initializeDatabase.js'
import { SqliteRetailAccessRepository } from './SqliteRetailAccessRepository.js'
import { SqliteRetailCatalogRepository } from './SqliteRetailCatalogRepository.js'
import { SqliteRetailInventoryRepository } from './SqliteRetailInventoryRepository.js'
import { SqliteRetailReconciliationRepository } from './SqliteRetailReconciliationRepository.js'

const c={actorType:'user' as const,actorUserId:'user-1',requestId:'reconciliation-test'}
test('Retail reconciliation snapshots expected quantity, classifies variance, and never adjusts daily stock',async()=>{const d=mkdtempSync(join(tmpdir(),'retail-rec-')),f=join(d,'x.sqlite');initializeDatabase(f);const a=new SqliteRetailAccessRepository(f),p=new SqliteRetailCatalogRepository(f),i=new SqliteRetailInventoryRepository(f),r=new SqliteRetailReconciliationRepository(f);try{const l=await a.createLocation({code:'A',name:'A',type:'store',status:'active'},c);const x=await p.createProduct({sourceId:'p',name:'P'},c);await i.recordMovement({productId:x.id,locationId:l.id,quantityDelta:10,type:'opening',sourceType:'test',sourceId:'seed',sourceLineId:'1'},c);const s=await r.create(l.id,'daily',c);const matched=await r.recordCount(s.id,x.id,10,c);equal(matched.variance,0);equal(matched.classification,'matched');const shortage=await r.recordCount(s.id,x.id,8,c);equal(shortage.variance,-2);equal(shortage.classification,'shortage');const surplus=await r.recordCount(s.id,x.id,12,c);equal(surplus.variance,2);equal(surplus.classification,'surplus');equal((await i.findBalance(x.id,l.id))?.onHandQuantity,10);await r.complete(s.id,c);await i.recordMovement({productId:x.id,locationId:l.id,quantityDelta:5,type:'goods_receipt',sourceType:'future-test',sourceId:'later',sourceLineId:'1'},c);const historical=(await r.lines(s.id))[0]!;equal(historical.expectedQuantity,10);equal(historical.actualQuantity,12);equal(historical.variance,2);await rejects(r.recordCount(s.id,x.id,1,c),/completed/);await rejects(r.recordCount(s.id,x.id,-1,c),/non-negative/)}finally{r.close();i.close();p.close();a.close();rmSync(d,{recursive:true,force:true})}})
