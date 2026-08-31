import { buildApp } from './app.js'
import {
  getServerConfiguration,
} from './database.js'
import { installGracefulShutdown } from './lifecycle.js'

const app = buildApp()

try {
  const configuration = getServerConfiguration()
  installGracefulShutdown(app)
  await app.listen({
    port: configuration.port,
    host: configuration.host,
  })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
