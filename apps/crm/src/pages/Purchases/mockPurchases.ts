import type { Purchase } from '../../entities/purchase'

export const mockPurchases: Purchase[] = [
  {
    id: 'purchase-001',
    createdAt: new Date('2026-08-10T09:00:00'),
    updatedAt: new Date('2026-08-10T09:00:00'),

    purchaseNumber: 'PUR-0001',
    purchaseDate: new Date('2026-08-10T09:00:00'),

    supplierName: 'Поставщик сухофруктов',

    items: [
      {
        productId: 'product-001',
        quantity: 100,
        unit: 'kg',
        unitCost: 18,
        totalCost: 1800,
      },
      {
        productId: 'product-002',
        quantity: 50,
        unit: 'kg',
        unitCost: 20,
        totalCost: 1000,
      },
    ],

    totalAmount: 5000,
    paymentMethod: 'cash',
    status: 'completed',

    note: 'Первое тестовое поступление',
  },

  {
    id: 'purchase-002',
    createdAt: new Date('2026-08-11T10:30:00'),
    updatedAt: new Date('2026-08-11T10:30:00'),

    purchaseNumber: 'PUR-0002',
    purchaseDate: new Date('2026-08-11T10:30:00'),

    supplierName: 'Поставщик фиников',

    items: [
      {
        productId: 'product-001',
        quantity: 30,
        unit: 'kg',
        unitCost: 19,
        totalCost: 570,
      },
    ],

    totalAmount: 3000,
    paymentMethod: 'cash',
    status: 'draft',

    note: 'Черновик поступления',
  },
]