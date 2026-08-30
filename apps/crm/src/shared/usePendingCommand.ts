import {
  useCallback,
  useRef,
  useState,
} from 'react'

export function createPendingCommandGuard() {
  const pendingKeys = new Set<string>()

  return {
    begin(key: string): boolean {
      if (pendingKeys.has(key)) {
        return false
      }

      pendingKeys.add(key)
      return true
    },
    finish(key: string) {
      pendingKeys.delete(key)
    },
    has(key: string): boolean {
      return pendingKeys.has(key)
    },
    keys(): ReadonlySet<string> {
      return new Set(pendingKeys)
    },
  }
}

export function usePendingCommand() {
  const guard = useRef(createPendingCommandGuard())
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(
    new Set(),
  )

  const syncPendingKeys = useCallback(() => {
    setPendingKeys(guard.current.keys())
  }, [])

  const begin = useCallback((key: string): boolean => {
    const started = guard.current.begin(key)

    if (started) {
      syncPendingKeys()
    }

    return started
  }, [syncPendingKeys])

  const finish = useCallback((key: string) => {
    guard.current.finish(key)
    syncPendingKeys()
  }, [syncPendingKeys])

  const run = useCallback(async <T,>(
    key: string,
    command: () => Promise<T>,
  ): Promise<{ started: boolean, value?: T }> => {
    if (!begin(key)) {
      return { started: false }
    }

    try {
      return {
        started: true,
        value: await command(),
      }
    } finally {
      finish(key)
    }
  }, [begin, finish])

  return {
    isPending: (key: string) => pendingKeys.has(key),
    run,
  }
}
