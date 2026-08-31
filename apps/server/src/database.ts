import { mkdirSync } from 'node:fs'
import {
  dirname,
  isAbsolute,
  resolve,
} from 'node:path'
import { isLoopbackHost } from './security/trustedProxy.js'

export interface ServerConfiguration {
  nodeEnv: string
  host: string
  port: number
  databaseFile: string
}

export class ServerConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ServerConfigurationError'
  }
}

function requiredString(
  value: string | undefined,
  name: string,
): string {
  const normalized = value?.trim()
  if (!normalized) {
    throw new ServerConfigurationError(`${name} must be set in production.`)
  }
  return normalized
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? 3000)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ServerConfigurationError('PORT must be an integer between 1 and 65535.')
  }
  return port
}

export function getServerConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): ServerConfiguration {
  const nodeEnv = environment.NODE_ENV?.trim() || 'development'
  const port = parsePort(environment.PORT)

  if (
    nodeEnv !== 'development' &&
    nodeEnv !== 'test' &&
    nodeEnv !== 'production'
  ) {
    throw new ServerConfigurationError(
      'NODE_ENV must be development, test, or production.',
    )
  }

  if (nodeEnv !== 'production') {
    return {
      nodeEnv,
      host: environment.HOST?.trim() || '127.0.0.1',
      port,
      databaseFile: getDatabaseFile(environment),
    }
  }

  const host = requiredString(environment.HOST, 'HOST')
  const databaseFile = requiredString(environment.DATABASE_FILE, 'DATABASE_FILE')

  if (!isLoopbackHost(host)) {
    throw new ServerConfigurationError(
      'HOST must be a loopback address in production; use a controlled reverse proxy for public traffic.',
    )
  }

  if (!isAbsolute(databaseFile)) {
    throw new ServerConfigurationError(
      'DATABASE_FILE must be an absolute filesystem path in production.',
    )
  }

  return {
    nodeEnv,
    host,
    port,
    databaseFile,
  }
}

export function getDatabaseFile(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return (
    environment.DATABASE_FILE ??
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
