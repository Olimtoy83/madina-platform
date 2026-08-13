import type { Sale } from '../../entities/sale'

export const mockSales: Sale[] = [
  {
    id: 'sale-001',
    createdAt: new Date('2026-08-11T11:00:00'),
    updatedAt: new Date('2026-08-11T11:00:00'),

    saleNumber: 'SAL-0001',
    saleDate: new Date('2026-08-11T11:00:00'),

    clientName: 'Тестовый клиент',

    items: [
      {
        productId: 'product-001',
        quantity: 20,
        unit: 'kg',
        unitPrice: 25,
        totalAmount: 500,
      },
    ],

    totalAmount: 500,

    paymentMethod: 'cash',

    status: 'draft',

    note: 'Первое тестовое оформление продажи',
  },
]
