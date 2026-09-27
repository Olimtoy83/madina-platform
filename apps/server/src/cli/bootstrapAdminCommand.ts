import { runBootstrapAdminCommand } from './bootstrapAdminCommandRunner.js'

try {
  await runBootstrapAdminCommand()
} catch (error) {
  const message = error instanceof Error
    ? error.message
    : 'Unable to bootstrap the first admin.'
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
}
