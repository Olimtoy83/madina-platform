import type {
  CommerceReadRepository,
  StockMovementHistory,
  StockMovementHistoryQuery,
} from './CommerceRepository.js'
import type { StockIntegrityDiscrepancy } from '../inventory/index.js'

/**
 * Read boundary for the operational stock movement journal. Query validation
 * and transport concerns remain at the API boundary; this service keeps route
 * handlers independent from the persistence implementation.
 */
export class StockMovementReadService {
  private readonly repository: CommerceReadRepository

  constructor(
    repository: CommerceReadRepository,
  ) {
    this.repository = repository
  }

  async getHistory(
    query: StockMovementHistoryQuery,
  ): Promise<StockMovementHistory> {
    return this.repository.getStockMovementHistory(query)
  }

  async getIntegrityDiscrepancies(): Promise<
    StockIntegrityDiscrepancy[]
  > {
    return this.repository.getStockIntegrityDiscrepancies()
  }
}
