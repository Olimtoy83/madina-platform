import {
  checkDatabaseIntegrity,
  type DatabaseIntegrityCheckResult,
} from '@madina/database'

export function runDatabaseCheck(
  databaseFile: string,
): DatabaseIntegrityCheckResult {
  return checkDatabaseIntegrity(databaseFile)
}
