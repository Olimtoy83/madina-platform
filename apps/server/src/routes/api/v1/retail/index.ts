import type { SqliteRetailAccessRepository, SqliteRetailCatalogRepository, SqliteRetailGoodsReceiptRepository, SqliteRetailInventoryRepository, SqliteRetailReconciliationRepository, SqliteRetailTransferRepository, SqliteRetailSaleRepository } from '@madina/database'
import type { RetailCapability } from '@madina/retail'
import { hasRetailCapability } from '@madina/retail'
import type { FastifyPluginAsync } from 'fastify'
import { getAuthenticatedCommandContext, requireAuthentication, requireTrustedOrigin } from '../../../../plugins/authentication.js'
import { requireRetailLocationAccess, requireRetailLocationsAccess } from '../../../../security/retailLocationAccess.js'

interface RetailRoutesOptions {
  retailAccessRepository?: SqliteRetailAccessRepository
  retailCatalogRepository?: SqliteRetailCatalogRepository
  retailInventoryRepository?: SqliteRetailInventoryRepository
  retailReconciliationRepository?: SqliteRetailReconciliationRepository
  retailGoodsReceiptRepository?: SqliteRetailGoodsReceiptRepository
  retailTransferRepository?: SqliteRetailTransferRepository
  retailSaleRepository?: SqliteRetailSaleRepository
}

function sendRetailPermissionError(reply: { code(statusCode: number): { send(payload: unknown): void } }): void {
  reply.code(403).send({
    statusCode: 403,
    error: 'Forbidden',
    message: 'Retail permission denied.',
  })
}

function hasRetailPermission(
  role: Parameters<typeof hasRetailCapability>[0],
  capability: RetailCapability,
): boolean {
  return hasRetailCapability(role, capability)
}

export const retailRoutes: FastifyPluginAsync<RetailRoutesOptions> = async (app, options) => {
  if (!options.retailAccessRepository || !options.retailCatalogRepository || !options.retailInventoryRepository || !options.retailReconciliationRepository || !options.retailGoodsReceiptRepository || !options.retailTransferRepository || !options.retailSaleRepository) return
  const retailAccessRepository = options.retailAccessRepository
  const retailCatalogRepository = options.retailCatalogRepository
  const retailInventoryRepository = options.retailInventoryRepository
  const retailReconciliationRepository = options.retailReconciliationRepository
  const retailGoodsReceiptRepository = options.retailGoodsReceiptRepository
  const retailTransferRepository = options.retailTransferRepository
  const retailSaleRepository = options.retailSaleRepository

  app.get('/locations', { preHandler: requireAuthentication(app) }, async (request, reply) => {
    const principal = await app.authenticateRequest(request)
    if (!principal) return
    if (!hasRetailPermission(principal.role, 'retail:locations:read')) {
      sendRetailPermissionError(reply)
      return
    }
    const locations = principal.role === 'admin'
      ? await retailAccessRepository.listLocations()
      : await retailAccessRepository.listPermittedLocations(principal.id)
    return { locations }
  })

  app.get('/locations/:locationId', {
    preHandler: requireRetailLocationAccess(
      app,
      retailAccessRepository,
      'retail:locations:read',
      (request) => (request.params as { locationId?: string }).locationId,
    ),
  }, async (request) => {
    const locationId = (request.params as { locationId: string }).locationId
    return { location: await retailAccessRepository.findLocation(locationId) }
  })

  app.get('/locations/:locationId/inventory/balances', {
    preHandler: requireRetailLocationAccess(
      app,
      retailAccessRepository,
      'retail:inventory:read',
      (request) => (request.params as { locationId?: string }).locationId,
    ),
  }, async (request) => {
    const locationId = (request.params as { locationId: string }).locationId
    return { balances: await retailInventoryRepository.listBalances(locationId) }
  })

  app.get('/locations/:locationId/inventory/products/:productId/movements', {
    preHandler: requireRetailLocationAccess(
      app,
      retailAccessRepository,
      'retail:inventory:read',
      (request) => (request.params as { locationId?: string }).locationId,
    ),
  }, async (request) => {
    const { locationId, productId } = request.params as { locationId: string; productId: string }
    return {
      balance: await retailInventoryRepository.findBalance(productId, locationId),
      movements: await retailInventoryRepository.listMovements(productId, locationId),
    }
  })

  app.get('/locations/:locationId/reconciliations', { preHandler: requireRetailLocationAccess(app, retailAccessRepository, 'retail:reconciliation:read', (r) => (r.params as { locationId?: string }).locationId) }, async (request) => ({ reconciliations: await retailReconciliationRepository.list((request.params as { locationId: string }).locationId) }))
  app.post('/locations/:locationId/reconciliations', { preHandler: [requireRetailLocationAccess(app, retailAccessRepository, 'retail:reconciliation:manage', (r) => (r.params as { locationId?: string }).locationId), requireTrustedOrigin()] }, async (request, reply) => { const body=request.body as { purpose?: 'opening'|'daily' }; if(!body || (body.purpose !== 'opening' && body.purpose !== 'daily')) return reply.code(400).send({statusCode:400,error:'Bad Request',message:'Retail reconciliation input is invalid.'}); const reconciliation=await retailReconciliationRepository.create((request.params as {locationId:string}).locationId,body.purpose,getAuthenticatedCommandContext(request)); reply.code(201);return {reconciliation} })
  app.get('/locations/:locationId/reconciliations/:sessionId', { preHandler: requireRetailLocationAccess(app, retailAccessRepository, 'retail:reconciliation:read', (r) => (r.params as { locationId?: string }).locationId) }, async (request,reply) => { const s=await retailReconciliationRepository.find((request.params as {sessionId:string}).sessionId); if(!s || s.locationId !== (request.params as {locationId:string}).locationId) return reply.code(404).send({statusCode:404,error:'Not Found',message:'Retail reconciliation not found.'}); return {reconciliation:s,lines:await retailReconciliationRepository.lines(s.id)} })
  app.post('/locations/:locationId/reconciliations/:sessionId/counts', { preHandler: [requireRetailLocationAccess(app, retailAccessRepository, 'retail:reconciliation:manage', (r) => (r.params as { locationId?: string }).locationId), requireTrustedOrigin()] }, async (request,reply) => { const b=request.body as {productId?:string;actualQuantity?:number}; const actual=b?.actualQuantity; if(!b || typeof b.productId!=='string'||!Number.isSafeInteger(actual)||actual===undefined||actual<0)return reply.code(400).send({statusCode:400,error:'Bad Request',message:'Retail reconciliation count is invalid.'}); const s=await retailReconciliationRepository.find((request.params as {sessionId:string}).sessionId);if(!s||s.locationId!==(request.params as {locationId:string}).locationId)return reply.code(404).send({statusCode:404,error:'Not Found',message:'Retail reconciliation not found.'}); return {line:await retailReconciliationRepository.recordCount(s.id,b.productId,actual,getAuthenticatedCommandContext(request))} })
  app.post('/locations/:locationId/reconciliations/:sessionId/complete', { preHandler: [requireRetailLocationAccess(app, retailAccessRepository, 'retail:reconciliation:manage', (r) => (r.params as { locationId?: string }).locationId), requireTrustedOrigin()] }, async (request,reply) => { const s=await retailReconciliationRepository.find((request.params as {sessionId:string}).sessionId);if(!s||s.locationId!==(request.params as {locationId:string}).locationId)return reply.code(404).send({statusCode:404,error:'Not Found',message:'Retail reconciliation not found.'});return {reconciliation:await retailReconciliationRepository.complete(s.id,getAuthenticatedCommandContext(request))} })
  app.get('/locations/:locationId/goods-receipts', { preHandler: requireRetailLocationAccess(app, retailAccessRepository, 'retail:goods-receipts:read', (r) => (r.params as { locationId?: string }).locationId) }, async (request) => ({ goodsReceipts: await retailGoodsReceiptRepository.list((request.params as { locationId: string }).locationId) }))
  app.get('/locations/:locationId/goods-receipts/:receiptId', { preHandler: requireRetailLocationAccess(app, retailAccessRepository, 'retail:goods-receipts:read', (r) => (r.params as { locationId?: string }).locationId) }, async (request, reply) => { const item=await retailGoodsReceiptRepository.find((request.params as { receiptId:string }).receiptId);if(!item||item.locationId!==(request.params as { locationId:string }).locationId)return reply.code(404).send({statusCode:404,error:'Not Found',message:'Retail Goods Receipt not found.'});return {goodsReceipt:item,lines:await retailGoodsReceiptRepository.lines(item.id)} })
  app.post('/locations/:locationId/goods-receipts', { preHandler: [requireRetailLocationAccess(app, retailAccessRepository, 'retail:goods-receipts:manage', (r) => (r.params as { locationId?: string }).locationId), requireTrustedOrigin()] }, async (request,reply) => { const body=request.body as {receiptReference?:string;supplierReference?:string;shipmentReference?:string;notes?:string;lines?:unknown};if(!body||typeof body.receiptReference!=='string'||!Array.isArray(body.lines))return reply.code(400).send({statusCode:400,error:'Bad Request',message:'Retail Goods Receipt input is invalid.'});const goodsReceipt=await retailGoodsReceiptRepository.create({receiptReference:body.receiptReference,locationId:(request.params as {locationId:string}).locationId,supplierReference:body.supplierReference,shipmentReference:body.shipmentReference,notes:body.notes,lines:body.lines as Array<{productId:string;quantity:number}>},getAuthenticatedCommandContext(request));reply.code(201);return {goodsReceipt,lines:await retailGoodsReceiptRepository.lines(goodsReceipt.id)} })
  app.patch('/locations/:locationId/goods-receipts/:receiptId', { preHandler: [requireRetailLocationAccess(app, retailAccessRepository, 'retail:goods-receipts:manage', (r) => (r.params as { locationId?: string }).locationId), requireTrustedOrigin()] }, async (request,reply) => { const item=await retailGoodsReceiptRepository.find((request.params as {receiptId:string}).receiptId);if(!item||item.locationId!==(request.params as {locationId:string}).locationId)return reply.code(404).send({statusCode:404,error:'Not Found',message:'Retail Goods Receipt not found.'});const body=request.body as {supplierReference?:string;shipmentReference?:string;notes?:string;lines?:unknown};if(!body||!Array.isArray(body.lines))return reply.code(400).send({statusCode:400,error:'Bad Request',message:'Retail Goods Receipt input is invalid.'});const goodsReceipt=await retailGoodsReceiptRepository.update(item.id,{...body,lines:body.lines as Array<{productId:string;quantity:number}>},getAuthenticatedCommandContext(request));return {goodsReceipt,lines:await retailGoodsReceiptRepository.lines(item.id)} })
  app.post('/locations/:locationId/goods-receipts/:receiptId/complete', { preHandler: [requireRetailLocationAccess(app, retailAccessRepository, 'retail:goods-receipts:manage', (r) => (r.params as { locationId?: string }).locationId), requireTrustedOrigin()] }, async (request,reply) => { const item=await retailGoodsReceiptRepository.find((request.params as {receiptId:string}).receiptId);if(!item||item.locationId!==(request.params as {locationId:string}).locationId)return reply.code(404).send({statusCode:404,error:'Not Found',message:'Retail Goods Receipt not found.'});return {goodsReceipt:await retailGoodsReceiptRepository.complete(item.id,getAuthenticatedCommandContext(request)),lines:await retailGoodsReceiptRepository.lines(item.id)} })
  const transferAccess=(cap:'retail:transfers:read'|'retail:transfers:manage')=>[requireRetailLocationAccess(app,retailAccessRepository,cap,(r)=>(r.params as {locationId?:string}).locationId),requireRetailLocationAccess(app,retailAccessRepository,cap,(r)=>(r.body as {destinationLocationId?:string})?.destinationLocationId)]
  app.post('/locations/:locationId/transfers',{preHandler:[...transferAccess('retail:transfers:manage'),requireTrustedOrigin()]},async(request,reply)=>{const b=request.body as {destinationLocationId?:string;lines?:Array<{productId:string;quantity:number}>};if(!b?.destinationLocationId||!Array.isArray(b.lines))return reply.code(400).send({message:'Retail Transfer input is invalid.'});const transfer=await retailTransferRepository.create({sourceLocationId:(request.params as {locationId:string}).locationId,destinationLocationId:b.destinationLocationId,lines:b.lines},getAuthenticatedCommandContext(request));reply.code(201);return{transfer,lines:await retailTransferRepository.lines(transfer.id)}})
  app.post('/locations/:locationId/transfers/:transferId/dispatch',{preHandler:[requireRetailLocationsAccess(app,retailAccessRepository,'retail:transfers:manage',async r=>{const t=await retailTransferRepository.find((r.params as {transferId:string}).transferId);return t?[t.sourceLocationId,t.destinationLocationId]:[]}),requireTrustedOrigin()]},async(request,reply)=>{const t=await retailTransferRepository.find((request.params as {transferId:string}).transferId);if(!t||t.sourceLocationId!==(request.params as {locationId:string}).locationId)return reply.code(404).send({message:'Retail Transfer not found.'});return{transfer:await retailTransferRepository.dispatch(t.id,getAuthenticatedCommandContext(request))}})
  app.post('/locations/:locationId/transfers/:transferId/receive',{preHandler:[requireRetailLocationsAccess(app,retailAccessRepository,'retail:transfers:manage',async r=>{const t=await retailTransferRepository.find((r.params as {transferId:string}).transferId);return t?[t.sourceLocationId,t.destinationLocationId]:[]}),requireTrustedOrigin()]},async(request,reply)=>{const t=await retailTransferRepository.find((request.params as {transferId:string}).transferId);if(!t||t.destinationLocationId!==(request.params as {locationId:string}).locationId)return reply.code(404).send({message:'Retail Transfer not found.'});return{transfer:await retailTransferRepository.receive(t.id,getAuthenticatedCommandContext(request))}})

  app.get('/products', { preHandler: requireAuthentication(app) }, async (request, reply) => {
    const principal = await app.authenticateRequest(request)
    if (!principal) return
    if (!hasRetailPermission(principal.role, 'retail:products:read')) return sendRetailPermissionError(reply)
    const search = (request.query as { search?: string }).search
    return { products: await retailCatalogRepository.listProducts(typeof search === 'string' ? search : undefined) }
  })

  app.get('/products/by-barcode/:barcode', { preHandler: requireAuthentication(app) }, async (request, reply) => {
    const principal = await app.authenticateRequest(request)
    if (!principal) return
    if (!hasRetailPermission(principal.role, 'retail:products:read')) return sendRetailPermissionError(reply)
    const product = await retailCatalogRepository.findProductByBarcode((request.params as { barcode: string }).barcode)
    if (!product) return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Retail Product barcode not found.' })
    return { product }
  })

  app.get('/products/:productId', { preHandler: requireAuthentication(app) }, async (request, reply) => {
    const principal = await app.authenticateRequest(request)
    if (!principal) return
    if (!hasRetailPermission(principal.role, 'retail:products:read')) return sendRetailPermissionError(reply)
    const product = await retailCatalogRepository.findProduct((request.params as { productId: string }).productId)
    if (!product) return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Retail Product not found.' })
    return { product, barcodes: await retailCatalogRepository.listBarcodes(product.id) }
  })

  app.post('/products', { preHandler: [requireAuthentication(app), requireTrustedOrigin()] }, async (request, reply) => {
    const principal = await app.authenticateRequest(request)
    if (!principal) return
    if (!hasRetailPermission(principal.role, 'retail:products:manage')) return sendRetailPermissionError(reply)
    const body = request.body as { sourceId?: string; name?: string; status?: 'active' | 'inactive' } | undefined
    if (!body || typeof body.sourceId !== 'string' || typeof body.name !== 'string' || (body.status !== undefined && body.status !== 'active' && body.status !== 'inactive')) return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'Retail Product input is invalid.' })
    try { const product = await retailCatalogRepository.createProduct({ sourceId: body.sourceId, name: body.name, status: body.status }, getAuthenticatedCommandContext(request)); reply.code(201); return { product } } catch (error) { return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: error instanceof Error ? error.message : 'Retail Product conflict.' }) }
  })

  app.patch('/products/:productId', { preHandler: [requireAuthentication(app), requireTrustedOrigin()] }, async (request, reply) => {
    const principal = await app.authenticateRequest(request)
    if (!principal) return
    if (!hasRetailPermission(principal.role, 'retail:products:manage')) return sendRetailPermissionError(reply)
    const body = request.body as { name?: string; status?: 'active' | 'inactive' } | undefined
    if (!body || typeof body.name !== 'string' || (body.status !== 'active' && body.status !== 'inactive')) return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'Retail Product input is invalid.' })
    try { return { product: await retailCatalogRepository.updateProduct((request.params as { productId: string }).productId, { name: body.name, status: body.status }, getAuthenticatedCommandContext(request)) } } catch (error) { return reply.code(error instanceof Error && error.message === 'Retail Product not found.' ? 404 : 400).send({ statusCode: error instanceof Error && error.message === 'Retail Product not found.' ? 404 : 400, error: 'Retail Product error', message: error instanceof Error ? error.message : 'Retail Product error.' }) }
  })

  app.post('/products/:productId/barcodes', { preHandler: [requireAuthentication(app), requireTrustedOrigin()] }, async (request, reply) => {
    const principal = await app.authenticateRequest(request)
    if (!principal) return
    if (!hasRetailPermission(principal.role, 'retail:products:manage')) return sendRetailPermissionError(reply)
    const body = request.body as { value?: string } | undefined
    if (!body || typeof body.value !== 'string') return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'Retail Product barcode input is invalid.' })
    try { const barcode = await retailCatalogRepository.addBarcode((request.params as { productId: string }).productId, body.value, getAuthenticatedCommandContext(request)); reply.code(201); return { barcode } } catch (error) { return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: error instanceof Error ? error.message : 'Retail Product barcode conflict.' }) }
  })

  app.post('/products/imports', { preHandler: [requireAuthentication(app), requireTrustedOrigin()] }, async (request, reply) => {
    const principal = await app.authenticateRequest(request)
    if (!principal) return
    if (!hasRetailPermission(principal.role, 'retail:products:import')) return sendRetailPermissionError(reply)
    const body = request.body as { dryRun?: boolean; rows?: unknown } | undefined
    if (!body || typeof body.dryRun !== 'boolean' || !Array.isArray(body.rows)) return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'Retail Product import input is invalid.' })
    return { result: await retailCatalogRepository.importProducts(body.rows as never, body.dryRun, getAuthenticatedCommandContext(request)) }
  })

  app.post('/locations', { preHandler: [requireAuthentication(app), requireTrustedOrigin()] }, async (request, reply) => {
    const principal = await app.authenticateRequest(request)
    if (!principal) return
    if (!hasRetailPermission(principal.role, 'retail:locations:manage')) {
      sendRetailPermissionError(reply)
      return
    }
    const body = request.body as Partial<{
      code: string
      name: string
      type: 'central_warehouse' | 'store'
      status: 'active' | 'inactive'
    }> | undefined
    if (!body || typeof body.code !== 'string' || !body.code.trim() ||
      typeof body.name !== 'string' || !body.name.trim() ||
      (body.type !== 'central_warehouse' && body.type !== 'store')) {
      reply.code(400)
      return { statusCode: 400, error: 'Bad Request', message: 'Retail Location input is invalid.' }
    }
    const location = await retailAccessRepository.createLocation({
      code: body.code.trim(),
      name: body.name.trim(),
      type: body.type,
      status: body.status === 'inactive' ? 'inactive' : 'active',
    }, getAuthenticatedCommandContext(request))
    reply.code(201)
    return { location }
  })

  app.patch('/locations/:locationId', { preHandler: [requireRetailLocationAccess(app, retailAccessRepository, 'retail:locations:manage', r => (r.params as {locationId?:string}).locationId), requireTrustedOrigin()] }, async (request, reply) => {
    const body=request.body as {currencyCode?:string;currencyExponent?:number}
    if(!body||typeof body.currencyCode!=='string'||!Number.isSafeInteger(body.currencyExponent))return reply.code(400).send({statusCode:400,error:'Bad Request',message:'Retail Location currency configuration is invalid.'})
    try{return{location:await retailAccessRepository.configureCurrency((request.params as {locationId:string}).locationId,body.currencyCode,body.currencyExponent!,getAuthenticatedCommandContext(request))}}catch(error){return reply.code(400).send({statusCode:400,error:'Bad Request',message:error instanceof Error?error.message:'Retail Location error.'})}
  })
  app.put('/locations/:locationId/products/:productId/price', { preHandler: [requireRetailLocationAccess(app, retailAccessRepository, 'retail:prices:manage', r => (r.params as {locationId?:string}).locationId), requireTrustedOrigin()] }, async (request,reply)=>{const body=request.body as {unitPriceMinor?:number};if(!body||!Number.isSafeInteger(body.unitPriceMinor))return reply.code(400).send({statusCode:400,error:'Bad Request',message:'Retail Product price is invalid.'});try{return{price:await retailCatalogRepository.setPrice((request.params as {productId:string}).productId,(request.params as {locationId:string}).locationId,body.unitPriceMinor!,getAuthenticatedCommandContext(request))}}catch(error){return reply.code(409).send({statusCode:409,error:'Conflict',message:error instanceof Error?error.message:'Retail Product price conflict.'})}})
  app.get('/locations/:locationId/products/:productId/price', { preHandler: requireRetailLocationAccess(app,retailAccessRepository,'retail:prices:read',r=>(r.params as {locationId?:string}).locationId) }, async(request,reply)=>{const p=await retailCatalogRepository.findPrice((request.params as {productId:string}).productId,(request.params as {locationId:string}).locationId);if(p===undefined)return reply.code(404).send({statusCode:404,error:'Not Found',message:'Retail Product price not found.'});return{unitPriceMinor:p}})
  app.post('/locations/:locationId/sales/complete',{preHandler:[requireRetailLocationAccess(app,retailAccessRepository,'retail:sales:manage',r=>(r.params as {locationId?:string}).locationId),requireTrustedOrigin()]},async(request,reply)=>{const body=request.body as {clientOperationId?:string;saleId?:string;lines?:unknown;allocations?:unknown};if(!body||typeof body.clientOperationId!=='string'||typeof body.saleId!=='string'||!Array.isArray(body.lines)||!Array.isArray(body.allocations))return reply.code(400).send({statusCode:400,error:'Bad Request',message:'Retail Sale input is invalid.'});try{const {replayed,...result}=await retailSaleRepository.complete((request.params as {locationId:string}).locationId,{clientOperationId:body.clientOperationId,saleId:body.saleId,lines:body.lines as never,allocations:body.allocations as never},getAuthenticatedCommandContext(request));reply.code(replayed?200:201);return result}catch(error){const message=error instanceof Error?error.message:'Retail Sale conflict.';const validationMessages=['Retail Sale clientOperationId is required.','Retail Sale saleId is required.','Retail Sale lines and allocations are required.','Retail Sale line id is required.','Retail Sale productId is required.','Retail Sale quantity is invalid.','Retail Sale duplicate line.','Retail Sale allocation id is required.','Retail Sale allocation is invalid.','Retail Sale allocation amount is invalid.','Retail Sale allocation ordinal is invalid.','Retail Sale allocations must equal payable total.','Retail Sale money overflow.'];if(validationMessages.includes(message))return reply.code(400).send({statusCode:400,error:'Bad Request',message});return reply.code(409).send({statusCode:409,error:'Conflict',message})}})

  app.post('/locations/:locationId/grants', { preHandler: [requireAuthentication(app), requireTrustedOrigin()] }, async (request, reply) => {
    const principal = await app.authenticateRequest(request)
    if (!principal) return
    if (!hasRetailPermission(principal.role, 'retail:access:manage')) {
      sendRetailPermissionError(reply)
      return
    }
    const body = request.body as { userId?: string } | undefined
    const locationId = (request.params as { locationId?: string }).locationId
    if (!body || typeof body.userId !== 'string' || body.userId !== body.userId.trim() ||
      !body.userId || !locationId) {
      reply.code(400)
      return { statusCode: 400, error: 'Bad Request', message: 'Retail grant input is invalid.' }
    }
    await retailAccessRepository.grant(body.userId, locationId, getAuthenticatedCommandContext(request))
    return { success: true }
  })

  app.delete('/locations/:locationId/grants/:userId', { preHandler: [requireAuthentication(app), requireTrustedOrigin()] }, async (request, reply) => {
    const principal = await app.authenticateRequest(request)
    if (!principal) return
    if (!hasRetailPermission(principal.role, 'retail:access:manage')) {
      sendRetailPermissionError(reply)
      return
    }
    const { locationId, userId } = request.params as {
      locationId?: string
      userId?: string
    }
    if (!locationId || !userId) {
      reply.code(400)
      return { statusCode: 400, error: 'Bad Request', message: 'Retail grant input is invalid.' }
    }
    try {
      await retailAccessRepository.revoke(userId, locationId, getAuthenticatedCommandContext(request))
      return { success: true }
    } catch {
      reply.code(404)
      return { statusCode: 404, error: 'Not Found', message: 'Active Retail Location grant not found.' }
    }
  })
}
