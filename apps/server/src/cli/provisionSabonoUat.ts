import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  rmSync,
} from 'node:fs'
import {
  dirname,
  isAbsolute,
  normalize,
  resolve,
} from 'node:path'
import { UserManagementService } from '@madina/auth'
import { hasRetailCapability } from '@madina/retail'
import {
  initializeDatabase,
  SqliteAuthRepository,
  SqliteRetailAccessRepository,
  SqliteRetailCatalogRepository,
  SqliteRetailInventoryRepository,
  SqliteRetailStoreOpeningRepository,
} from '@madina/database'

export const sabonoPilotDatabaseFile = 'C:\\madina-data\\SABONO\\pilot.sqlite'
export const defaultSabonoUatDatabaseFile = 'C:\\madina-data\\SABONO\\uat\\test-release-1.sqlite'

const uatUsername = 'uat_manager'
const requiredCapabilities = [
  'retail:sales:manage',
  'retail:sales:read',
  'retail:sales:return',
  'retail:inventory:read',
  'retail:goods-receipts:read',
  'retail:goods-receipts:manage',
] as const

export interface ProvisionSabonoUatInput {
  databaseFile: string
  password: string
  reset?: boolean
}

export interface SabonoUatProvisioningSummary {
  databaseFile: string
  userId: string
  storeId: string
  warehouseId: string
  products: ReadonlyArray<{ sourceId: string, name: string, priceMinor?: number, startingQuantity?: number }>
}

export class SabonoUatProvisioningSafetyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SabonoUatProvisioningSafetyError'
  }
}

function resolvedPath(file: string): string {
  if (!isAbsolute(file)) {
    throw new SabonoUatProvisioningSafetyError('SABONO UAT database path must be absolute.')
  }
  return normalize(resolve(file))
}

export function assertSabonoUatDatabaseFile(file: string): string {
  const target = resolvedPath(file)
  const pilot = resolvedPath(sabonoPilotDatabaseFile)
  const uatDirectory = normalize(resolve('C:\\madina-data\\SABONO\\uat'))

  if (target.toLowerCase() === pilot.toLowerCase()) {
    throw new SabonoUatProvisioningSafetyError('Refusing to operate on the SABONO pilot database.')
  }
  if (
    dirname(target).toLowerCase() !== uatDirectory.toLowerCase() ||
    target.split(/[\\/]/u).at(-1)?.toLowerCase() !== 'test-release-1.sqlite'
  ) {
    throw new SabonoUatProvisioningSafetyError(
      'Refusing a non-designated SABONO UAT database target.',
    )
  }
  return target
}

export async function provisionSabonoUat(
  input: ProvisionSabonoUatInput,
): Promise<SabonoUatProvisioningSummary> {
  const databaseFile = assertSabonoUatDatabaseFile(input.databaseFile)
  if (!input.password) throw new Error('UAT_MANAGER_PASSWORD must be set.')

  if (existsSync(databaseFile)) {
    if (!input.reset) {
      throw new SabonoUatProvisioningSafetyError(
        'The UAT database already exists. Pass --reset to replace only the designated UAT database.',
      )
    }
    rmSync(databaseFile)
  }

  mkdirSync(dirname(databaseFile), { recursive: true })
  initializeDatabase(databaseFile)
  const auth = new SqliteAuthRepository(databaseFile)
  const access = new SqliteRetailAccessRepository(databaseFile)
  const catalog = new SqliteRetailCatalogRepository(databaseFile)
  const inventory = new SqliteRetailInventoryRepository(databaseFile)
  const opening = new SqliteRetailStoreOpeningRepository(databaseFile)

  try {
    const systemContext = {
      actorType: 'system' as const,
      requestId: `cli:sabono-uat:${randomUUID()}`,
    }
    const user = await new UserManagementService(auth).createUser({
      username: uatUsername,
      role: 'manager',
      initialPassword: input.password,
    }, systemContext)
    const userContext = {
      actorType: 'user' as const,
      actorUserId: user.id,
      requestId: `cli:sabono-uat:${randomUUID()}`,
    }
    const store = await access.createLocation({
      code: 'SABONO-UAT-STORE',
      name: 'SABONO UAT Store',
      type: 'store',
      status: 'active',
    }, systemContext)
    const warehouse = await access.createLocation({
      code: 'SABONO-UAT-WAREHOUSE',
      name: 'SABONO UAT Central Warehouse',
      type: 'central_warehouse',
      status: 'active',
    }, systemContext)
    await access.configureCurrency(store.id, 'USD', 2, systemContext)
    await access.configureCurrency(warehouse.id, 'USD', 2, systemContext)
    await access.grant(user.id, store.id, systemContext)
    await access.grant(user.id, warehouse.id, systemContext)

    const productA = await catalog.createProduct({ sourceId: 'UAT-A', name: 'UAT Product A' }, systemContext)
    const productB = await catalog.createProduct({ sourceId: 'UAT-B', name: 'UAT Product B' }, systemContext)
    await catalog.createProduct({ sourceId: 'UAT-ZERO', name: 'UAT Product Zero' }, systemContext)
    await catalog.addBarcode(productA.id, '5052609920253', systemContext)
    await catalog.setPrice(productA.id, store.id, 100, systemContext)
    await catalog.setPrice(productB.id, store.id, 250, systemContext)
    await opening.initializeStoreOpeningStock({
      clientOperationId: 'sabono-uat-store-opening-v1',
      locationId: store.id,
      actorUserId: user.id,
      worksheetReference: 'SABONO-UAT-OPENING-V1',
      lines: [
        { productId: productA.id, quantity: 10 },
        { productId: productB.id, quantity: 10 },
      ],
    }, userContext)

    return {
      databaseFile,
      userId: user.id,
      storeId: store.id,
      warehouseId: warehouse.id,
      products: [
        { sourceId: 'UAT-A', name: 'UAT Product A', priceMinor: 100, startingQuantity: 10 },
        { sourceId: 'UAT-B', name: 'UAT Product B', priceMinor: 250, startingQuantity: 10 },
        { sourceId: 'UAT-ZERO', name: 'UAT Product Zero' },
      ],
    }
  } finally {
    opening.close()
    inventory.close()
    catalog.close()
    access.close()
    auth.close()
  }
}

export async function assertSabonoUatProvisioning(
  databaseFile: string,
  expected: SabonoUatProvisioningSummary,
): Promise<void> {
  const auth = new SqliteAuthRepository(databaseFile)
  const access = new SqliteRetailAccessRepository(databaseFile)
  const catalog = new SqliteRetailCatalogRepository(databaseFile)
  const inventory = new SqliteRetailInventoryRepository(databaseFile)

  try {
      const user = await auth.findUserByNormalizedUsername(uatUsername)
      if (!user || user.id !== expected.userId || !await auth.findCredentialByUserId(user.id)) {
        throw new Error('UAT user or credential is missing.')
      }
      if (!requiredCapabilities.every((capability) => hasRetailCapability(user.role, capability))) {
        throw new Error('UAT user does not have all required retail capabilities.')
      }
      for (const locationId of [expected.storeId, expected.warehouseId]) {
        if (!await access.hasActiveGrant(user.id, locationId)) throw new Error('UAT user location grant is missing.')
      }
      const store = await access.findLocation(expected.storeId)
      const warehouse = await access.findLocation(expected.warehouseId)
      if (store?.name !== 'SABONO UAT Store' || store.status !== 'active' || store.type !== 'store') throw new Error('UAT store is invalid.')
      if (warehouse?.name !== 'SABONO UAT Central Warehouse' || warehouse.status !== 'active' || warehouse.type !== 'central_warehouse') throw new Error('UAT warehouse is invalid.')
      const products = new Map((await catalog.listProducts()).map((product) => [product.sourceId, product]))
      const productA = products.get('UAT-A')
      const productB = products.get('UAT-B')
      const zero = products.get('UAT-ZERO')
      if (!productA || !productB || !zero || productA.status !== 'active' || productB.status !== 'active' || zero.status !== 'active') throw new Error('UAT products are invalid.')
      if ((await catalog.findProductByBarcode('5052609920253'))?.id !== productA.id) throw new Error('UAT barcode does not resolve Product A.')
      if (await catalog.findPrice(productA.id, expected.storeId) !== 100 || await catalog.findPrice(productB.id, expected.storeId) !== 250) throw new Error('UAT prices are invalid.')
      if ((await inventory.findBalance(productA.id, expected.storeId))?.onHandQuantity !== 10 || (await inventory.findBalance(productB.id, expected.storeId))?.onHandQuantity !== 10 || await inventory.findBalance(zero.id, expected.storeId)) throw new Error('UAT starting stock is invalid.')
  } finally {
    inventory.close()
    catalog.close()
    access.close()
    auth.close()
  }
}
