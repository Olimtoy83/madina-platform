import {
  createInterface,
} from 'node:readline/promises'

export interface BootstrapAdminTerminal {
  prompt(message: string): Promise<string>
  promptSecret(message: string): Promise<string>
  writeLine(message: string): void
  close(): void
}

export function createBootstrapAdminTerminal(): BootstrapAdminTerminal {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return {
    prompt(message) {
      return readline.question(message)
    },
    async promptSecret(message) {
      // A non-TTY invocation is intentionally supported for controlled local
      // automation, but shell history still must not contain the password.
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        return readline.question(message)
      }

      process.stdout.write(message)
      process.stdin.setRawMode(true)
      process.stdin.resume()

      return new Promise((resolve, reject) => {
        let value = ''

        const finish = () => {
          process.stdin.setRawMode(false)
          process.stdin.off('data', onData)
          process.stdout.write('\n')
          resolve(value)
        }

        const onData = (chunk: Buffer) => {
          for (const character of chunk.toString('utf8')) {
            if (character === '\u0003') {
              process.stdin.setRawMode(false)
              process.stdin.off('data', onData)
              reject(new Error('Password entry cancelled.'))
              return
            }

            if (character === '\r' || character === '\n') {
              finish()
              return
            }

            if (character === '\b' || character === '\u007f') {
              value = value.slice(0, -1)
              continue
            }

            value += character
          }
        }

        process.stdin.on('data', onData)
      })
    },
    writeLine(message) {
      process.stdout.write(`${message}\n`)
    },
    close() {
      readline.close()
    },
  }
}
