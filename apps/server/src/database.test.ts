import {
  equal,
  throws,
} from 'node:assert/strict'
import test from 'node:test'
import {
  getServerConfiguration,
  ServerConfigurationError,
} from './database.js'

test('development configuration keeps convenient local defaults', () => {
  const configuration = getServerConfiguration({})

  equal(configuration.nodeEnv, 'development')
  equal(configuration.host, '127.0.0.1')
  equal(configuration.port, 3000)
})

test('production configuration requires an explicit absolute database path', () => {
  throws(
    () => getServerConfiguration({
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: '3000',
      DATABASE_FILE: 'data/madina.sqlite',
    }),
    ServerConfigurationError,
  )
})

test('configuration rejects an unsupported NODE_ENV', () => {
  throws(
    () => getServerConfiguration({ NODE_ENV: 'prod' }),
    ServerConfigurationError,
  )
})

test('production configuration accepts valid explicit settings', () => {
  const configuration = getServerConfiguration({
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: '3001',
    DATABASE_FILE: 'C:\\madina-data\\madina.sqlite',
  })

  equal(configuration.host, '127.0.0.1')
  equal(configuration.port, 3001)
  equal(configuration.databaseFile, 'C:\\madina-data\\madina.sqlite')
})

test('production configuration requires a loopback server host', () => {
  throws(
    () => getServerConfiguration({
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      PORT: '3001',
      DATABASE_FILE: 'C:\\madina-data\\madina.sqlite',
    }),
    ServerConfigurationError,
  )
})
