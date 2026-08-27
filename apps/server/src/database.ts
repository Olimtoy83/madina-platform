import { mkdirSync } from 'node:fs'
import {
  dirname,
  resolve,
} from 'node:path'

export function getDatabaseFile(): string {
  return (
    process.env.DATABASE_FILE ??
    resolve(
      process.cwd(),
      'data',
      'madina.sqlite',
    )
  )
}

export function ensureDatabaseDirectory(databaseFile: string): void {
  mkdirSync(
    dirname(databaseFile),
    {
      recursive: true,
    },
  )
}
