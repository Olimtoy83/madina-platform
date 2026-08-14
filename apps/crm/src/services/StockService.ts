import type { Product } from '../entities/product'
import type { StockMovement } from '../entities/stockMovement'

export interface StockServiceResult {
  success: boolean
  message?: string
  product?: Product
  movement?: StockMovement
}

export interface StockServiceStateResult {
  success: boolean
  message?: string
  products: Product[]
  product?: Product
  movement?: StockMovement
}

function createMovement(
  product: Product,
  quantity: number,
  type: StockMovement['type'],
  referenceId?: string,
  note?: string,
): StockMovement {
  const now = new Date()

  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    productId: product.id,
    type,
    quantity,
    unit: product.unit,
    referenceId,
    note,
  }
}

export function receiveStock(
  products: Product[],
  productId: string,
  quantity: number,
  referenceId?: string,
  note?: string,
): StockServiceStateResult {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return {
      success: false,
      message: 'Количество должно быть больше нуля.',
      products,
    }
  }

  const product = products.find(
    (item) => item.id === productId,
  )

  if (!product) {
    return {
      success: false,
      message: 'Товар не найден.',
      products,
    }
  }

  const now = new Date()

  const updatedProduct: Product = {
    ...product,
    quantity: product.quantity + quantity,
    updatedAt: now,
  }

  const nextProducts = products.map(
    (item) =>
      item.id === productId
        ? updatedProduct
        : item,
  )

  const movement = createMovement(
    product,
    quantity,
    'purchase',
    referenceId,
    note,
  )

  return {
    success: true,
    products: nextProducts,
    product: updatedProduct,
    movement,
  }
}

export function issueStock(
  products: Product[],
  productId: string,
  quantity: number,
  referenceId?: string,
  note?: string,
): StockServiceStateResult {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return {
      success: false,
      message: 'Количество должно быть больше нуля.',
      products,
    }
  }

  const product = products.find(
    (item) => item.id === productId,
  )

  if (!product) {
    return {
      success: false,
      message: 'Товар не найден.',
      products,
    }
  }

  if (product.quantity < quantity) {
    return {
      success: false,
      message: `Недостаточно товара на складе. Доступно: ${product.quantity} ${product.unit}.`,
      products,
    }
  }

  const now = new Date()

  const updatedProduct: Product = {
    ...product,
    quantity: product.quantity - quantity,
    updatedAt: now,
  }

  const nextProducts = products.map(
    (item) =>
      item.id === productId
        ? updatedProduct
        : item,
  )

  const movement = createMovement(
    product,
    -quantity,
    'sale',
    referenceId,
    note,
  )

  return {
    success: true,
    products: nextProducts,
    product: updatedProduct,
    movement,
  }
}

export function adjustStock(
  products: Product[],
  productId: string,
  quantity: number,
  referenceId?: string,
  note?: string,
): StockServiceStateResult {
  if (!Number.isFinite(quantity) || quantity === 0) {
    return {
      success: false,
      message: 'Количество корректировки не должно быть равно нулю.',
      products,
    }
  }

  const product = products.find(
    (item) => item.id === productId,
  )

  if (!product) {
    return {
      success: false,
      message: 'Товар не найден.',
      products,
    }
  }

  const newQuantity =
    product.quantity + quantity

  if (newQuantity < 0) {
    return {
      success: false,
      message: 'Корректировка не может привести к отрицательному остатку.',
      products,
    }
  }

  const now = new Date()

  const updatedProduct: Product = {
    ...product,
    quantity: newQuantity,
    updatedAt: now,
  }

  const nextProducts = products.map(
    (item) =>
      item.id === productId
        ? updatedProduct
        : item,
  )

  const movement = createMovement(
    product,
    quantity,
    'adjustment',
    referenceId,
    note,
  )

  return {
    success: true,
    products: nextProducts,
    product: updatedProduct,
    movement,
  }
}
