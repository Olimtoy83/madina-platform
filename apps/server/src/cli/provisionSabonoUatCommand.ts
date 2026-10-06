import { runProvisionSabonoUatCommand } from './provisionSabonoUatCommandRunner.js'

try {
  await runProvisionSabonoUatCommand()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Unable to provision SABONO UAT.'}\n`)
  process.exitCode = 1
}
