import {
  useState,
  type FormEvent,
} from 'react'
import {
  Alert,
  Button,
  Card,
  Input,
} from '@madina/ui'
import { useAuth } from '../../context/useAuth'
import './Login.css'

export function Login() {
  const {
    error,
    isLoading,
    login,
    refresh,
  } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await login(username, password)
  }

  return (
    <main className="login-screen">
      <Card className="login-screen__card" padding="lg">
        <div className="login-screen__brand">MB</div>
        <h1>Madina CRM</h1>
        <p>Войдите, чтобы продолжить работу.</p>

        {error && (
          <Alert variant="danger" title="Не удалось войти">
            {error.message}
          </Alert>
        )}

        <form className="login-screen__form" onSubmit={handleSubmit}>
          <label>
            Имя пользователя
            <Input
              autoComplete="username"
              disabled={isLoading}
              fullWidth
              onChange={(event) => setUsername(event.target.value)}
              required
              value={username}
            />
          </label>

          <label>
            Пароль
            <Input
              autoComplete="current-password"
              disabled={isLoading}
              fullWidth
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>

          <Button disabled={isLoading} fullWidth type="submit">
            {isLoading ? 'Выполняется вход…' : 'Войти'}
          </Button>
        </form>

        {error && (
          <Button
            disabled={isLoading}
            onClick={() => void refresh()}
            type="button"
            variant="secondary"
          >
            Повторить проверку сессии
          </Button>
        )}
      </Card>
    </main>
  )
}
