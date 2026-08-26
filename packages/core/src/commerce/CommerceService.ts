import {
  completePurchase as completePurchaseCore,
  type Purchase,
} from '../purchases/index.js'
import {
  completeSale as completeSaleCore,
  type Sale,
} from '../sales/index.js'
import type { Transaction } from '../transactions/index.js'
import type {
  CommerceRepository,
  CommerceUnitOfWork,
} from './CommerceRepository.js'

export interface CommerceCompletionResult {
  success: boolean
  idempotent: boolean
  message?: string
  purchase?: Purchase
  sale?: Sale
  transaction?: Transaction
}

function failed(message: string): CommerceCompletionResult {
  return {
    success: false,
    idempotent: false,
    message,
  }
}

async function hasCompletedReference(
  unitOfWork: CommerceUnitOfWork,
  category: Transaction['category'],
  referenceId: string,
): Promise<boolean> {
  const transaction =
    await unitOfWork.findTransactionByReference(
      category,
      referenceId,
    )

  return transaction?.status === 'completed'
}

export class CommerceService {
  private readonly repository: CommerceRepository

  constructor(
    repository: CommerceRepository,
  ) {
    this.repository = repository
  }

  async completePurchase(
    purchaseId: string,
  ): Promise<CommerceCompletionResult> {
    return this.repository.withTransaction(
      async (unitOfWork) => {
        const purchase =
          await unitOfWork.findPurchaseById(purchaseId)

        if (!purchase) {
          return failed('Поступление не найдено.')
        }

        if (purchase.status === 'completed') {
          return {
            success: true,
            idempotent: true,
            purchase,
          }
        }

        if (await hasCompletedReference(
          unitOfWork,
          'purchase',
          purchase.id,
        )) {
          return failed(
            'Найдена завершённая транзакция для незавершённого поступления.',
          )
        }

        const products =
          await unitOfWork.findProductsByIds(
            purchase.items.map((item) => item.productId),
          )

        const result = completePurchaseCore(
          purchase,
          products,
        )

        if (
          !result.success ||
          !result.purchase ||
          !result.transaction
        ) {
          return failed(
            result.message ??
              'Не удалось завершить поступление.',
          )
        }

        await unitOfWork.saveProducts(result.products)
        await unitOfWork.updatePurchase(result.purchase)
        await unitOfWork.saveStockMovements(result.movements)
        await unitOfWork.saveTransaction(result.transaction)

        return {
          success: true,
          idempotent: false,
          purchase: result.purchase,
          transaction: result.transaction,
        }
      },
    )
  }

  async completeSale(
    saleId: string,
  ): Promise<CommerceCompletionResult> {
    return this.repository.withTransaction(
      async (unitOfWork) => {
        const sale = await unitOfWork.findSaleById(saleId)

        if (!sale) {
          return failed('Продажа не найдена.')
        }

        if (sale.status === 'completed') {
          return {
            success: true,
            idempotent: true,
            sale,
          }
        }

        if (await hasCompletedReference(
          unitOfWork,
          'sale',
          sale.id,
        )) {
          return failed(
            'Найдена завершённая транзакция для незавершённой продажи.',
          )
        }

        const products =
          await unitOfWork.findProductsByIds(
            sale.items.map((item) => item.productId),
          )

        const result = completeSaleCore(sale, products)

        if (
          !result.success ||
          !result.sale ||
          !result.transaction
        ) {
          return failed(
            result.message ??
              'Не удалось завершить продажу.',
          )
        }

        await unitOfWork.saveProducts(result.products)
        await unitOfWork.updateSale(result.sale)
        await unitOfWork.saveStockMovements(result.movements)
        await unitOfWork.saveTransaction(result.transaction)

        return {
          success: true,
          idempotent: false,
          sale: result.sale,
          transaction: result.transaction,
        }
      },
    )
  }
}
