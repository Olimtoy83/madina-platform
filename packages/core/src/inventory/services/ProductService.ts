import type { Purchase } from '../../purchases/types/purchase'
import type { Sale } from '../../sales/types/sale'
import type { Product } from '../types/product'

export class ProductValidationError extends Error {
  readonly field?: 'name' | 'costPrice' | 'salePrice' | 'initialQuantity'

  constructor(message: string) {
    super(message)
    this.name = 'ProductValidationError'
  }
}

function validationError(
  field: NonNullable<ProductValidationError['field']>,
  message: string,
): ProductValidationError {
  const error = new ProductValidationError(message)
  Object.defineProperty(error, 'field', {
    value: field,
    enumerable: true,
  })
  return error
}

export function normalizeProductName(name: unknown): string {
  if (typeof name !== 'string') {
    throw validationError('name', 'Product name must be a string.')
  }

  const normalized = name.trim()
  if (!normalized) {
    throw validationError('name', 'Product name must not be empty.')
  }

  return normalized
}

export function validateProductPrice(
  value: unknown,
  field: 'costPrice' | 'salePrice',
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw validationError(
      field,
      `${field} must be a non-negative finite number.`,
    )
  }

  return value
}

export function validateInitialProductQuantity(
  value: unknown,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw validationError(
      'initialQuantity',
      'Initial product quantity must be a non-negative finite number.',
    )
  }

  return value
}

export function normalizeProductUpdates(
  updates: Partial<Product>,
): Partial<Product> {
  const normalized = { ...updates }

  if (updates.name !== undefined) {
    normalized.name = normalizeProductName(updates.name)
  }
  if (updates.costPrice !== undefined) {
    normalized.costPrice = validateProductPrice(
      updates.costPrice,
      'costPrice',
    )
  }
  if (updates.salePrice !== undefined) {
    normalized.salePrice = validateProductPrice(
      updates.salePrice,
      'salePrice',
    )
  }

  return normalized
}

function hasDraftSaleReference(
  productId: string,
  sales: Sale[],
): boolean {
  return sales.some(
    (sale) =>
      sale.status === 'draft' &&
      sale.items.some(
        (item) => item.productId === productId,
      ),
  )
}

function hasDraftPurchaseReference(
  productId: string,
  purchases: Purchase[],
): boolean {
  return purchases.some(
    (purchase) =>
      purchase.status === 'draft' &&
      purchase.items.some(
        (item) => item.productId === productId,
      ),
  )
}

function validateProductUnitChange(
  product: Product,
  sales: Sale[],
  purchases: Purchase[],
) {
  if (product.quantity !== 0) {
    throw new ProductValidationError(
      'Единицу товара можно изменить только при нулевом остатке.',
    )
  }

  if (hasDraftSaleReference(product.id, sales)) {
    throw new ProductValidationError(
      'Нельзя изменить единицу товара, пока он указан в черновике продажи.',
    )
  }

  if (hasDraftPurchaseReference(product.id, purchases)) {
    throw new ProductValidationError(
      'Нельзя изменить единицу товара, пока он указан в черновике поступления.',
    )
  }
}

export function updateProduct(
  product: Product,
  updates: Partial<Product>,
  sales: Sale[],
  purchases: Purchase[],
): Product {
  const normalizedUpdates = normalizeProductUpdates(updates)

  if (
    normalizedUpdates.unit !== undefined &&
    normalizedUpdates.unit !== product.unit
  ) {
    validateProductUnitChange(
      product,
      sales,
      purchases,
    )
  }

  return {
    ...product,
    ...normalizedUpdates,
    id: product.id,
    createdAt: product.createdAt,
    updatedAt: new Date(),
  }
}

export function deactivateProduct(
  product: Product,
): Product {
  return {
    ...product,
    status: 'inactive',
    updatedAt: new Date(),
  }
}
