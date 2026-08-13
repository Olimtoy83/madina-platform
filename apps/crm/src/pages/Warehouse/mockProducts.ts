import type { Product } from '../../entities/product'

const now = new Date()

export const mockProducts: Product[] = [
  {
    id: 'product-001',
    createdAt: now,
    updatedAt: now,
    name: 'Жёлтый киш-миш',
    category: 'dry-fruits',
    quantity: 120,
    unit: 'kg',
    costPrice: 18,
    salePrice: 25,
    status: 'active',
  },
  {
    id: 'product-002',
    createdAt: now,
    updatedAt: now,
    name: 'Жёлтый Марков',
    category: 'dry-fruits',
    quantity: 85,
    unit: 'kg',
    costPrice: 20,
    salePrice: 28,
    status: 'active',
  },
]