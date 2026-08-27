import {
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import {
  Alert,
  Button,
  Card,
} from '@madina/ui'
import { useAuth } from '../context/useAuth'
import { Login } from '../pages/Login/Login'
import { bootstrapAuthenticatedServerData } from '../shared/migrations/authenticatedServerBootstrap'

interface AuthenticationBoundaryProps {
  children: ReactNode
}

type BootstrapState =
  | { status: 'loading'; error: null }
  | { status: 'ready'; error: null }
  | { status: 'error'; error: Error }

function LoadingScreen({ message }: { message: string }) {
  return (
    <main className="login-screen">
      <Card className="login-screen__card" padding="lg">
        <h1>Madina CRM</h1>
        <p>{message}</p>
      </Card>
    </main>
  )
}

function AuthenticatedStartup({
  children,
}: AuthenticationBoundaryProps) {
  const { user } = useAuth()
  const [state, setState] = useState<BootstrapState>({
    status: 'loading',
    error: null,
  })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!user) {
      return
    }

    let cancelled = false
    setState({ status: 'loading', error: null })

    void bootstrapAuthenticatedServerData(user)
      .then(() => {
        if (!cancelled) {
          setState({ status: 'ready', error: null })
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            error: error instanceof Error
              ? error
              : new Error('Не удалось перенести legacy данные на сервер.'),
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [attempt, user])

  if (state.status === 'loading') {
    return <LoadingScreen message="Подготавливаем данные CRM…" />
  }

  if (state.status === 'error') {
    return (
      <main className="login-screen">
        <Card className="login-screen__card" padding="lg">
          <Alert variant="danger" title="Не удалось подготовить данные CRM">
            {state.error.message}
          </Alert>
          <Button onClick={() => setAttempt((value) => value + 1)}>
            Повторить
          </Button>
        </Card>
      </main>
    )
  }

  return <>{children}</>
}

export function AuthenticationBoundary({
  children,
}: AuthenticationBoundaryProps) {
  const {
    isAuthenticated,
    isLoading,
  } = useAuth()

  if (isLoading) {
    return <LoadingScreen message="Проверяем сессию…" />
  }

  if (!isAuthenticated) {
    return <Login />
  }

  return (
    <AuthenticatedStartup>
      {children}
    </AuthenticatedStartup>
  )
}
