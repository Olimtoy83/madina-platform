import { StoreOpeningError } from '@madina/database'
import type { SqliteRetailAccessRepository, SqliteRetailCatalogRepository, SqliteRetailGoodsReceiptRepository, SqliteRetailInventoryRepository, SqliteRetailStoreOpeningRepository, SqliteRetailReconciliationRepository, SqliteRetailTransferRepository, SqliteRetailSaleRepository, SqliteRetailSaleReturnRepository, SqliteRetailOfflineSaleSyncRepository, SqliteRetailOfflineStockConflictMaterializationRepository, SqliteRetailOfflineStockConflictLifecycleRepository, SqliteRetailOfflineAuthorityRepository } from '@madina/database'
import type { RetailCapability } from '@madina/retail'
import { hasRetailCapability } from '@madina/retail'
import type { FastifyPluginAsync } from 'fastify'
import { getAuthenticatedCommandContext, requireAuthentication, requireTrustedOrigin } from '../../../../plugins/authentication.js'
import { requireRetailLocationAccess, requireRetailLocationsAccess } from '../../../../security/retailLocationAccess.js'

interface RetailRoutesOptions {
  retailAccessRepository?: SqliteRetailAccessRepository
  retailCatalogRepository?: SqliteRetailCatalogRepository
  retailInventoryRepository?: SqliteRetailInventoryRepository
  retailStoreOpeningRepository?: SqliteRetailStoreOpeningRepository
  retailReconciliationRepository?: SqliteRetailReconciliationRepository
  retailGoodsReceiptRepository?: SqliteRetailGoodsReceiptRepository
  retailTransferRepository?: SqliteRetailTransferRepository
  retailSaleRepository?: SqliteRetailSaleRepository
  retailSaleReturnRepository?: SqliteRetailSaleReturnRepository
  retailOfflineSaleSyncRepository?: SqliteRetailOfflineSaleSyncRepository
  retailOfflineStockConflictMaterializationRepository?: SqliteRetailOfflineStockConflictMaterializationRepository
  retailOfflineStockConflictLifecycleRepository?: SqliteRetailOfflineStockConflictLifecycleRepository
  retailOfflineAuthorityRepository?: SqliteRetailOfflineAuthorityRepository
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
  if (!options.retailAccessRepository || !options.retailCatalogRepository || !options.retailInventoryRepository || !options.retailStoreOpeningRepository || !options.retailReconciliationRepository || !options.retailGoodsReceiptRepository || !options.retailTransferRepository || !options.retailSaleRepository || !options.retailSaleReturnRepository || !options.retailOfflineSaleSyncRepository || !options.retailOfflineStockConflictMaterializationRepository || !options.retailOfflineStockConflictLifecycleRepository || !options.retailOfflineAuthorityRepository) return
  const retailAccessRepository = options.retailAccessRepository
  const retailCatalogRepository = options.retailCatalogRepository
  const retailInventoryRepository = options.retailInventoryRepository
  const retailStoreOpeningRepository = options.retailStoreOpeningRepository
  const retailReconciliationRepository = options.retailReconciliationRepository
  const retailGoodsReceiptRepository = options.retailGoodsReceiptRepository
  const retailTransferRepository = options.retailTransferRepository
  const retailSaleRepository = options.retailSaleRepository
  const retailSaleReturnRepository = options.retailSaleReturnRepository
  const retailOfflineSaleSyncRepository = options.retailOfflineSaleSyncRepository
  const retailOfflineStockConflictMaterializationRepository = options.retailOfflineStockConflictMaterializationRepository
  const retailOfflineStockConflictLifecycleRepository = options.retailOfflineStockConflictLifecycleRepository
  const retailOfflineAuthorityRepository = options.retailOfflineAuthorityRepository

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

  app.post('/locations/:locationId/inventory/opening', {
    preHandler: [
      requireRetailLocationAccess(app, retailAccessRepository, 'retail:inventory:opening:manage', request => (request.params as { locationId?: string }).locationId),
      requireTrustedOrigin(),
    ],
  }, async (request, reply) => {
    const body = request.body
    const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
    const hasKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key))
    const requiredText = (value: unknown) => typeof value === 'string' && value.length > 0 && value.trim() === value
    if (!isObject(body) || !hasKeys(body, ['clientOperationId', 'worksheetReference', 'lines']) ||
      !requiredText(body.clientOperationId) || !requiredText(body.worksheetReference) ||
      !Array.isArray(body.lines) || body.lines.length === 0 ||
      !body.lines.every((line: unknown) => isObject(line) && hasKeys(line, ['productId', 'quantity']) &&
        requiredText(line.productId) && Number.isSafeInteger(line.quantity) && (line.quantity as number) > 0) ||
      new Set(body.lines.map((line: { productId: string }) => line.productId)).size !== body.lines.length) {
      return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'Retail Store Opening input is invalid.' })
    }
    const context = getAuthenticatedCommandContext(request)
    if (context.actorType !== 'user' || !context.actorUserId) return reply.code(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required.' })
    try {
      const { replayed, ...result } = await retailStoreOpeningRepository.initializeStoreOpeningStock({
        clientOperationId: body.clientOperationId as string,
        locationId: (request.params as { locationId: string }).locationId,
        actorUserId: context.actorUserId,
        worksheetReference: body.worksheetReference as string,
        lines: body.lines as Array<{ productId: string; quantity: number }>,
      }, context)
      reply.code(replayed ? 200 : 201)
      return result
    } catch (error) {
      if (!(error instanceof StoreOpeningError)) throw error
      const statusCode = error.code === 'INVALID_COMMAND' ? 400 :
        error.code === 'LOCATION_NOT_FOUND' || error.code === 'PRODUCT_NOT_FOUND' ? 404 :
          error.code === 'OPENING_EVIDENCE_INVALID' ? 500 : 409
      const label = statusCode === 400 ? 'Bad Request' : statusCode === 404 ? 'Not Found' : statusCode === 500 ? 'Internal Server Error' : 'Conflict'
      return reply.code(statusCode).send({ statusCode, error: label, message: statusCode === 500 ? 'Retail Store Opening evidence is invalid.' : error.code })
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
  app.post('/locations/:locationId/transfers/:transferId/dispatch',{preHandler:[requireRetailLocationsAccess(app,retailAccessRepository,'retail:transfers:manage',async r=>{const t=await retailTransferRepository.find((r.params as {transferId:string}).transferId);return t?[t.sourceLocationId,t.destinationLocationId]:[]}),requireTrustedOrigin()]},async(request,reply)=>{const t=await retailTransferRepository.find((request.params as {transferId:string}).transferId);if(!t||t.sourceLocationId!==(request.params as {locationId:string}).locationId)return reply.code(404).send({message:'Retail Transfer not found.'});try{return{transfer:await retailTransferRepository.dispatch(t.id,getAuthenticatedCommandContext(request))}}catch(error){if(error instanceof Error&&error.message==='RETAIL_PRODUCT_LOCATION_CONFLICT_BLOCKED')return reply.code(409).send({statusCode:409,error:'Conflict',message:error.message});throw error}})
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
  app.post('/locations/:locationId/sales/complete',{preHandler:[requireRetailLocationAccess(app,retailAccessRepository,'retail:sales:manage',r=>(r.params as {locationId?:string}).locationId),requireTrustedOrigin()]},async(request,reply)=>{const body=request.body as {clientOperationId?:string;saleId?:string;lines?:unknown;allocations?:unknown};if(!body||typeof body.clientOperationId!=='string'||typeof body.saleId!=='string'||!Array.isArray(body.lines)||!Array.isArray(body.allocations))return reply.code(400).send({statusCode:400,error:'Bad Request',message:'Retail Sale input is invalid.'});const requestsDiscount=body.lines.some(line=>typeof line==='object'&&line!==null&&Object.prototype.hasOwnProperty.call(line,'discountAmountMinor'));if(requestsDiscount){const principal=await app.authenticateRequest(request);if(!principal||!hasRetailPermission(principal.role,'retail:sales:discount')){sendRetailPermissionError(reply);return}}try{const {replayed,...result}=await retailSaleRepository.complete((request.params as {locationId:string}).locationId,{clientOperationId:body.clientOperationId,saleId:body.saleId,lines:body.lines as never,allocations:body.allocations as never},getAuthenticatedCommandContext(request));reply.code(replayed?200:201);return result}catch(error){const message=error instanceof Error?error.message:'Retail Sale conflict.';const validationMessages=['Retail Sale clientOperationId is required.','Retail Sale saleId is required.','Retail Sale lines and allocations are required.','Retail Sale line id is required.','Retail Sale productId is required.','Retail Sale quantity is invalid.','Retail Sale duplicate line.','Retail Sale discount amount is invalid.','Retail Sale discount must be less than line total.','Retail Sale payable total is invalid.','Retail Sale allocation id is required.','Retail Sale allocation is invalid.','Retail Sale allocation amount is invalid.','Retail Sale allocation ordinal is invalid.','Retail Sale allocations must equal payable total.','Retail Sale money overflow.'];if(validationMessages.includes(message))return reply.code(400).send({statusCode:400,error:'Bad Request',message});return reply.code(409).send({statusCode:409,error:'Conflict',message})}})
  app.post('/locations/:locationId/offline-sales/sync',{preHandler:[requireRetailLocationAccess(app,retailAccessRepository,'retail:sales:manage',r=>(r.params as {locationId?:string}).locationId),requireTrustedOrigin()]},async(request,reply)=>{const body=request.body as {envelope?:unknown;payloadHash?:string;signature?:string};if(!body||typeof body.payloadHash!=='string'||typeof body.signature!=='string')return reply.code(400).send({statusCode:400,error:'Bad Request',message:'Retail Offline Sale sync input is invalid.'});try{const {replayed,...result}=await retailOfflineSaleSyncRepository.sync((request.params as {locationId:string}).locationId,{envelope:body.envelope,payloadHash:body.payloadHash,signature:body.signature},getAuthenticatedCommandContext(request));reply.code(replayed?200:201);return result}catch(error){const message=error instanceof Error?error.message:'Retail Offline Sale sync conflict.';return reply.code(message.includes('envelope')||message==='Retail Offline Sale sync input is invalid.'?400:409).send({statusCode:message.includes('envelope')?400:409,error:message.includes('envelope')?'Bad Request':'Conflict',message})}})
  const terminalAccess=requireRetailLocationAccess(app,retailAccessRepository,'retail:offline-terminals:manage',r=>(r.params as {locationId?:string}).locationId)
  const terminalForbidden=(value:object)=>['privateKey','actorUserId','enrolledBy','locationId','terminalId','keyVersion'].some(key=>Object.prototype.hasOwnProperty.call(value,key))
  const terminalInput=(body:unknown):{commandId:string;keyAlgorithm:string;publicKey:string}|undefined=>{if(typeof body!=='object'||body===null||terminalForbidden(body))return undefined;const value=body as {commandId?:unknown;keyAlgorithm?:unknown;publicKey?:unknown};return typeof value.commandId==='string'&&value.commandId.trim()&&typeof value.keyAlgorithm==='string'&&value.keyAlgorithm.trim()&&typeof value.publicKey==='string'&&value.publicKey.trim()?{commandId:value.commandId,keyAlgorithm:value.keyAlgorithm,publicKey:value.publicKey}:undefined}
  const terminalError=(reply:{code(statusCode:number):{send(payload:unknown):unknown}},error:unknown)=>{const message=error instanceof Error?error.message:'Retail Offline Terminal conflict.';const badRequest=message.startsWith('Retail Offline Terminal key ')||message.includes(' key algorithm is required.')||message.includes(' public key is required.');return reply.code(badRequest?400:409).send({statusCode:badRequest?400:409,error:badRequest?'Bad Request':'Conflict',message})}
  app.get('/locations/:locationId/offline-terminals',{preHandler:terminalAccess},async request=>({terminals:await retailOfflineAuthorityRepository.listTerminals((request.params as {locationId:string}).locationId)}))
  app.get('/locations/:locationId/offline-terminals/:terminalId',{preHandler:terminalAccess},async(request,reply)=>{const {locationId,terminalId}=request.params as {locationId:string;terminalId:string};const terminal=await retailOfflineAuthorityRepository.findTerminalDetail(locationId,terminalId);return terminal?{terminal}:reply.code(404).send({statusCode:404,error:'Not Found',message:'Retail Offline Terminal not found.'})})
  app.post('/locations/:locationId/offline-terminals',{preHandler:[terminalAccess,requireTrustedOrigin()]},async(request,reply)=>{const input=terminalInput(request.body);if(!input)return reply.code(400).send({statusCode:400,error:'Bad Request',message:'Retail Offline Terminal enrollment input is invalid.'});try{const terminal=await retailOfflineAuthorityRepository.enrollTerminal({...input,locationId:(request.params as {locationId:string}).locationId},getAuthenticatedCommandContext(request));reply.code(201);return{terminal}}catch(error){return terminalError(reply,error)}})
  app.post('/locations/:locationId/offline-terminals/:terminalId/keys/rotate',{preHandler:[terminalAccess,requireTrustedOrigin()]},async(request,reply)=>{const input=terminalInput(request.body),{locationId,terminalId}=request.params as {locationId:string;terminalId:string};if(!input)return reply.code(400).send({statusCode:400,error:'Bad Request',message:'Retail Offline Terminal key rotation input is invalid.'});if(!await retailOfflineAuthorityRepository.findTerminalDetail(locationId,terminalId))return reply.code(404).send({statusCode:404,error:'Not Found',message:'Retail Offline Terminal not found.'});try{return{terminal:await retailOfflineAuthorityRepository.rotateTerminalKey(terminalId,input.keyAlgorithm,input.publicKey,input.commandId,getAuthenticatedCommandContext(request))}}catch(error){return terminalError(reply,error)}})
  app.post('/locations/:locationId/offline-terminals/:terminalId/revoke',{preHandler:[terminalAccess,requireTrustedOrigin()]},async(request,reply)=>{const body=request.body as {commandId?:unknown;reason?:unknown},{locationId,terminalId}=request.params as {locationId:string;terminalId:string};if(!body||terminalForbidden(body)||typeof body.commandId!=='string'||!body.commandId.trim()||typeof body.reason!=='string'||!body.reason.trim())return reply.code(400).send({statusCode:400,error:'Bad Request',message:'Retail Offline Terminal revocation input is invalid.'});if(!await retailOfflineAuthorityRepository.findTerminalDetail(locationId,terminalId))return reply.code(404).send({statusCode:404,error:'Not Found',message:'Retail Offline Terminal not found.'});try{await retailOfflineAuthorityRepository.revokeTerminal(terminalId,body.reason,body.commandId,getAuthenticatedCommandContext(request));return{success:true}}catch(error){return terminalError(reply,error)}})
  const authorityForbidden=(value:object)=>['locationId','authorityId','authorityVersion','terminalKeyVersion','issuedAt','currencyCode','currencyExponent','paymentMethod','discountsAllowed','permitIds','permits','issuedByUserId','actorUserId','privateKey','publicKey','signature'].some(key=>Object.prototype.hasOwnProperty.call(value,key))
  const authorityInput=(body:unknown):{commandId:string;terminalId:string;userId:string;expiresAt:Date;permitCount:number;productIds:string[]}|undefined=>{if(typeof body!=='object'||body===null||authorityForbidden(body))return undefined;const value=body as {commandId?:unknown;terminalId?:unknown;userId?:unknown;expiresAt?:unknown;permitCount?:unknown;productIds?:unknown};if(typeof value.commandId!=='string'||!value.commandId.trim()||typeof value.terminalId!=='string'||!value.terminalId.trim()||typeof value.userId!=='string'||!value.userId.trim()||typeof value.expiresAt!=='string'||!value.expiresAt.trim()||typeof value.permitCount!=='number'||!Number.isSafeInteger(value.permitCount)||value.permitCount<=0||!Array.isArray(value.productIds)||!value.productIds.length||value.productIds.some(productId=>typeof productId!=='string'||!productId.trim())||new Set(value.productIds).size!==value.productIds.length)return undefined;const expiresAt=new Date(value.expiresAt);return Number.isNaN(expiresAt.getTime())?undefined:{commandId:value.commandId,terminalId:value.terminalId,userId:value.userId,expiresAt,permitCount:value.permitCount,productIds:value.productIds}}
  const authorityError=(reply:{code(statusCode:number):{send(payload:unknown):unknown}},error:unknown)=>{const message=error instanceof Error?error.message:'Retail Offline Authority conflict.';return reply.code(409).send({statusCode:409,error:'Conflict',message})}
  app.get('/locations/:locationId/offline-authorities',{preHandler:terminalAccess},async request=>({authorities:await retailOfflineAuthorityRepository.listAuthorities((request.params as {locationId:string}).locationId)}))
  app.get('/locations/:locationId/offline-authorities/:authorityId',{preHandler:terminalAccess},async(request,reply)=>{const {locationId,authorityId}=request.params as {locationId:string;authorityId:string};const authority=await retailOfflineAuthorityRepository.findAuthorityDetail(locationId,authorityId);return authority?{authority}:reply.code(404).send({statusCode:404,error:'Not Found',message:'Retail Offline Authority not found.'})})
  app.get('/locations/:locationId/offline-authorities/:authorityId/permits',{preHandler:terminalAccess},async(request,reply)=>{const {locationId,authorityId}=request.params as {locationId:string;authorityId:string};if(!await retailOfflineAuthorityRepository.findAuthorityDetail(locationId,authorityId))return reply.code(404).send({statusCode:404,error:'Not Found',message:'Retail Offline Authority not found.'});return{permits:await retailOfflineAuthorityRepository.listOperationalPermits(locationId,authorityId)}})
  app.post('/locations/:locationId/offline-authorities',{preHandler:[terminalAccess,requireTrustedOrigin()]},async(request,reply)=>{const input=authorityInput(request.body),locationId=(request.params as {locationId:string}).locationId;if(!input)return reply.code(400).send({statusCode:400,error:'Bad Request',message:'Retail Offline Authority issuance input is invalid.'});if(!await retailOfflineAuthorityRepository.findTerminalDetail(locationId,input.terminalId))return reply.code(404).send({statusCode:404,error:'Not Found',message:'Retail Offline Terminal not found.'});try{const authority=await retailOfflineAuthorityRepository.issueAuthority({...input,locationId},getAuthenticatedCommandContext(request));reply.code(201);return{authority}}catch(error){return authorityError(reply,error)}})
  app.post('/locations/:locationId/offline-authorities/:authorityId/revoke',{preHandler:[terminalAccess,requireTrustedOrigin()]},async(request,reply)=>{const body=request.body as {commandId?:unknown;reason?:unknown},{locationId,authorityId}=request.params as {locationId:string;authorityId:string};if(!body||authorityForbidden(body)||typeof body.commandId!=='string'||!body.commandId.trim()||typeof body.reason!=='string'||!body.reason.trim())return reply.code(400).send({statusCode:400,error:'Bad Request',message:'Retail Offline Authority revocation input is invalid.'});if(!await retailOfflineAuthorityRepository.findAuthorityDetail(locationId,authorityId))return reply.code(404).send({statusCode:404,error:'Not Found',message:'Retail Offline Authority not found.'});try{await retailOfflineAuthorityRepository.revokeAuthority(authorityId,body.reason,body.commandId,getAuthenticatedCommandContext(request));return{success:true}}catch(error){return authorityError(reply,error)}})
  app.get('/locations/:locationId/offline-stock-conflicts',{preHandler:requireRetailLocationAccess(app,retailAccessRepository,'retail:offline-stock-conflicts:materialize',r=>(r.params as {locationId?:string}).locationId)},async request=>({conflicts:await retailOfflineStockConflictLifecycleRepository.list((request.params as {locationId:string}).locationId)}))
  app.get('/locations/:locationId/offline-stock-conflicts/:offlineOperationId/items/:saleItemId',{preHandler:requireRetailLocationAccess(app,retailAccessRepository,'retail:offline-stock-conflicts:materialize',r=>(r.params as {locationId?:string}).locationId)},async(request,reply)=>{const {locationId,offlineOperationId,saleItemId}=request.params as {locationId:string;offlineOperationId:string;saleItemId:string};const conflict=await retailOfflineStockConflictLifecycleRepository.find(locationId,offlineOperationId,saleItemId);if(!conflict)return reply.code(404).send({statusCode:404,error:'Not Found',message:'Retail Offline Stock Conflict not found.'});return conflict})
  app.post('/locations/:locationId/offline-stock-conflicts/materialize',{preHandler:[requireRetailLocationAccess(app,retailAccessRepository,'retail:offline-stock-conflicts:materialize',r=>(r.params as {locationId?:string}).locationId),requireTrustedOrigin()]},async(request,reply)=>{const body=request.body as {offlineOperationId?:string;commandId?:string};if(!body||typeof body.offlineOperationId!=='string'||typeof body.commandId!=='string')return reply.code(400).send({statusCode:400,error:'Bad Request',message:'Retail Offline Stock Conflict materialization input is invalid.'});try{const {replayed,...result}=await retailOfflineStockConflictMaterializationRepository.materialize((request.params as {locationId:string}).locationId,{offlineOperationId:body.offlineOperationId,commandId:body.commandId},getAuthenticatedCommandContext(request));reply.code(replayed?200:201);return result}catch(error){const message=error instanceof Error?error.message:'Retail Offline Stock Conflict materialization conflict.';return reply.code(message.includes('required.')?400:409).send({statusCode:message.includes('required.')?400:409,error:message.includes('required.')?'Bad Request':'Conflict',message})}})
  app.post('/locations/:locationId/offline-stock-conflicts/review',{preHandler:[requireRetailLocationAccess(app,retailAccessRepository,'retail:offline-stock-conflicts:materialize',r=>(r.params as {locationId?:string}).locationId),requireTrustedOrigin()]},async(request,reply)=>{const body=request.body as {offlineOperationId?:string;saleItemId?:string;commandId?:string;expectedCurrentState?:string;targetState?:string};if(!body||typeof body.offlineOperationId!=='string'||typeof body.saleItemId!=='string'||typeof body.commandId!=='string'||body.expectedCurrentState!=='open'||body.targetState!=='under_review')return reply.code(400).send({statusCode:400,error:'Bad Request',message:'Retail Offline Stock Conflict review input is invalid.'});try{const context=getAuthenticatedCommandContext(request);return{lifecycle:await retailOfflineStockConflictLifecycleRepository.review((request.params as {locationId:string}).locationId,{offlineOperationId:body.offlineOperationId,saleItemId:body.saleItemId,commandId:body.commandId,expectedCurrentState:'open',targetState:'under_review',actorUserId:context.actorUserId})}}catch(error){const message=error instanceof Error?error.message:'Retail Offline Stock Conflict review conflict.';const badRequest=message.includes(' is required.');return reply.code(badRequest?400:409).send({statusCode:badRequest?400:409,error:badRequest?'Bad Request':'Conflict',message})}})
  app.post('/locations/:locationId/offline-stock-conflicts/resolve',{preHandler:[requireRetailLocationAccess(app,retailAccessRepository,'retail:offline-stock-conflicts:materialize',r=>(r.params as {locationId?:string}).locationId),requireTrustedOrigin()]},async(request,reply)=>{const body=request.body as {offlineOperationId?:string;saleItemId?:string;commandId?:string;expectedCurrentState?:string;disposition?:string;reason?:string;evidence?:string;correctiveRecord?:{type?:string;id?:string}};if(!body||typeof body.offlineOperationId!=='string'||typeof body.saleItemId!=='string'||typeof body.commandId!=='string'||body.expectedCurrentState!=='under_review'||typeof body.disposition!=='string'||typeof body.reason!=='string'||typeof body.evidence!=='string'||!body.correctiveRecord||typeof body.correctiveRecord.type!=='string'||typeof body.correctiveRecord.id!=='string')return reply.code(400).send({statusCode:400,error:'Bad Request',message:'Retail Offline Stock Conflict resolution input is invalid.'});try{const context=getAuthenticatedCommandContext(request);return{lifecycle:await retailOfflineStockConflictLifecycleRepository.resolve((request.params as {locationId:string}).locationId,{offlineOperationId:body.offlineOperationId,saleItemId:body.saleItemId,commandId:body.commandId,expectedCurrentState:'under_review',disposition:body.disposition,reason:body.reason,evidence:body.evidence,correctiveRecord:{type:body.correctiveRecord.type,id:body.correctiveRecord.id},actorUserId:context.actorUserId})}}catch(error){const message=error instanceof Error?error.message:'Retail Offline Stock Conflict resolution conflict.';const badRequest=message.includes(' is required.');return reply.code(badRequest?400:409).send({statusCode:badRequest?400:409,error:badRequest?'Bad Request':'Conflict',message})}})

  app.post('/locations/:locationId/offline-stock-conflicts/reopen',{preHandler:[requireRetailLocationAccess(app,retailAccessRepository,'retail:offline-stock-conflicts:materialize',r=>(r.params as {locationId?:string}).locationId),requireTrustedOrigin()]},async(request,reply)=>{const body=request.body as {offlineOperationId?:string;saleItemId?:string;commandId?:string;expectedCurrentState?:string;reason?:string};if(!body||typeof body.offlineOperationId!=='string'||typeof body.saleItemId!=='string'||typeof body.commandId!=='string'||body.expectedCurrentState!=='resolved'||typeof body.reason!=='string')return reply.code(400).send({statusCode:400,error:'Bad Request',message:'Retail Offline Stock Conflict reopen input is invalid.'});try{const context=getAuthenticatedCommandContext(request);return{lifecycle:await retailOfflineStockConflictLifecycleRepository.reopen((request.params as {locationId:string}).locationId,{offlineOperationId:body.offlineOperationId,saleItemId:body.saleItemId,commandId:body.commandId,expectedCurrentState:'resolved',reason:body.reason,actorUserId:context.actorUserId})}}catch(error){const message=error instanceof Error?error.message:'Retail Offline Stock Conflict reopen conflict.';const badRequest=message.includes(' is required.');return reply.code(badRequest?400:409).send({statusCode:badRequest?400:409,error:badRequest?'Bad Request':'Conflict',message})}})
  app.get('/locations/:locationId/sales/:saleId',{preHandler:requireRetailLocationAccess(app,retailAccessRepository,'retail:sales:read',r=>(r.params as {locationId?:string}).locationId)},async(request,reply)=>{const {locationId,saleId}=request.params as {locationId:string;saleId:string};const sale=await retailSaleReturnRepository.findCompletedSale(locationId,saleId);if(!sale)return reply.code(404).send({statusCode:404,error:'Not Found',message:'Retail Sale not found.'});return sale})
  app.post('/locations/:locationId/sales/:saleId/returns',{preHandler:[requireRetailLocationAccess(app,retailAccessRepository,'retail:sales:return',r=>(r.params as {locationId?:string}).locationId),requireTrustedOrigin()]},async(request,reply)=>{const body=request.body as {clientOperationId?:string;items?:unknown};if(!body||typeof body.clientOperationId!=='string'||!Array.isArray(body.items))return reply.code(400).send({statusCode:400,error:'Bad Request',message:'Retail Sale Return input is invalid.'});const {locationId,saleId}=request.params as {locationId:string;saleId:string};try{const {replayed,...result}=await retailSaleReturnRepository.complete(locationId,{clientOperationId:body.clientOperationId,originalSaleId:saleId,items:body.items as never},getAuthenticatedCommandContext(request));reply.code(replayed?200:201);return result}catch(error){const message=error instanceof Error?error.message:'Retail Sale Return conflict.';const validation=['Retail Sale Return clientOperationId is required.','Retail Sale Return originalSaleId is required.','Retail Sale Return items are required.','Retail Sale Return saleItemId is required.','Retail Sale Return quantity is invalid.','Retail Sale Return duplicate SaleItem.'];if(validation.includes(message))return reply.code(400).send({statusCode:400,error:'Bad Request',message});if(message==='Retail Sale Return original Sale is invalid.'||message==='Retail Sale Return SaleItem is invalid.'||message==='Retail Sale Return Location mismatch.')return reply.code(404).send({statusCode:404,error:'Not Found',message:'Retail Sale not found.'});return reply.code(409).send({statusCode:409,error:'Conflict',message})}})

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
