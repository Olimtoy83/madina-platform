import type { Purchase } from '../../purchases/types/purchase'
import type { Sale } from '../../sales/types/sale'
import type { Product } from '../types/product'

export class ProductValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProductValidationError'
  }
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
  if (
    updates.unit !== undefined &&
    updates.unit !== product.unit
  ) {
    validateProductUnitChange(
      product,
      sales,
      purchases,
    )
  }

  return {
    ...product,
    ...updates,
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
