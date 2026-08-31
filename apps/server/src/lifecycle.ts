import type { FastifyInstance } from 'fastify'

export interface ProcessSignalTarget {
  once(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
}

export function createGracefulShutdown(
  app: FastifyInstance,
  exit: (code: number) => never | void = process.exit,
): () => Promise<void> {
  let shutdown: Promise<void> | undefined

  return () => {
    shutdown ??= (async () => {
      try {
        await app.close()
        exit(0)
      } catch (error) {
        app.log.error(error)
        exit(1)
      }
    })()

    return shutdown
  }
}

export function installGracefulShutdown(
  app: FastifyInstance,
  processTarget: ProcessSignalTarget = process,
  exit: (code: number) => never | void = process.exit,
): void {
  const shutdown = createGracefulShutdown(app, exit)
  const handleSignal = () => { void shutdown() }

  processTarget.once('SIGTERM', handleSignal)
  processTarget.once('SIGINT', handleSignal)
}
